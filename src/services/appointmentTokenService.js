import { AppointmentCounter } from '../models/clinicModels.js';
import { dateOnly } from '../utils/clinicAccess.js';
export const normalizeAppointmentDate = dateOnly;
export const getCurrentDatabaseDateTime = async () => {
  const now = new Date(Date.now() + 19800000).toISOString();
  return { appointment_date: now.slice(0, 10), appointment_time: now.slice(11, 19) };
};
export const nextAppointmentToken = async (doctorId, appointmentDate) => {
  const key = String(doctorId) + ':' + dateOnly(appointmentDate);
  const counter = await AppointmentCounter.findOneAndUpdate({ key }, { $inc: { value: 1 }, $setOnInsert: { key } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: false });
  return counter.value;
};
