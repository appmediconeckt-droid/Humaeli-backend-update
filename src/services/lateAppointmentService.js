import Appointment from '../models/appointmentModel.js';
import { WalkinAppointment } from '../models/clinicModels.js';
import { normalizeQueueAppointment } from './queueTimingService.js';
import { emitQueueUpdated } from './consultationTimingService.js';
import { finishAppointmentCancellation } from './appointmentCancellationService.js';
import { normalizeAppointmentLifecycle } from './appointmentLifecycle.js';

import { getNoShowCancellationDeadline } from './noShowPolicy.js';
export { getNoShowCancellationDeadline } from './noShowPolicy.js';
const activeStatuses = ['pending', 'confirmed', 'booked', 'accepted', 'skipped'];

export const shouldAutoCancelLateAppointment = (appointment, _state, now = Date.now()) => {
  if (normalizeAppointmentLifecycle(appointment, appointment.appointment_status ? 'walkin' : 'online').status === 'completed') return false;
  const own = normalizeQueueAppointment(appointment);
  if (!activeStatuses.includes(own.status) ||
      !['booked', 'waiting', 'called', 'skipped', 'no_show', 'pending', 'confirmed', 'accepted'].includes(own.queueStatus) ||
      own.patientArrivalTime || own.timing.startedAt || own.timing.endedAt ||
      own.availability.status === 'available' || own.availability.returnedAt) return false;
  const deadline = getNoShowCancellationDeadline(appointment);
  return Boolean(deadline && Number(now) >= deadline.getTime());
};

export const noShowCancellationEffects = { finish: finishAppointmentCancellation };

export const cancelNoShowAfter24Hours = async (appointment, source, now) => {
  if (!shouldAutoCancelLateAppointment(appointment, null, now.getTime())) return false;
  const walkin = source === 'walkin';
  const Model = walkin ? WalkinAppointment : Appointment;
  const statusField = walkin ? 'appointment_status' : 'status';
  // Guard the snapshot and arrival/start fields so check-in and concurrent workers win safely.
  const filter = { _id: appointment._id || appointment.id,
    [statusField]: appointment[statusField], queue_status: appointment.queue_status,
    checked_in_at: null, consultation_started_at: null, consultation_ended_at: null,
    'consultation_timing.startedAt': null, 'consultation_timing.started_at': null,
    'consultation_timing.endedAt': null, 'consultation_timing.ended_at': null,
    'consultation_timing.availability.status': { $ne: 'available' },
    'consultation_timing.availability.returnedAt': null,
    ...(appointment.updatedAt ? { updatedAt: appointment.updatedAt } : {}),
    ...(appointment.updated_at ? { updated_at: appointment.updated_at } : {}),
  };
  const updated = await Model.findOneAndUpdate(filter, {
    $set: { [statusField]: walkin ? 'cancelled' : 'canceled', queue_status: 'canceled',
      cancellation_reason: 'NO_SHOW_24_HOURS', canceled_at: now,
      cancellation_deadline: getNoShowCancellationDeadline(appointment) },
    $unset: { slot_key: 1 },
  }, { returnDocument: 'after', runValidators: true });
  if (!updated) return false;
  await noShowCancellationEffects.finish(updated);
  return true;
};

export const checkAndAutoCancelLateAppointments = async (now = new Date()) => {
  let canceled = 0;
  for (const [Model, source, statusField] of [[Appointment, 'online', 'status'], [WalkinAppointment, 'walkin', 'appointment_status']]) {
    const records = await Model.find({ [statusField]: { $in: [...activeStatuses, 'in-progress', 'in_progress'] } }).lean();
    for (const row of records) {
      try {
        const lifecycle = normalizeAppointmentLifecycle(row, source);
        if (lifecycle.status === 'completed') {
          // Repair mobile/legacy queue completion before considering absence.
          const completed = await Model.findOneAndUpdate({ _id: row._id || row.id,
            [statusField]: row[statusField], queue_status: row.queue_status,
            ...(row.updatedAt ? { updatedAt: row.updatedAt } : {}),
          }, { $set: { [statusField]: 'completed', queue_status: 'completed' } }, { returnDocument: 'after', runValidators: true });
          if (completed) await emitQueueUpdated(completed);
          continue;
        }
        if (await cancelNoShowAfter24Hours(row, source, now)) canceled++;
      }
      catch (error) { console.error('24-hour appointment cancellation failed:', String(row._id || row.id), error.message); }
    }
  }
  // Reuse the existing minute job to refresh estimates during a consultation
  // overrun even when there was no new user action. No extra frontend polling.
  if (global.io) {
    const active = await Appointment.find({ status: { $in: ['pending', 'confirmed'] },
      queue_status: { $in: ['booked', 'waiting', 'called', 'in_progress'] } }).lean();
    const groups = new Map();
    for (const row of active) {
      const own = normalizeQueueAppointment(row);
      if (own.doctorId && own.date) groups.set(`${own.doctorId}:${own.date}`, row);
    }
    for (const row of groups.values()) await emitQueueUpdated(row, { displayChanged: false });
  }
  return canceled;
};
