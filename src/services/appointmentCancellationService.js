import Appointment from '../models/appointmentModel.js';
import { createNotificationSafely } from './notificationService.js';
import { emitQueueUpdated, notifyUpcomingQueuePatients } from './consultationTimingService.js';

// Shared cancellation side effects for the existing status API and late worker.
// This project has no appointment refund handler; payment/chat billing is separate.
export const finishAppointmentCancellation = async (appointment, actorId = appointment.counselor) => {
  await emitQueueUpdated(appointment);
  await notifyUpcomingQueuePatients(appointment);
  await createNotificationSafely({
    recipientId: appointment.patient, actorId, type: 'appointment',
    title: 'Appointment canceled',
    message: appointment.cancellation_reason === 'PATIENT_LATE'
      ? 'Patient did not arrive before the dynamically adjusted appointment deadline.'
      : 'Your appointment request has been canceled.',
    data: { appointmentId: appointment._id, status: 'canceled', queue_status: 'canceled',
      date: appointment.date, cancellationReason: appointment.cancellation_reason },
    actionUrl: '/appointments',
  });
};

export const cancelAbsentAppointment = async (appointment, deadline, now) => {
  // The MySQL driver locks the collection before evaluating filter + update.
  // Only the winner sends side effects. Check-in/start or another worker wins
  // by changing the guarded fields; a stale snapshot cannot overwrite them.
  const canceled = await Appointment.findOneAndUpdate({
    _id: appointment._id, status: { $in: ['pending', 'confirmed'] },
    queue_status: 'called', called_at: appointment.called_at,
    checked_in_at: null, consultation_started_at: null,
    'consultation_timing.startedAt': null,
    ...(appointment.updatedAt ? { updatedAt: appointment.updatedAt } : {}),
  }, {
    $set: { status: 'canceled', queue_status: 'canceled', cancellation_reason: 'PATIENT_LATE',
      cancellation_deadline: new Date(deadline), canceled_at: now },
    $unset: { slot_key: 1 },
  }, { returnDocument: 'after', runValidators: true });
  if (!canceled) return false;
  await finishAppointmentCancellation(canceled);
  return true;
};
