import { Clinic, Availability, UnavailableDate } from '../models/clinicModels.js';
import LegacyDateRange from '../models/dateRangeModel.js';
import LegacyUnavailableDate from '../models/unavailableDateModel.js';
import LegacyClinic from '../models/clinicModel.js';
import User from '../models/userModel.js';
import mongoose from '../persistence/mongoose.js';
import { buildDaySlots, indiaDateTime } from '../services/appointmentSlotService.js';
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

const legacyUnavailableDatesFor = async (doctorId, clinicId, existingRanges = null) => {
  const filter = { doctor_id: doctorId, is_unavailable: true };
  if (clinicId && clinicId !== 'all') filter.clinic_id = String(clinicId);
  const [globalDates, clinicDates] = await Promise.all([
    LegacyUnavailableDate.find({ doctor_id: doctorId }),
    existingRanges
      ? existingRanges.filter(range => range.is_unavailable === true || Number(range.is_unavailable) === 1)
      : LegacyDateRange.find(filter),
  ]);
  return [
    ...globalDates.map(record => ({ date: record.unavailable_date, scope: 'all' })),
    ...clinicDates.map(record => ({ date: record.availability_date, clinic_id: record.clinic_id })),
  ];
};

export const getAvailableRanges = async (req, res) => {
  try {
    const doctorId = req.query.doctor_id || req.query.doctorId || req.userId || req.user?._id;
    const clinicId = req.query.clinic_id || req.query.clinicId;
    const filter = { doctor_id: doctorId, is_unavailable: 0 };
    if (clinicId && clinicId !== 'all') filter.clinic_id = clinicId;
    const ranges = await LegacyDateRange.find(filter);
    const unavailableDates = await legacyUnavailableDatesFor(doctorId, clinicId);
    return res.status(200).json({ success: true, data: ranges, ranges, existingRanges: ranges, unavailableDates });
  } catch (error) {
    console.error('Error fetching available ranges:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch available ranges', error: error.message });
  }
};

export const getAvailabilityRanges = async (req, res) => {
  try {
    const doctorId = req.query.doctor_id || req.query.doctorId || req.userId || req.user?._id || req.user?.id;
    const clinicId = req.query.clinic_id || req.query.clinicId;
    if (!doctorId) {
      return res.status(200).json({ success: true, data: [], ranges: [], existingRanges: [], unavailableDates: [] });
    }
    const filter = { doctor_id: doctorId };
    if (clinicId && clinicId !== "all") filter.clinic_id = clinicId;
    const ranges = await LegacyDateRange.find(filter).sort({ createdAt: -1 });
    const unavailableDates = await legacyUnavailableDatesFor(doctorId, clinicId, ranges);
    return res.status(200).json({
      success: true,
      data: ranges,
      ranges,
      existingRanges: ranges,
      unavailableDates,
      unavailable_dates: unavailableDates,
      count: ranges.length,
    });
  } catch (error) {
    console.error("Error fetching availability ranges:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch availability ranges", error: error.message });
  }
};

const changeUnavailableDate = async (req, res, blocked) => {
  try {
    const doctorId = req.userId || req.user?._id;
    const requestedDoctor = req.body?.doctor_id || req.body?.doctorId;
    if (!doctorId) return res.status(401).json({ success: false, message: 'Authentication required' });
    if (requestedDoctor && String(requestedDoctor) !== String(doctorId)) {
      return res.status(403).json({ success: false, message: "Cannot change another doctor's availability" });
    }
    const date = req.body?.date || req.body?.unavailable_date;
    try { buildDaySlots([], date); } catch {
      return res.status(400).json({ success: false, message: 'A valid date is required' });
    }
    if (date < indiaDateTime().date) return res.status(400).json({ success: false, message: 'Cannot change past dates' });
    const clinicId = req.body?.clinic_id;
    if (!clinicId) return res.status(400).json({ success: false, message: 'Select a clinic' });
    const clinic = await LegacyClinic.findOne({ _id: String(clinicId), doctor_id: doctorId });
    if (!clinic) return res.status(403).json({ success: false, message: 'Clinic does not belong to this doctor' });
    const filter = { doctor_id: doctorId, clinic_id: String(clinicId), availability_date: date, is_unavailable: true };
    if (blocked) {
      if (!await LegacyDateRange.findOne(filter)) {
        await LegacyDateRange.create({ ...filter, weekday: null, start_time: '00:00:00', end_time: '23:59:00', slot_duration: 15 });
      }
    } else {
      const globalDate = await LegacyUnavailableDate.findOne({ doctor_id: doctorId, unavailable_date: date });
      if (globalDate && req.body?.scope !== 'all') {
        return res.status(409).json({ success: false, message: 'This date is unavailable at all clinics. Choose restore for all clinics.', code: 'GLOBAL_UNAVAILABLE' });
      }
      if (req.body?.scope === 'all') await LegacyUnavailableDate.deleteMany({ doctor_id: doctorId, unavailable_date: date });
      await LegacyDateRange.deleteMany(filter);
    }
    return res.json({ success: true, blocked, date, clinic_id: String(clinicId), message: blocked ? 'Clinic marked unavailable for this date' : 'Availability restored; saved timings preserved' });
  } catch (error) {
    console.error('Availability exception failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not update availability. Please try again.' });
  }
};

export const setUnavailableDate = (req, res) => changeUnavailableDate(req, res, true);
export const removeUnavailableDate = (req, res) => changeUnavailableDate(req, res, false);

export const clearAllRanges = async (req, res) => {
  try {
    const doctorId = req.userId || req.user?._id;
    const requestedDoctor = req.body?.doctor_id;
    if (requestedDoctor && String(requestedDoctor) !== String(doctorId)) {
      return res.status(403).json({ success: false, message: "Cannot clear another doctor's availability" });
    }
    const clinicId = req.body?.clinic_id;
    const filter = { doctor_id: doctorId };
    if (clinicId && clinicId !== "all") filter.clinic_id = String(clinicId);
    await LegacyDateRange.deleteMany(filter);
    if (!clinicId || clinicId === "all") {
      await LegacyUnavailableDate.deleteMany({ doctor_id: doctorId });
    }
    return res.json({ success: true, message: "Availability cleared successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to clear availability" });
  }
};

const availabilityController = {
  getAllRanges: getAvailabilityRanges, getAvailableDates: read(true), getAvailableRanges, getAvailabilityRanges, setUnavailableDate, removeUnavailableDate, clearAllRanges,
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

export default availabilityController;
