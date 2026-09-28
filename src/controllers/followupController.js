import { FollowUp, WalkinAppointment } from '../models/clinicModels.js';
import Appointment from '../models/appointmentModel.js';
import User from '../models/userModel.js';
import { handle, doctorScope, pick, fail, jsonRecord, dateOnly, todayIST } from '../utils/clinicAccess.js';
const scope = req => doctorScope(req, req.body?.doctor_id || req.query?.doctor_id);
const fields = ['follow_up_type', 'reason', 'notes', 'status'];
function when(body) {
  const date = dateOnly(String(body.follow_up_date).slice(0, 10));
  const time = body.follow_up_time || '00:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw fail(400, 'Invalid follow_up_time');
  return new Date(date + 'T' + time + ':00+05:30');
}
async function validatePatient(doctor_id, patient_id, appointment_id) {
  if (!patient_id || !await User.exists({ _id: patient_id, role: 'user' })) throw fail(404, 'Patient not found');
  const filter = { patient: patient_id, counselor: doctor_id, ...(appointment_id ? { _id: appointment_id } : {}) };
  if (!await Appointment.exists(filter) && !await WalkinAppointment.exists({ doctor_id, patient_id })) throw fail(403, 'Patient is not linked to this doctor');
}
export const createFollowUp = handle(async (req, res) => {
  const doctor_id = await scope(req);
  await validatePatient(doctor_id, req.body.patient_id, req.body.appointment_id);
  const row = await FollowUp.create({ ...pick(req.body, fields), doctor_id, patient_id: req.body.patient_id,
    appointment_id: req.body.appointment_id || undefined, follow_up_date: when(req.body), follow_up_type: req.body.type || req.body.follow_up_type });
  res.status(201).json({ success: true, message: 'Follow-up created successfully', id: String(row._id), data: jsonRecord(row) });
});
const list = today => handle(async (req, res) => {
  const filter = { doctor_id: await scope(req) };
  if (today) {
    const start = new Date(todayIST() + 'T00:00:00+05:30');
    filter.follow_up_date = { $gte: start, $lt: new Date(start.getTime() + 86400000) };
  }
  const rows = await FollowUp.find(filter).populate('patient_id', 'fullName age phoneNumber').populate('doctor_id', 'fullName').sort({ follow_up_date: -1 }).lean();
  res.json(rows.map(r => ({ ...jsonRecord(r), patient_name: r.patient_id?.fullName || r.patient_name, doctor_name: r.doctor_id?.fullName })));
});
export const getAllFollowUps = list(false);
export const getTodayFollowUps = list(true);
export const getFollowUpById = handle(async (req, res) => {
  const row = await FollowUp.findOne({ _id: req.params.id, doctor_id: await scope(req) }).lean();
  if (!row) throw fail(404, 'Follow-up not found');
  res.json(jsonRecord(row));
});
export const updateFollowUp = handle(async (req, res) => {
  const doctor_id = await scope(req);
  const data = pick(req.body, fields);
  if (req.body.follow_up_date) data.follow_up_date = when(req.body);
  const row = await FollowUp.findOneAndUpdate({ _id: req.params.id, doctor_id }, { $set: data }, { returnDocument: 'after', runValidators: true });
  if (!row) throw fail(404, 'Follow-up not found');
  res.json({ success: true, message: 'Follow-up updated successfully', data: jsonRecord(row) });
});
export const deleteFollowUp = handle(async (req, res) => {
  const row = await FollowUp.findOneAndDelete({ _id: req.params.id, doctor_id: await scope(req) });
  if (!row) throw fail(404, 'Follow-up not found');
  res.json({ success: true, message: 'Follow-up deleted successfully' });
});
