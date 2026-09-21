import { Clinic, Availability, UnavailableDate } from '../models/clinicModels.js';
import User from '../models/userModel.js';
import mongoose from '../persistence/mongoose.js';
import { doctorScope, handle, fail, jsonRecord, dateOnly, bool, todayIST } from '../utils/clinicAccess.js';
const format = row => ({ ...jsonRecord(row), date: row.availability_date || null,
  recurrence: row.availability_date ? 'date' : 'weekly',
  time_period: Number(row.start_time.slice(0, 2)) < 12 ? 'morning' : Number(row.start_time.slice(0, 2)) < 17 ? 'afternoon' : 'evening' });
const scope = req => doctorScope(req, req.body?.doctor_id || req.query?.doctor_id);
const clinicId = value => {
  if (typeof value !== 'string' || !mongoose.isObjectIdOrHexString(value.trim())) {
    throw Object.assign(fail(400, 'clinic_id must be the clinic id returned by GET /api/clinics. Do not send a list position or numeric ID such as 1.'),
      { code: 'INVALID_CLINIC_ID', field: 'clinic_id' });
  }
  return value.trim();
};
async function payload(req) {
  const b = req.body;
  const clinic = await Clinic.findById(clinicId(b.clinic_id));
  if (!clinic) throw fail(404, 'Clinic not found');
  const doctor_id = await doctorScope(req, clinic.doctor_id);
  const date = b.date ? dateOnly(b.date) : null;
  if (date && date < todayIST()) throw fail(400, 'Cannot add past time slots');
  const weekday = date ? new Date(date + 'T00:00:00Z').getUTCDay() : Number(b.weekday);
  if ((b.weekday === undefined && !date) || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw fail(400, 'date or weekday (0-6) is required');
  const time = value => {
    if (!/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(String(value))) throw fail(400, 'Time must be HH:mm');
    return value.slice(0, 5);
  };
  const start_time = time(b.start_time), end_time = time(b.end_time);
  const slot_duration = Number(b.slot_duration ?? 15);
  if (start_time >= end_time || !Number.isInteger(slot_duration) || slot_duration < 1 || slot_duration > 1440) throw fail(400, 'Invalid time range or slot duration');
  return { doctor_id, clinic_id: clinic._id, availability_date: date, weekday, start_time, end_time, slot_duration, is_unavailable: bool(b.is_unavailable) };
}
const read = availableOnly => handle(async (req, res) => {
  const clinic_id = req.query.clinic_id !== undefined ? clinicId(req.query.clinic_id) : undefined;
  let doctor_id;
  if (availableOnly && req.query.doctor_id) {
    doctor_id = req.query.doctor_id;
    if (!await User.exists({ _id: doctor_id, role: 'doctor', isActive: true })) throw fail(404, 'Doctor not found');
  } else {
    if (!req.user) throw fail(400, 'doctor_id is required');
    doctor_id = await scope(req);
  }
  if (clinic_id && !await Clinic.exists({ _id: clinic_id, doctor_id })) throw fail(404, 'Clinic not found for this doctor');
  const [rows, excluded] = await Promise.all([
    Availability.find({ doctor_id, ...(clinic_id ? { clinic_id } : {}), ...(availableOnly ? { is_unavailable: false } : {}) }).sort({ weekday: 1, start_time: 1 }).lean(),
    UnavailableDate.find({ doctor_id }).lean(),
  ]);
  res.json({ success: true, [availableOnly ? 'availableRanges' : 'existingRanges']: rows.map(format), unavailableDates: excluded.map(r => r.unavailable_date) });
});
export default {
  getAllRanges: read(false), getAvailableDates: read(true),
  addDateRange: handle(async (req, res) => {
    const row = await Availability.create(await payload(req));
    res.status(201).json({ success: true, rangeId: String(row._id), range: format(row) });
  }),
  updateDateRange: handle(async (req, res) => {
    const row = await Availability.findById(req.params.id);
    if (!row) throw fail(404, 'Availability not found');
    await doctorScope(req, row.doctor_id);
    const data = await payload(req);
    if (String(row.doctor_id) !== String(data.doctor_id)) throw fail(403, 'Cannot transfer availability');
    Object.assign(row, data); await row.save();
    res.json({ success: true, range: format(row) });
  }),
  deleteDateRange: handle(async (req, res) => {
    const doctor_id = await scope(req);
    const row = await Availability.findOneAndDelete({ _id: req.params.id, doctor_id });
    if (!row) throw fail(404, 'Availability not found');
    res.json({ success: true });
  }),
  markDateUnavailable: handle(async (req, res) => {
    const doctor_id = await scope(req), unavailable_date = dateOnly(req.body.date);
    if (unavailable_date < todayIST()) throw fail(400, 'Cannot mark a past date');
    await UnavailableDate.findOneAndUpdate({ doctor_id, unavailable_date }, { $set: { doctor_id, unavailable_date } }, { upsert: true, returnDocument: 'after', runValidators: true });
    res.json({ success: true });
  }),
  clearDateRange: handle(async (req, res) => {
    const doctor_id = await scope(req), date = dateOnly(req.body.date);
    await UnavailableDate.deleteMany({ doctor_id, unavailable_date: date });
    await Availability.deleteMany({ doctor_id, availability_date: date, is_unavailable: true });
    res.json({ success: true });
  }),
  clearAllUnavailableDates: handle(async (req, res) => {
    const doctor_id = await scope(req);
    await UnavailableDate.deleteMany({ doctor_id });
    await Availability.deleteMany({ doctor_id, is_unavailable: true });
    res.json({ success: true });
  }),
};

