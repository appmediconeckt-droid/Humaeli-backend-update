import Appointment from '../models/appointmentModel.js';
import { createNotificationSafely } from './notificationService.js';
import { emitAppointmentUpdated } from './portalRealtimeService.js';

// Called only after a captured gateway payment or a successful wallet debit.
// The conditional transition prevents retries from reopening completed visits
// or sending the same booking notification again.
export async function confirmPaidAppointment(record) {
  const paymentFields = {
    payment_status: 'paid', payment_amount: record.amount / 100,
    payment_reference: record.paymentId, payment_method: record.method,
  };
  const result = await Appointment.updateOne({
    _id: record.appointmentId, patient: record.userId, status: 'awaiting_payment',
  }, { $set: { ...paymentFields, status: 'pending', queue_status: 'booked' } });
  if (result.matchedCount === 0) {
    const existing = await Appointment.updateOne({
      _id: record.appointmentId, patient: record.userId, status: { $ne: 'awaiting_payment' },
    }, { $set: paymentFields });
    if (existing.matchedCount === 0) throw new Error('Paid appointment could not be found. Please check payment confirmation again.');
  }
  if (result.modifiedCount === 1) {
    await createNotificationSafely({
      recipientId: record.providerId,
      actorId: record.userId,
      type: 'appointment',
      title: 'New appointment request',
      message: 'A paid appointment request is ready for review.',
      data: { appointmentId: record.appointmentId, status: 'pending' },
      actionUrl: '/counselor/appointments',
    });
    for (const room of [`user_${record.providerId}`, `counsellor_${record.providerId}`, `counselor_${record.providerId}`]) {
      global.io?.to(room).emit('appointmentBooked', { _id: record.appointmentId, status: 'pending' });
    }
  }
  emitAppointmentUpdated({ patient: record.userId, counselor: record.providerId });
}
