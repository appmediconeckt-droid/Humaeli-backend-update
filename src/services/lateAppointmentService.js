import Appointment from '../models/appointmentModel.js';
import { normalizeQueueAppointment } from './queueTimingService.js';
import { emitQueueUpdated } from './consultationTimingService.js';

// Absence and elapsed slot time require a patient/receptionist decision.
export const shouldAutoCancelLateAppointment = () => false;

export const checkAndAutoCancelLateAppointments = async () => {
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
  return 0;
};
