import Notification from '../models/Notification.js';
import { createNotificationSafely } from './notificationService.js';

export const queueTurnNotificationDelivery = {
  exists: filter => Notification.exists(filter),
  notify: createNotificationSafely,
};
const sending = new Set();

// Select tokens before looking for recipients: an unregistered walk-in still
// occupies a place in the next two and must not make a third patient eligible.
export async function notifyNextQueueTokens(records, { doctorId, date, clinicId, currentAppointmentId = '', limit = 2 }) {
  const next = records.slice(0, Math.min(2, Math.max(0, limit)));
  await Promise.all(next.map(async (item, index) => {
    const patientId = item.patientId?._id || item.patientId?.id || item.patientId;
    if (!patientId || !item.id) return;
    const queueAlert = index === 0 ? 'NEXT_IN_LINE' : 'UPCOMING';
    const key = [doctorId, date, currentAppointmentId, item.id, patientId, queueAlert].join(':');
    if (sending.has(key)) return;
    sending.add(key);
    try {
      if (await queueTurnNotificationDelivery.exists({ recipientId: patientId,
        'data.type': 'QUEUE_TURN_SOON', 'data.doctorId': String(doctorId),
        'data.appointmentId': String(item.id),
        'data.currentAppointmentId': String(currentAppointmentId),
        'data.queueAlert': queueAlert,
        'data.appointmentDate': date })) return;
      await queueTurnNotificationDelivery.notify({
        recipientId: patientId, actorId: doctorId, type: 'appointment',
        title: index === 0 ? 'Your turn is next' : 'Your turn is coming soon',
        message: index === 0
          ? `Your token ${item.token} is next. Please be available near the clinic.`
          : `Your token ${item.token} is one of the next two. Please stay near the clinic.`,
        data: { type: 'QUEUE_TURN_SOON', doctorId: String(doctorId), appointmentId: String(item.id),
          source: item.source, token: item.token, appointmentDate: date,
          clinicId: clinicId || '', currentAppointmentId: String(currentAppointmentId), queuePosition: index + 1, queueAlert },
        actionUrl: '/appointments',
      });
    } catch (error) {
      console.error('Upcoming queue notification failed:', error.message);
    } finally { sending.delete(key); }
  }));
  return next;
}
