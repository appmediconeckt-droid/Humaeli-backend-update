import { createHash } from "node:crypto";
import DateRange from "../models/dateRangeModel.js";
import UnavailableDate from "../models/unavailableDateModel.js";
import Appointment from "../models/appointmentModel.js";
import WalkinAppointment from "../models/walkinAppointmentModel.js";
import { getPool } from "../config/mysql.js";

export const slotError = (message, status = 422) => Object.assign(new Error(message), { status });
export const timeMinutes = (value) => {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})(?::00)?\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > (match[3] ? 12 : 23) || (match[3] && hour < 1)) return null;
  if (match[3]) hour = hour % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0);
  return hour * 60 + minute;
};
const clockTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`;
export const indiaDateTime = (value = new Date()) => {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw slotError("Invalid appointment date");
  const local = new Date(instant.getTime() + 330 * 60000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 19) };
};

export const buildDaySlots = (ranges, date) => {
  const day = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) {
    throw slotError("Invalid appointment date");
  }
  const slots = new Map();
  for (const range of ranges) {
    if (range.is_unavailable === true || Number(range.is_unavailable) === 1) continue;
    const specificDate = String(range.availability_date || range.date || "").slice(0, 10);
    const applies = specificDate ? specificDate === date
      : range.weekday !== null && range.weekday !== undefined && range.weekday !== "" && Number(range.weekday) === day.getUTCDay();
    if (!applies) continue;
    const start = timeMinutes(range.start_time);
    const end = timeMinutes(range.end_time);
    const duration = Number(range.slot_duration);
    if (start === null || end === null || !Number.isInteger(duration) || duration < 1 || end <= start) continue;
    for (let minute = start; minute + duration <= end; minute += duration) {
      const slot = slots.get(minute) || { minutes: minute, time: clockTime(minute), clinicIds: [] };
      const clinic = String(range.clinic_id || "");
      if (!slot.clinicIds.includes(clinic)) slot.clinicIds.push(clinic);
      slots.set(minute, slot);
    }
  }
  return [...slots.values()].sort((a, b) => a.minutes - b.minutes)
    .map((slot, index) => ({ ...slot, token: index + 1, date }));
};

export const slotRepository = {
  connection: () => getPool().getConnection(),
  ranges: (doctorId) => DateRange.find({ doctor_id: doctorId }),
  unavailable: (doctorId, date) => UnavailableDate.findOne({ doctor_id: doctorId, unavailable_date: date }),
  online: (doctorId, date) => Appointment.find({ counselor: doctorId, $or: [
    { appointment_date: date },
    { date: { $gte: new Date(`${date}T00:00:00+05:30`), $lt: new Date(new Date(`${date}T00:00:00+05:30`).getTime() + 86400000) } },
  ] }),
  walkins: (doctorId, date) => WalkinAppointment.find({ doctor_id: doctorId, appointment_date: date }),
};

// One lock shared by both booking paths prevents simultaneous requests from
// reserving the same doctor/time. The dedicated connection owns the lock.
export const withAppointmentSlot = async ({ doctorId, date, time, clinicId, earliestTime = null, excludeWalkinId = null }, create) => {
  buildDaySlots([], date); // Validate before database access.
  const minute = time ? timeMinutes(time) : null;
  if (time && minute === null) throw slotError("Invalid appointment time");
  const connection = await slotRepository.connection();
  const key = `appointment:${createHash("sha256").update(`${doctorId}:${date}`).digest("hex").slice(0, 48)}`;
  let locked = false;
  try {
    const [lock] = await connection.query("SELECT GET_LOCK(?, 5) AS acquired", [key]);
    locked = Number(lock[0]?.acquired) === 1;
    if (!locked) throw slotError("Booking is busy. Please try again.", 409);
    if (await slotRepository.unavailable(doctorId, date)) throw slotError("Doctor is unavailable on this date");
    const ranges = await slotRepository.ranges(doctorId);
    const blockedClinics = new Set(ranges.filter(range => (range.is_unavailable === true || Number(range.is_unavailable) === 1)
      && String(range.availability_date || range.date || "").slice(0, 10) === date).map(range => String(range.clinic_id || "")));
    if (blockedClinics.has("") || (clinicId && blockedClinics.has(String(clinicId)))) {
      throw slotError("Doctor is unavailable at this clinic on this date");
    }
    // Keep token numbering stable while excluding blocked clinics from booking.
    const slots = buildDaySlots(ranges, date).map(slot => ({ ...slot, clinicIds: slot.clinicIds.filter(id => !blockedClinics.has(id)) }))
      .filter(slot => slot.clinicIds.length);
    const eligible = slots.filter((slot) => !clinicId || slot.clinicIds.includes(String(clinicId)) || slot.clinicIds.includes(""));
    const [online, walkins] = await Promise.all([slotRepository.online(doctorId, date), slotRepository.walkins(doctorId, date)]);
    const occupied = new Set([...online, ...walkins.filter((record) => !excludeWalkinId || String(record.id || record._id) !== String(excludeWalkinId))].filter((record) => {
      if (String(record.priority || "").toLowerCase() === "emergency" && !record.appointment_time) return false;
      return !["cancelled", "canceled", "rejected", "reject"].includes(String(record.appointment_status || record.status || "").toLowerCase());
    }).map((record) => timeMinutes(record.appointment_time || (record.date ? indiaDateTime(record.date).time : ""))));
    const selected = time ? eligible.find((slot) => slot.minutes === minute)
      : eligible.find((slot) => (earliestTime === null || slot.minutes >= earliestTime) && !occupied.has(slot.minutes));
    if (!selected) throw slotError("No matching availability slot. Please choose an available date and time.");
    if (occupied.has(selected.minutes)) throw slotError("This slot is already booked. Please choose another time.", 409);
    return await create({ ...selected, clinicId: clinicId || selected.clinicIds.find(Boolean) || "" });
  } finally {
    try { if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [key]); }
    finally { connection.release(); }
  }
};
