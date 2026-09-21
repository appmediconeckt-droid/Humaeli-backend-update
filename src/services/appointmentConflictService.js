import { createHash } from 'node:crypto';
import mongoose from '../persistence/mongoose.js';
import Appointment from '../models/appointmentModel.js';
import { WalkinAppointment } from '../models/clinicModels.js';
import User from '../models/userModel.js';
import { dateOnly, fail } from '../utils/clinicAccess.js';

// Legacy local Indian numbers and +91 formatting identify the same intake phone.
export const normalizeBookingPhone = value => {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  return digits;
};
export function bookingMinute(value) {
  const text = String(value || '');
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(text)) throw fail(400, 'appointment_time must be HH:mm or HH:mm:ss');
  return text.slice(0, 5);
}
const isActive = value => !['canceled', 'cancelled', 'rejected'].includes(String(value || '').toLowerCase());
const duplicate = () => Object.assign(fail(409, 'This patient already has a booking with this doctor at the selected date and time'), { code: 'DUPLICATE_APPOINTMENT' });

export async function hasAppointmentConflict({ doctorId, patientId, phoneNumber, appointmentDate, appointmentTime, excludeId }) {
  const day = dateOnly(appointmentDate), minute = bookingMinute(appointmentTime);
  const start = new Date(day + 'T00:00:00+05:30');
  const [online, walkins] = await Promise.all([
    Appointment.find({ counselor: doctorId, date: { $gte: start, $lt: new Date(start.getTime() + 86400000) } }).lean(),
    WalkinAppointment.find({ doctor_id: doctorId, appointment_date: day }).lean(),
  ]);
  let phone = normalizeBookingPhone(phoneNumber);
  if (patientId && !phone) {
    const patient = await User.findById(patientId).select('phoneNumber').lean();
    phone = normalizeBookingPhone(patient?.phoneNumber);
  }
  const ids = [...new Set(online.filter(r => isActive(r.status) && String(r._id) !== String(excludeId))
    .map(r => String(r.patient)))];
  const patients = phone && ids.length ? await User.find({ _id: { $in: ids } }).select('_id phoneNumber').lean() : [];
  const matchingIds = new Set(patients.filter(p => normalizeBookingPhone(p.phoneNumber) === phone).map(p => String(p._id)));
  if (patientId) matchingIds.add(String(patientId));
  return online.some(r => String(r._id) !== String(excludeId) && isActive(r.status) &&
    new Date(new Date(r.date).getTime() + 19800000).toISOString().slice(11, 16) === minute && matchingIds.has(String(r.patient))) ||
    walkins.some(r => String(r._id) !== String(excludeId) && isActive(r.appointment_status) &&
      String(r.appointment_time).slice(0, 5) === minute &&
      ((patientId && r.patient_id && String(r.patient_id) === String(patientId)) ||
       (phone && normalizeBookingPhone(r.phone_number) === phone)));
}

// One MySQL advisory lock per doctor/day covers both tables, including legacy rows.
// The lock is automatically released if the connection/process dies: no stale
// reservation records can permanently block subsequent bookings.
export async function withAppointmentBooking(details, save) {
  dateOnly(details.appointmentDate); bookingMinute(details.appointmentTime);
  if (!mongoose.isObjectIdOrHexString(String(details.doctorId))) throw fail(400, 'Invalid doctor ID');
  const database = mongoose.connection.db;
  if (!database?.pool) throw fail(503, 'Database is not ready');
  const key = 'booking:' + createHash('sha256').update(database.databaseName + ':' + String(details.doctorId).toLowerCase() + ':' + details.appointmentDate).digest('hex').slice(0, 55);
  // Dedicated connection keeps locking independent of the model pool size.
  const mysql = await import('mysql2/promise');
  const { mysqlConfig } = await import('../persistence/mysqlDriver.js');
  const { connectionLimit, ...config } = mysqlConfig();
  const connection = await mysql.default.createConnection({ ...config, database: database.databaseName });
  let acquired = false;
  try {
    const [rows] = await connection.execute('SELECT GET_LOCK(?, 15) AS acquired', [key]);
    acquired = Number(rows[0].acquired) === 1;
    if (!acquired) throw fail(503, 'Booking is busy; please retry');
    if (await hasAppointmentConflict(details)) throw duplicate();
    return await save();
  } finally {
    try { if (acquired) await connection.execute('SELECT RELEASE_LOCK(?)', [key]); }
    finally { await connection.end(); }
  }
}

