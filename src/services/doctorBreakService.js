import { DoctorBreak, WalkinAppointment } from '../models/clinicModels.js';
import Appointment from '../models/appointmentModel.js';
import { fail, jsonRecord, todayIST } from '../utils/clinicAccess.js';
export const getActiveDoctorBreak = async doctorId => {
  const row = await DoctorBreak.findOne({ doctor_id: doctorId, status: 'active' });
  if (!row) return null;
  const until = new Date(row.started_at.getTime() + row.planned_minutes * 60000);
  if (until <= new Date()) {
    await DoctorBreak.updateOne({ _id: row._id, status: 'active' }, { $set: { status: 'ended', ended_at: until }, $unset: { active_key: 1 } });
    return null;
  }
  return { ...jsonRecord(row), estimated_end_at: until };
};
export const getActiveBreakDelayForAppointment = async (doctorId, date) => {
  const active = await getActiveDoctorBreak(doctorId);
  if (!active) return { delay_minutes: 0, original_appointment_at: date, estimated_start_at: date };
  const estimated = new Date(Math.max(new Date(date).getTime(), new Date(active.estimated_end_at).getTime()));
  return { delay_minutes: Math.max(0, Math.ceil((estimated - new Date(date)) / 60000)),
    original_appointment_at: date, estimated_start_at: estimated };
};
async function affected(doctorId, active) {
  const start = new Date(todayIST() + 'T00:00:00+05:30');
  const [scheduled, walkins] = await Promise.all([
    Appointment.find({ counselor: doctorId, status: { $in: ['pending', 'confirmed'] }, date: { $gte: start, $lt: new Date(start.getTime() + 86400000) } }).lean(),
    WalkinAppointment.find({ doctor_id: doctorId, appointment_date: todayIST(), appointment_status: { $in: ['booked', 'pending', 'confirmed'] } }).lean(),
  ]);
  return [...scheduled.map(r => ({ id: r._id, patient: r.patient, at: r.date, status: r.status })),
    ...walkins.map(r => ({ id: r._id, patient: r.patient_id, at: new Date(r.appointment_date + 'T' + r.appointment_time + '+05:30'), status: 'pending' }))]
    .map(r => {
      const end = active ? new Date(active.estimated_end_at) : new Date(r.at);
      const estimated = new Date(Math.max(new Date(r.at).getTime(), end.getTime()));
      return { appointment_id: r.id, patient_id: r.patient, doctor_id: doctorId, appointment_status: r.status,
        delay_minutes: Math.max(0, Math.ceil((estimated - new Date(r.at)) / 60000)), original_appointment_at: r.at, estimated_start_at: estimated };
    });
}
export const startDoctorBreak = async ({ doctorId, durationMinutes, reason }) => {
  if (await getActiveDoctorBreak(doctorId)) throw fail(409, 'Doctor already has an active break');
  try {
    await DoctorBreak.create({ doctor_id: doctorId, planned_minutes: durationMinutes, reason, started_at: new Date(), active_key: String(doctorId) });
  } catch (error) { if (error.code === 11000) throw fail(409, 'Doctor already has an active break'); throw error; }
  const breakData = await getActiveDoctorBreak(doctorId);
  return { breakData, appointments: await affected(doctorId, breakData) };
};
export const endDoctorBreak = async ({ doctorId, breakId }) => {
  const row = await DoctorBreak.findOneAndUpdate({ _id: breakId, doctor_id: doctorId, status: 'active' },
    { $set: { status: 'ended', ended_at: new Date() }, $unset: { active_key: 1 } }, { returnDocument: 'after' });
  if (!row) throw fail(404, 'Active break not found');
  return { breakData: jsonRecord(row), appointments: await affected(doctorId, null) };
};
