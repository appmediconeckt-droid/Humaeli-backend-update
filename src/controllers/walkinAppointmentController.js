import { WalkinAppointment, FollowUp } from '../models/clinicModels.js';
import User from '../models/userModel.js';
import { nextAppointmentToken, getCurrentDatabaseDateTime } from '../services/appointmentTokenService.js';
import { normalizeDateOfBirth } from '../services/patientDateOfBirthService.js';
import { normalizeBookingSource } from '../services/doctorAnalyticsService.js';
import { getActiveBreakDelayForAppointment } from '../services/doctorBreakService.js';
import { withAppointmentBooking, bookingMinute } from '../services/appointmentConflictService.js';
import { handle, doctorScope, pick, fail, jsonRecord, bool, dateOnly } from '../utils/clinicAccess.js';
const scope = req => doctorScope(req, req.query?.doctor_id || req.body?.doctor_id);
export const createWalkinAppointment = handle(async (req, res) => {
  const b = req.body || {};
  const doctor_id = b.doctor_id ?? b.doctorId;
  if (!await User.exists({ _id: doctor_id, role: 'doctor', isActive: true })) throw fail(404, 'Doctor not found');
  const patient_name = b.patient_name ?? b.full_name;
  const phone_number = String(b.phone_number ?? b.phone ?? b.contact_number ?? '').trim();
  if (!patient_name || !/^\+?[\d ()-]{7,20}$/.test(phone_number) || !b.symptoms) throw fail(400, 'patient_name, valid phone_number and symptoms are required');
  const dob = normalizeDateOfBirth(b.date_of_birth ?? b.dob);
  const current = await getCurrentDatabaseDateTime();
  const requestedDate = b.appointment_date ?? b.appointmentDate;
  const requestedTime = b.appointment_time ?? b.appointmentTime;
  if ((requestedDate === undefined) !== (requestedTime === undefined)) throw fail(400, 'appointment_date and appointment_time must be provided together');
  const appointment_date = dateOnly(requestedDate ?? current.appointment_date);
  const appointment_time = bookingMinute(requestedTime ?? current.appointment_time) + ':00';
  const row = await withAppointmentBooking({ doctorId: doctor_id, phoneNumber: phone_number,
    appointmentDate: appointment_date, appointmentTime: appointment_time }, async () => {
    const token_number = await nextAppointmentToken(doctor_id, appointment_date);
    // Public intake never creates a verified login or overwrites an existing patient.
    return WalkinAppointment.create({ doctor_id, patient_name, phone_number, symptoms: b.symptoms,
      gender: b.gender || undefined, date_of_birth: dob.provided ? dob.value : undefined,
      appointment_date, appointment_time, token_number, booking_source: normalizeBookingSource(b.booking_source ?? b.source ?? req.query?.source) });
  });
  const token_number = row.token_number;
  res.status(201).json({ success: true, message: 'Walk-in appointment created', id: String(row._id),
    doctor_id: String(doctor_id), tokenNumber: token_number, token_number, appointmentDate: appointment_date,
    appointmentTime: appointment_time, bookingSource: row.booking_source, booking_source: row.booking_source, date_of_birth: dob.value });
});
const enrich = async row => ({ ...jsonRecord(row), ...await getActiveBreakDelayForAppointment(row.doctor_id,
  new Date(row.appointment_date + 'T' + row.appointment_time + '+05:30')) });
export const getWalkinAppointments = handle(async (req, res) => {
  const doctor_id = await scope(req);
  const rows = await WalkinAppointment.find({ doctor_id, ...(req.query.date ? { appointment_date: dateOnly(req.query.date) } : {}) }).sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: await Promise.all(rows.map(enrich)), total: rows.length });
});
export const getWalkinAppointmentById = handle(async (req, res) => {
  const row = await WalkinAppointment.findOne({ _id: req.params.id, doctor_id: await scope(req) }).lean();
  if (!row) throw fail(404, 'Walk-in appointment not found');
  res.json({ success: true, data: await enrich(row) });
});
export const updateWalkinAppointment = handle(async (req, res) => {
  const row = await WalkinAppointment.findOne({ _id: req.params.id, doctor_id: await scope(req) });
  if (!row) throw fail(404, 'Walk-in appointment not found');
  const data = pick(req.body, ['diagnosis', 'advice', 'additional_notes', 'symptoms']);
  if (req.body.status || req.body.appointment_status) data.appointment_status = req.body.status || req.body.appointment_status;
  const required = req.body.follow_up_required ?? req.body.followUpRequired;
  if (required !== undefined) data.follow_up_required = bool(required);
  const date = req.body.follow_up_date ?? req.body.followUpDate;
  if (data.follow_up_required && !date) throw fail(400, 'follow_up_date is required');
  if (date) data.follow_up_date = new Date(dateOnly(date) + 'T00:00:00+05:30');
  Object.assign(row, data);
  await row.validate();
  if (['cancelled', 'canceled', 'rejected'].includes(row.appointment_status)) await row.save();
  else await withAppointmentBooking({ doctorId: row.doctor_id, patientId: row.patient_id,
    phoneNumber: row.phone_number, appointmentDate: row.appointment_date,
    appointmentTime: row.appointment_time, excludeId: row._id }, () => row.save());
  if (data.follow_up_required) {
    await FollowUp.findOneAndUpdate({ walkin_id: row._id }, { $set: { doctor_id: row.doctor_id,
      patient_name: row.patient_name, follow_up_date: row.follow_up_date, reason: row.diagnosis, notes: row.additional_notes } },
      { upsert: true, returnDocument: 'after', runValidators: true });
  }
  res.json({ success: true, data: jsonRecord(row) });
});
export const deleteWalkinAppointment = handle(async (req, res) => {
  const filter = { _id: req.params.id, doctor_id: await scope(req) };
  if (await FollowUp.exists({ walkin_id: req.params.id })) throw fail(409, 'Remove the linked follow-up before deleting');
  const row = await WalkinAppointment.findOneAndDelete(filter);
  if (!row) throw fail(404, 'Walk-in appointment not found');
  res.json({ success: true, message: 'Walk-in appointment deleted' });
});

