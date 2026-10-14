import Appointment from '../models/appointmentModel.js';
import { WalkinAppointment } from '../models/clinicModels.js';
import { actorId, doctorScope, receptionistClinicScope, handle, fail } from '../utils/clinicAccess.js';
import { finishAppointmentCancellation } from '../services/appointmentCancellationService.js';
import { emitQueueUpdated, notifyUpcomingQueuePatients } from '../services/consultationTimingService.js';

export const manualCancellationEffects = {
  online: finishAppointmentCancellation,
  walkin: async appointment => {
    await emitQueueUpdated(appointment);
    await notifyUpcomingQueuePatients(appointment);
  },
};

export const cancelAppointmentManually = handle(async (req, res) => {
  const source = req.body?.source || 'online';
  if (!['online', 'walkin'].includes(source)) throw fail(400, 'Invalid appointment source');
  const walkin = source === 'walkin';
  const Model = walkin ? WalkinAppointment : Appointment;
  const statusField = walkin ? 'appointment_status' : 'status';
  const filter = { _id: req.params.id };
  if (req.user?.role === 'user') {
    filter[walkin ? 'patient_id' : 'patient'] = actorId(req);
  } else if (req.user?.role === 'receptionist') {
    filter[walkin ? 'doctor_id' : 'counselor'] = await doctorScope(req);
    filter.clinic_id = await receptionistClinicScope(req);
  } else throw fail(403, 'Only the patient or assigned receptionist can cancel this appointment');
  const appointment = await Model.findOne(filter);
  if (!appointment) throw fail(404, 'Appointment not found or access denied');
  if (['canceled', 'cancelled'].includes(appointment[statusField])) {
    return res.json({ success: true, message: 'Appointment already cancelled', appointment });
  }
  const updated = await Model.findOneAndUpdate({ ...filter,
    [statusField]: { $in: ['pending', 'confirmed', 'booked', 'accepted'] },
    queue_status: { $nin: ['in_progress', 'in-progress', 'completed', 'canceled', 'cancelled'] },
    consultation_started_at: null, consultation_ended_at: null,
    'consultation_timing.startedAt': null, 'consultation_timing.endedAt': null,
    'consultation_timing.started_at': null, 'consultation_timing.ended_at': null,
  }, { $set: { [statusField]: walkin ? 'cancelled' : 'canceled', queue_status: 'canceled',
    ...(!walkin ? { canceled_at: new Date(), cancellation_reason: req.user.role === 'user' ? 'PATIENT_REQUEST' : 'RECEPTIONIST_REQUEST' } : {}),
  }, ...(!walkin ? { $unset: { slot_key: 1 } } : {}) }, { returnDocument: 'after', runValidators: true });
  if (!updated) throw fail(409, 'Only an appointment whose checkup has not started can be cancelled. Refresh and try again.');
  await manualCancellationEffects[source](updated, actorId(req));
  res.json({ success: true, message: 'Appointment cancelled', appointment: updated });
});
