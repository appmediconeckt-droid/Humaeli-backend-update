import Appointment from '../models/appointmentModel.js';
import DoctorBreak from '../models/doctorBreakModel.js';
import { slotRepository } from './appointmentSlotService.js';
import { calculateEstimatedQueue, normalizeQueueAppointment, queueRecordKey, isActiveQueueAppointment } from './queueTimingService.js';
import { cancelAbsentAppointment } from './appointmentCancellationService.js';
import { emitQueueUpdated } from './consultationTimingService.js';

export const shouldAutoCancelLateAppointment = (appointment, state, now) => {
  const own = normalizeQueueAppointment(appointment);
  const timing = state.estimates.get(queueRecordKey(own));
  const deadline = Date.parse(timing?.cancelDeadline);
  return Number.isFinite(deadline) && now > deadline &&
    ['pending', 'confirmed'].includes(own.status) && own.queueStatus === 'called' &&
    Boolean(own.calledAt) && !own.patientArrivalTime && !own.timing.startedAt &&
    !state.queue.some((item) => item.emergency && queueRecordKey(item) !== queueRecordKey(own)) &&
    state.doctorStatus !== 'break' && state.doctorStatus !== 'paused' &&
    state.current && queueRecordKey(state.current) === queueRecordKey(own);
};

export const checkAndAutoCancelLateAppointments = async (now = new Date()) => {
  const candidates = await Appointment.find({ status: { $in: ['pending', 'confirmed'] },
    queue_status: 'called', called_at: { $ne: null }, checked_in_at: null,
    consultation_started_at: null, 'consultation_timing.startedAt': null }).lean();
  let count = 0;
  for (const appointment of candidates) {
    const own = normalizeQueueAppointment(appointment);
    if (!own.doctorId || !own.date || !['pending', 'confirmed'].includes(own.status) ||
        own.queueStatus !== 'called' || !own.calledAt || own.patientArrivalTime || own.timing.startedAt) continue;
    // Fresh authoritative queue, including walk-ins/emergencies, for each claim.
    // Lookup errors fail closed rather than pretending the queue is empty.
    const midnight = new Date(`${own.date}T00:00:00+05:30`);
    const [online, walkins, ranges, breaks] = await Promise.all([
      slotRepository.online(own.doctorId, own.date), slotRepository.walkins(own.doctorId, own.date),
      slotRepository.ranges(own.doctorId), DoctorBreak.find({ doctor_id: own.doctorId,
        started_at: { $gte: midnight, $lt: new Date(midnight.getTime() + 86400000) } }).lean(),
    ]);
    const records = [
      ...online.map((row) => normalizeQueueAppointment(row, 'online')),
      ...walkins.map((row) => normalizeQueueAppointment(row, 'walkin')),
    ];
    // A doctor cannot reach this turn while treating another patient, including
    // a consultation at another clinic on the same day.
    if (records.some((item) => isActiveQueueAppointment(item) && item.timing.startedAt &&
        queueRecordKey(item) !== queueRecordKey(own))) continue;
    const state = calculateEstimatedQueue(records, { doctorId: own.doctorId, date: own.date,
      clinicId: own.clinicId, ranges, breaks, now: now.getTime() });
    if (!shouldAutoCancelLateAppointment(appointment, state, now.getTime())) continue;
    const deadline = state.estimates.get(queueRecordKey(own)).cancelDeadline;
    if (await cancelAbsentAppointment(appointment, deadline, now)) count++;
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
    for (const row of groups.values()) await emitQueueUpdated(row);
  }
  return count;
};
