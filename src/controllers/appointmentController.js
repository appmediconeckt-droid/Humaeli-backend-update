// import Appointment from '../models/appointmentModel.js';
// import User from '../models/userModel.js';
// import { createNotificationSafely } from '../services/notificationService.js';
// import { getAnonymousUserName, sanitizeUserForCounselor } from '../utils/anonymousUser.js';
// import { nextAppointmentToken } from '../services/appointmentTokenService.js';
// import { getActiveBreakDelayForAppointment } from '../services/doctorBreakService.js';
// import { withAppointmentBooking } from '../services/appointmentConflictService.js';
// import { normalizeBookingSource } from '../services/doctorAnalyticsService.js';
// import { Clinic, Availability, UnavailableDate } from '../models/clinicModels.js';
// import { handle, doctorScope, actorId, fail, jsonRecord, pick, todayIST, dateOnly } from '../utils/clinicAccess.js';
// // Delete appointments that never became a completed/confirmed session once
// // their scheduled date/time is past. Support both American and British
// // cancellation spellings because older clients store both variants.
// const EXPIRED_UNRESOLVED_STATUS_PATTERN = /^(pending|rejected|reject|canceled|cancelled)$/i;

// // Pending/rejected/canceled appointments are no longer actionable once their
// // scheduled time has passed. deleteMany is idempotent, so it is safe to run
// // from both the recurring cleanup job and the appointments API request path.
// export const deleteExpiredUnresolvedAppointments = async () => {
//   const result = await Appointment.deleteMany({
//     // Existing records can contain "reject" / uppercase values from older
//     // UI versions, so keep this check case-insensitive and backward-safe.
//     status: EXPIRED_UNRESOLVED_STATUS_PATTERN,
//     date: { $lt: new Date() },
//   });

//   if (result.deletedCount > 0) {
//     console.log(
//       `Appointment cleanup: removed ${result.deletedCount} expired unresolved appointment(s)`,
//     );
//   }

//   return result.deletedCount;
// };

// // IST (India Standard Time) is UTC+5:30
// const IST_OFFSET = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds

// // Convert any date to IST
// const toIST = (date) => {
//   const utcDate = new Date(date);
//   return new Date(utcDate.getTime() + IST_OFFSET);
// };

// // Get start of day in IST
// const getStartOfDayIST = (date) => {
//   const istDate = toIST(date);
//   const startOfDay = new Date(istDate);
//   startOfDay.setHours(0, 0, 0, 0);
//   return new Date(startOfDay.getTime() - IST_OFFSET); // Convert back to UTC
// };

// // Get end of day in IST
// const getEndOfDayIST = (date) => {
//   const istDate = toIST(date);
//   const endOfDay = new Date(istDate);
//   endOfDay.setHours(23, 59, 59, 999);
//   return new Date(endOfDay.getTime() - IST_OFFSET); // Convert back to UTC
// };

// export const book = async (req, res) => {
//   try {
//     const counselorId = req.body.counselorId || req.body.doctor_id;
//     const date = req.body.date || (req.body.appointment_date && req.body.appointment_time
//       ? `${dateOnly(req.body.appointment_date)}T${req.body.appointment_time}+05:30` : undefined);
//     const { notes } = req.body;

//     // Basic validation
//     if (!counselorId || !date) {
//       return res
//         .status(400)
//         .json({ message: "counselorId and date are required" });
//     }

//     const appointmentDate = new Date(date);
//     if (Number.isNaN(appointmentDate.getTime())) {
//       return res.status(400).json({ message: "Invalid appointment date" });
//     }
//     if (appointmentDate.getTime() <= Date.now()) {
//       return res.status(400).json({
//         message: "Appointment date and time must be in the future",
//       });
//     }

//     const counselor = await User.findOne({
//       _id: counselorId,
//       role: { $in: ["counsellor", "doctor"] },
//       isActive: true,
//       profileCompleted: true,
//     }).select("_id");

//     if (!counselor) {
//       return res.status(404).json({
//         message: "Counselor not found or profile is not complete yet",
//       });
//     }

//     const localDate = new Date(appointmentDate.getTime() + 19800000).toISOString();
//     const appointment_date = localDate.slice(0, 10), appointment_time = localDate.slice(11, 19);
//     const clinic_id = req.body.clinic_id;
//     if (await UnavailableDate.exists({ doctor_id: counselorId, unavailable_date: appointment_date })) {
//       return res.status(409).json({ message: 'Doctor is unavailable on this date' });
//     }
//     if (clinic_id) {
//       if (!await Clinic.exists({ _id: clinic_id, doctor_id: counselorId })) return res.status(404).json({ message: 'Clinic not found for this doctor' });
//       const ranges = await Availability.find({ clinic_id }).lean();
//       const specific = ranges.filter(r => r.availability_date === appointment_date);
//       const applicable = specific.length ? specific : ranges.filter(r => !r.availability_date && r.weekday === new Date(appointment_date + 'T00:00:00Z').getUTCDay());
//       const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
//       if (appointment_time.slice(6) !== '00' || !applicable.some(r => !r.is_unavailable && appointment_time.slice(0, 5) >= r.start_time && minutes(appointment_time) + r.slot_duration <= minutes(r.end_time) && (minutes(appointment_time) - minutes(r.start_time)) % r.slot_duration === 0)) {
//         return res.status(409).json({ message: 'Requested clinic slot is unavailable' });
//       }
//     }
//     const appointment = await withAppointmentBooking({ doctorId: counselorId, patientId: req.user._id,
//       appointmentDate: appointment_date, appointmentTime: appointment_time }, async () => {
//       const token_number = await nextAppointmentToken(counselorId, appointment_date);
//       return Appointment.create({
//         patient: req.user._id, // `auth` middleware puts the logged‑in user on req.user
//         counselor: counselorId,
//         date: appointmentDate,
//         notes,
//         clinic_id, appointment_date, appointment_time, token_number,
//         slot_key: `${counselorId}:${appointmentDate.toISOString()}`,
//         booking_source: normalizeBookingSource(req.body.booking_source || req.body.source),
//         symptoms: req.body.symptoms,
//       });
//     });

//     // Notify the counselor via socket if global.io exists
//     if (global.io) {
//       const targetRooms = [
//         `user_${counselorId}`,
//         `counsellor_${counselorId}`,
//         `counselor_${counselorId}`,
//       ];
//       targetRooms.forEach((room) => {
//         global.io.to(room).emit("appointmentBooked", appointment);
//       });
//     }

//     await createNotificationSafely({
//       recipientId: counselorId,
//       actorId: req.user._id,
//       type: "appointment",
//       title: "New appointment request",
//       message: `${getAnonymousUserName(req.user)} requested an appointment for ${new Date(date).toLocaleString("en-IN")}.`,
//       data: { appointmentId: appointment._id, status: appointment.status, date },
//       actionUrl: "/counselor/appointments",
//     });

//     return res.status(201).json(appointment);
//   } catch (err) {
//     console.error("❌ book appointment error", err);
//     return res.status(err.code === 11000 ? 409 : err.statusCode || (['ValidationError', 'CastError'].includes(err.name) ? 400 : 500)).json({ message: err.code === 11000 ? 'Appointment slot is already booked' : err.statusCode ? err.message : 'Unable to book appointment', ...(err.code === 'DUPLICATE_APPOINTMENT' ? { code: err.code } : {}) });
//   }
// };

// export const getAppointments = async (req, res) => {
//   try {
//     await deleteExpiredUnresolvedAppointments();

//     const userId = req.user._id;
//     const { filter, date } = req.query;

//     let dateFilter = {};
//     const now = new Date();

//     // ✅ DATE-WISE FILTER (NEW) - WITH IST TIMEZONE
//     if (date) {
//       const selectedDate = new Date(date);
//       const startOfDay = getStartOfDayIST(selectedDate);
//       const endOfDay = getEndOfDayIST(selectedDate);

//       dateFilter = {
//         date: { $gte: startOfDay, $lte: endOfDay },
//       };
//     }

//     // ✅ EXISTING FILTERS - WITH IST TIMEZONE
//     else if (filter === "today") {
//       const startOfDay = getStartOfDayIST(now);
//       const endOfDay = getEndOfDayIST(now);

//       dateFilter = {
//         date: { $gte: startOfDay, $lte: endOfDay },
//       };
//     } else if (filter === "last7days") {
//       const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
//       const startOfDay = getStartOfDayIST(sevenDaysAgo);

//       dateFilter = {
//         date: { $gte: startOfDay, $lte: getEndOfDayIST(now) },
//       };
//     }

//     const appointments = await Appointment.find({
//       $or: [{ patient: userId }, { counselor: userId }],
//       ...dateFilter,
//     })
//       .populate("patient", "fullName profilePhoto anonymous")
//       .populate("counselor", "fullName profilePhoto anonymous")
//       .sort({ date: -1 })
//       .lean();

//     if (["counsellor", "doctor"].includes(req.user.role)) {
//       return res.json(
//         appointments.map((appointment) => ({
//           ...appointment,
//           patient: sanitizeUserForCounselor(
//             appointment.patient,
//             appointment.patient?._id || appointment.patient,
//           ),
//         })),
//       );
//     }

//     return res.json(appointments);
//   } catch (err) {
//     console.error("❌ get appointments error", err);
//     return res.status(500).json({ message: "Server error" });
//   }
// };

// export const updateStatus = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const rawStatus = req.body.status;
//     const status = rawStatus === 'cancelled' ? 'canceled' : rawStatus;
//     const userId = req.user._id;

//     const appointment = await Appointment.findById(id);
//     if (!appointment) {
//       return res.status(404).json({ message: "Appointment not found" });
//     }

//     // Basic authorization: user must be either patient or counselor
//     if (
//       appointment.patient.toString() !== userId.toString() &&
//       appointment.counselor.toString() !== userId.toString()
//     ) {
//       return res.status(403).json({ message: "Unauthorized" });
//     }

//     if (
//       String(status).toLowerCase() === "confirmed" &&
//       new Date(appointment.date).getTime() <= Date.now()
//     ) {
//       return res.status(400).json({
//         message: "A past appointment cannot be confirmed or booked",
//       });
//     }

//     appointment.status = status;
//     if (['canceled', 'rejected'].includes(status)) appointment.slot_key = undefined;
//     else appointment.slot_key = `${appointment.counselor}:${new Date(appointment.date).toISOString()}`;
//     await saveOnlineAppointment(appointment);

//     await createNotificationSafely({
//       recipientId: appointment.patient,
//       actorId: req.user._id,
//       type: "appointment",
//       title: `Appointment ${status}`,
//       message: `Your appointment request has been ${status}.`,
//       data: { appointmentId: appointment._id, status, date: appointment.date },
//       actionUrl: "/appointments",
//     });

//     return res.json({
//       message: `Appointment ${status} successfully`,
//       appointment,
//     });
//   } catch (err) {
//     console.error("❌ update status error", err);
//     return res.status(err.code === 11000 ? 409 : err.statusCode || (['ValidationError', 'CastError'].includes(err.name) ? 400 : 500)).json({ message: err.code === 11000 ? 'Appointment slot is already booked' : err.statusCode ? err.message : 'Unable to update appointment status' });
//   }
// };




// const appointmentView = async row => ({
//   ...jsonRecord(row), patient_id: row.patient, doctor_id: row.counselor,
//   appointment_status: row.status, ...await getActiveBreakDelayForAppointment(row.counselor, row.date),
// });
// export const createAppointment = handle(async (req, res) => {
//   if (req.user.role === 'user') return book(req, res);
//   const doctor_id = await doctorScope(req, req.body.doctor_id || req.body.counselorId);
//   const patient = await User.findOne({ _id: req.body.patient_id, role: 'user', isActive: true });
//   if (!patient) throw fail(404, 'Patient not found');
//   return book({ ...req, user: { _id: patient._id }, body: { ...req.body, counselorId: doctor_id } }, res);
// });
// async function filterFor(req) {
//   return req.user.role === 'user' ? { patient: actorId(req) } : { counselor: await doctorScope(req, req.query?.doctor_id || req.body?.doctor_id) };
// }
// export const getAppointmentAll = handle(async (req, res) => {
//   const filter = await filterFor(req);
//   if (req.query.patient_id) filter.patient = req.user.role === 'user' ? actorId(req) : req.query.patient_id;
//   if (req.query.date) filter.appointment_date = dateOnly(req.query.date);
//   const rows = await Appointment.find(filter).sort({ date: -1 }).lean();
//   res.json({ success: true, appointments: await Promise.all(rows.map(appointmentView)) });
// });
// export const getAppointmentById = handle(async (req, res) => {
//   const row = await Appointment.findOne({ ...await filterFor(req), _id: req.params.id }).lean();
//   if (!row) throw fail(404, 'Appointment not found');
//   res.json({ success: true, appointment: await appointmentView(row) });
// });
// export const getAppointmentsByPatientId = handle(async (req, res) => {
//   const patient_id = req.params.patientId || req.params.patient_id;
//   if (req.user.role === 'user' && patient_id !== actorId(req)) throw fail(403, 'Access denied');
//   req.query.patient_id = patient_id;
//   return getAppointmentAll(req, res);
// });
// export const getTodayAppointments = handle(async (req, res) => {
//   req.query.date = todayIST();
//   return getAppointmentAll(req, res);
// });
// export const searchAppointment = getAppointmentAll;
// export const nurseCheckIn = handle(async (req, res) => {
//   const counselor = await doctorScope(req, req.body.doctor_id);
//   const row = await Appointment.findOneAndUpdate({ _id: req.params.id, counselor, status: { $in: ['pending', 'confirmed'] } },
//     { $set: { status: 'confirmed', checked_in_at: new Date(), vitals: pick(req.body, ['blood_pressure', 'temperature', 'pulse', 'weight', 'height', 'spo2']) } },
//     { returnDocument: 'after', runValidators: true });
//   if (!row) throw fail(404, 'Active appointment not found');
//   res.json({ success: true, appointment: await appointmentView(row) });
// });
// export const updateAppointment = handle(async (req, res) => {
//   const counselor = await doctorScope(req, req.body.doctor_id);
//   const row = await Appointment.findOne({ _id: req.params.id, counselor });
//   if (!row) throw fail(404, 'Appointment not found');
//   Object.assign(row, pick(req.body, ['notes', 'diagnosis', 'advice', 'patient_location', 'consultation_mode']));
//   const requested = req.body.status || req.body.appointment_status;
//   if (requested) row.status = requested === 'cancelled' ? 'canceled' : requested;
//   if (['canceled', 'rejected'].includes(row.status)) row.slot_key = undefined;
//   else row.slot_key = String(row.counselor) + ':' + new Date(row.date).toISOString();
//   await saveOnlineAppointment(row);
//   res.json({ success: true, appointment: await appointmentView(row) });
// });
// export const deleteAppointment = handle(async (req, res) => {
//   const row = await Appointment.findOneAndDelete({ ...await filterFor(req), _id: req.params.id });
//   if (!row) throw fail(404, 'Appointment not found');
//   res.json({ success: true, message: 'Appointment deleted' });
// });

// async function saveOnlineAppointment(row) {
//   if (['canceled', 'rejected'].includes(row.status)) return row.save();
//   const local = new Date(new Date(row.date).getTime() + 19800000).toISOString();
//   return withAppointmentBooking({ doctorId: row.counselor, patientId: row.patient,
//     appointmentDate: local.slice(0, 10), appointmentTime: local.slice(11, 19), excludeId: row._id }, () => row.save());
// }



import Appointment from '../models/appointmentModel.js';
import User from '../models/userModel.js';
import { createNotificationSafely } from '../services/notificationService.js';
import { getAnonymousUserName, sanitizeUserForCounselor } from '../utils/anonymousUser.js';
import { nextAppointmentToken } from '../services/appointmentTokenService.js';
import { getActiveBreakDelayForAppointment } from '../services/doctorBreakService.js';
import { withAppointmentBooking } from '../services/appointmentConflictService.js';
import { normalizeBookingSource } from '../services/doctorAnalyticsService.js';
import { getConsultationTiming, emitQueueUpdated as emitTimingQueueUpdated } from '../services/consultationTimingService.js';
import { Clinic, Availability, UnavailableDate } from '../models/clinicModels.js';
import { handle, doctorScope, actorId, fail, jsonRecord, pick, todayIST, dateOnly } from '../utils/clinicAccess.js';
// Delete appointments that never became a completed/confirmed session once
// their scheduled date/time is past. Support both American and British
// cancellation spellings because older clients store both variants.
const EXPIRED_UNRESOLVED_STATUS_PATTERN = /^(pending|rejected|reject|canceled|cancelled)$/i;

// Pending/rejected/canceled appointments are no longer actionable once their
// scheduled time has passed. deleteMany is idempotent, so it is safe to run
// from both the recurring cleanup job and the appointments API request path.
export const deleteExpiredUnresolvedAppointments = async () => {
  const result = await Appointment.deleteMany({
    // Existing records can contain "reject" / uppercase values from older
    // UI versions, so keep this check case-insensitive and backward-safe.
    status: EXPIRED_UNRESOLVED_STATUS_PATTERN,
    date: { $lt: new Date() },
  });

  if (result.deletedCount > 0) {
    console.log(
      `Appointment cleanup: removed ${result.deletedCount} expired unresolved appointment(s)`,
    );
  }

  return result.deletedCount;
};

// IST (India Standard Time) is UTC+5:30
const IST_OFFSET = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds

// Convert any date to IST
const toIST = (date) => {
  const utcDate = new Date(date);
  return new Date(utcDate.getTime() + IST_OFFSET);
};

// Get start of day in IST
const getStartOfDayIST = (date) => {
  const istDate = toIST(date);
  const startOfDay = new Date(istDate);
  startOfDay.setHours(0, 0, 0, 0);
  return new Date(startOfDay.getTime() - IST_OFFSET); // Convert back to UTC
};

// Normalize appointment time from either 24-hour or 12-hour format.
// Supported examples: 16:30, 16:30:00, 4:30 PM, 04:30 PM
const normalizeAppointmentTime = (value) => {
  if (!value) return null;

  const time = String(value).trim();

  let match = time.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (match) {
    const hour = String(Number(match[1])).padStart(2, "0");
    const minute = match[2];
    const second = match[3] || "00";
    return `${hour}:${minute}:${second}`;
  }

  match = time.match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?\s*(AM|PM)$/i);
  if (match) {
    let hour = Number(match[1]);
    const minute = match[2];
    const second = match[3] || "00";
    const period = match[4].toUpperCase();

    if (hour < 1 || hour > 12) return null;
    if (period === "PM" && hour !== 12) hour += 12;
    if (period === "AM" && hour === 12) hour = 0;

    return `${String(hour).padStart(2, "0")}:${minute}:${second}`;
  }

  return null;
};

// Get end of day in IST
const getEndOfDayIST = (date) => {
  const istDate = toIST(date);
  const endOfDay = new Date(istDate);
  endOfDay.setHours(23, 59, 59, 999);
  return new Date(endOfDay.getTime() - IST_OFFSET); // Convert back to UTC
};

export const book = async (req, res) => {
  try {
    const counselorId = req.body.counselorId || req.body.doctor_id;
    const { notes } = req.body;

    // Prefer appointment_date + appointment_time because this is the format
    // used by the clinic/hospital booking flow. req.body.date is kept only
    // as a backwards-compatible fallback for older clients.
    let appointmentDate;

    if (req.body.appointment_date && req.body.appointment_time) {
      const normalizedDate = dateOnly(req.body.appointment_date);
      const normalizedTime = normalizeAppointmentTime(req.body.appointment_time);

      if (!normalizedDate || !normalizedTime) {
        return res.status(400).json({
          message: "Invalid appointment date or time",
          received: {
            appointment_date: req.body.appointment_date,
            appointment_time: req.body.appointment_time,
          },
        });
      }

      // The selected clinic time is interpreted as India Standard Time.
      appointmentDate = new Date(`${normalizedDate}T${normalizedTime}+05:30`);
    } else if (req.body.date) {
      appointmentDate = new Date(req.body.date);
    } else {
      return res.status(400).json({
        message: "appointment_date and appointment_time (or date) are required",
      });
    }

    if (!counselorId) {
      return res.status(400).json({
        message: "counselorId or doctor_id is required",
      });
    }

    if (!appointmentDate || Number.isNaN(appointmentDate.getTime())) {
      return res.status(400).json({ message: "Invalid appointment date" });
    }

    if (appointmentDate.getTime() <= Date.now()) {
      return res.status(400).json({
        message: "Appointment date and time must be in the future",
        debug: {
          selectedAppointment: appointmentDate.toISOString(),
          serverNow: new Date().toISOString(),
          appointment_date: req.body.appointment_date,
          appointment_time: req.body.appointment_time,
        },
      });
    }

    const counselor = await User.findOne({
      _id: counselorId,
      role: { $in: ["counsellor", "doctor"] },
      isActive: true,
      profileCompleted: true,
    }).select("_id");

    if (!counselor) {
      return res.status(404).json({
        message: "Counselor not found or profile is not complete yet",
      });
    }

    const localDate = new Date(appointmentDate.getTime() + 19800000).toISOString();
    const appointment_date = localDate.slice(0, 10), appointment_time = localDate.slice(11, 19);
    const clinic_id = req.body.clinic_id;
    if (await UnavailableDate.exists({ doctor_id: counselorId, unavailable_date: appointment_date })) {
      return res.status(409).json({ message: 'Doctor is unavailable on this date' });
    }
    if (clinic_id) {
      if (!await Clinic.exists({ _id: clinic_id, doctor_id: counselorId })) return res.status(404).json({ message: 'Clinic not found for this doctor' });
      const ranges = await Availability.find({ clinic_id }).lean();
      const specific = ranges.filter(r => r.availability_date === appointment_date);
      const applicable = specific.length ? specific : ranges.filter(r => !r.availability_date && r.weekday === new Date(appointment_date + 'T00:00:00Z').getUTCDay());
      const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
      if (appointment_time.slice(6) !== '00' || !applicable.some(r => !r.is_unavailable && appointment_time.slice(0, 5) >= r.start_time && minutes(appointment_time) + r.slot_duration <= minutes(r.end_time) && (minutes(appointment_time) - minutes(r.start_time)) % r.slot_duration === 0)) {
        return res.status(409).json({ message: 'Requested clinic slot is unavailable' });
      }
    }
    const appointment = await withAppointmentBooking({ doctorId: counselorId, patientId: req.user._id,
      appointmentDate: appointment_date, appointmentTime: appointment_time }, async () => {
      const token_number = await nextAppointmentToken(counselorId, appointment_date);
    return Appointment.create({
  patient: req.user._id,

  counselor: counselorId,

  date: appointmentDate,

  notes,

  clinic_id,

  appointment_date,

  appointment_time,

  token_number,

  slot_key: `${counselorId}:${appointmentDate.toISOString()}`,

  booking_source: normalizeBookingSource(
    req.body.booking_source || req.body.source
  ),

  symptoms: req.body.symptoms,

  // Queue
  queue_status: "booked",

  priority: "normal",
});
    });

    // Notify the counselor via socket if global.io exists
    if (global.io) {
      const targetRooms = [
        `user_${counselorId}`,
        `counsellor_${counselorId}`,
        `counselor_${counselorId}`,
      ];
      targetRooms.forEach((room) => {
        global.io.to(room).emit("appointmentBooked", appointment);
      });
    }

    await createNotificationSafely({
      recipientId: counselorId,
      actorId: req.user._id,
      type: "appointment",
      title: "New appointment request",
      message: `${getAnonymousUserName(req.user)} requested an appointment for ${appointmentDate.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.`,
      data: { appointmentId: appointment._id, status: appointment.status, date: appointmentDate },
      actionUrl: "/counselor/appointments",
    });

    return res.status(201).json(appointment);
  } catch (err) {
    console.error("❌ book appointment error", err);
    return res.status(err.code === 11000 ? 409 : err.statusCode || (['ValidationError', 'CastError'].includes(err.name) ? 400 : 500)).json({ message: err.code === 11000 ? 'Appointment slot is already booked' : err.statusCode ? err.message : 'Unable to book appointment', ...(err.code === 'DUPLICATE_APPOINTMENT' ? { code: err.code } : {}) });
  }
};

export const getAppointments = async (req, res) => {
  try {
    await deleteExpiredUnresolvedAppointments();

    const userId = req.user._id;
    const { filter, date } = req.query;

    let dateFilter = {};
    const now = new Date();

    // ✅ DATE-WISE FILTER (NEW) - WITH IST TIMEZONE
    if (date) {
      const selectedDate = new Date(date);
      const startOfDay = getStartOfDayIST(selectedDate);
      const endOfDay = getEndOfDayIST(selectedDate);

      dateFilter = {
        date: { $gte: startOfDay, $lte: endOfDay },
      };
    }

    // ✅ EXISTING FILTERS - WITH IST TIMEZONE
    else if (filter === "today") {
      const startOfDay = getStartOfDayIST(now);
      const endOfDay = getEndOfDayIST(now);

      dateFilter = {
        date: { $gte: startOfDay, $lte: endOfDay },
      };
    } else if (filter === "last7days") {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const startOfDay = getStartOfDayIST(sevenDaysAgo);

      dateFilter = {
        date: { $gte: startOfDay, $lte: getEndOfDayIST(now) },
      };
    }

    const appointments = await Appointment.find({
      $or: [{ patient: userId }, { counselor: userId }],
      ...dateFilter,
    })
      .populate("patient", "fullName profilePhoto anonymous")
      .populate("counselor", "fullName profilePhoto anonymous")
      .sort({ date: -1 })
      .lean();

    if (["counsellor", "doctor"].includes(req.user.role)) {
      return res.json(
        appointments.map((appointment) => ({
          ...appointment,
          patient: sanitizeUserForCounselor(
            appointment.patient,
            appointment.patient?._id || appointment.patient,
          ),
        })),
      );
    }

    return res.json(appointments);
  } catch (err) {
    console.error("❌ get appointments error", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const rawStatus = req.body.status;
    const status = rawStatus === "cancelled" ? "canceled" : rawStatus;
    const userId = req.user._id;

    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    if (
      appointment.patient.toString() !== userId.toString() &&
      appointment.counselor.toString() !== userId.toString()
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    if (
      String(status).toLowerCase() === "confirmed" &&
      new Date(appointment.date).getTime() <= Date.now()
    ) {
      return res.status(400).json({
        message: "A past appointment cannot be confirmed or booked",
      });
    }

    appointment.status = status;

    // Keep appointment status and live queue status in sync where appropriate.
    if (status === "completed") {
      appointment.queue_status = "completed";
      appointment.consultation_ended_at =
        appointment.consultation_ended_at || new Date();
    } else if (["canceled", "rejected"].includes(status)) {
      appointment.queue_status = "canceled";
      appointment.slot_key = undefined;
    } else {
      appointment.slot_key =
        `${appointment.counselor}:${new Date(appointment.date).toISOString()}`;
    }

    await saveOnlineAppointment(appointment);
    emitQueueUpdated(appointment.counselor, appointment.appointment_date);

    await createNotificationSafely({
      recipientId: appointment.patient,
      actorId: req.user._id,
      type: "appointment",
      title: `Appointment ${status}`,
      message: `Your appointment request has been ${status}.`,
      data: {
        appointmentId: appointment._id,
        status,
        queue_status: appointment.queue_status,
        date: appointment.date,
      },
      actionUrl: "/appointments",
    });

    return res.json({
      message: `Appointment ${status} successfully`,
      appointment,
    });
  } catch (err) {
    console.error("❌ update status error", err);
    return res
      .status(
        err.code === 11000
          ? 409
          : err.statusCode ||
            (["ValidationError", "CastError"].includes(err.name) ? 400 : 500),
      )
      .json({
        message:
          err.code === 11000
            ? "Appointment slot is already booked"
            : err.statusCode
              ? err.message
              : "Unable to update appointment status",
      });
  }
};



const appointmentView = async row => ({
  ...jsonRecord(row), patient_id: row.patient, doctor_id: row.counselor,
  appointment_status: row.status, ...await getActiveBreakDelayForAppointment(row.counselor, row.date),
});
export const createAppointment = handle(async (req, res) => {
  if (req.user.role === 'user') return book(req, res);
  const doctor_id = await doctorScope(req, req.body.doctor_id || req.body.counselorId);
  const patient = await User.findOne({ _id: req.body.patient_id, role: 'user', isActive: true });
  if (!patient) throw fail(404, 'Patient not found');
  return book({ ...req, user: { _id: patient._id }, body: { ...req.body, counselorId: doctor_id } }, res);
});
async function filterFor(req) {
  return req.user.role === 'user' ? { patient: actorId(req) } : { counselor: await doctorScope(req, req.query?.doctor_id || req.body?.doctor_id) };
}
export const getAppointmentAll = handle(async (req, res) => {
  const filter = await filterFor(req);
  if (req.query.patient_id) filter.patient = req.user.role === 'user' ? actorId(req) : req.query.patient_id;
  if (req.query.date) filter.appointment_date = dateOnly(req.query.date);
  const rows = await Appointment.find(filter).sort({ date: -1 }).lean();
  res.json({ success: true, appointments: await Promise.all(rows.map(appointmentView)) });
});
export const getAppointmentById = handle(async (req, res) => {
  const row = await Appointment.findOne({ ...await filterFor(req), _id: req.params.id }).lean();
  if (!row) throw fail(404, 'Appointment not found');
  res.json({ success: true, appointment: await appointmentView(row) });
});
export const getAppointmentsByPatientId = handle(async (req, res) => {
  const patient_id = req.params.patientId || req.params.patient_id;
  if (req.user.role === 'user' && patient_id !== actorId(req)) throw fail(403, 'Access denied');
  req.query.patient_id = patient_id;
  return getAppointmentAll(req, res);
});
export const getTodayAppointments = handle(async (req, res) => {
  req.query.date = todayIST();
  return getAppointmentAll(req, res);
});
export const searchAppointment = getAppointmentAll;
export const nurseCheckIn = handle(async (req, res) => {
  const counselor = await doctorScope(req, req.body.doctor_id);

  const row = await Appointment.findOneAndUpdate(
    {
      _id: req.params.id,
      counselor,
      status: { $in: ["pending", "confirmed"] },
    },
    {
      $set: {
        status: "confirmed",
        queue_status: "waiting",
        checked_in_at: new Date(),
        vitals: pick(req.body, [
          "blood_pressure",
          "temperature",
          "pulse",
          "weight",
          "height",
          "spo2",
        ]),
      },
    },
    {
      returnDocument: "after",
      runValidators: true,
    },
  );

  if (!row) throw fail(404, "Active appointment not found");

  emitQueueUpdated(row.counselor, row.appointment_date);

  res.json({
    success: true,
    appointment: await appointmentView(row),
  });
});

const consultationFields = [
  "medicine",
  "additional_notes",
  "follow_up_required",
  "follow_up_date",
  "testName",
  "completeBy",
  "reason",
  "instructions",
  "recommended_tests",
  "recommendedTests",
];

export const expandConsultationNotes = (appointment) => {
  try {
    const notes = JSON.parse(appointment.notes);
    if (notes?.__doctorConsultation === 1) {
      const details = Object.fromEntries(
        consultationFields
          .filter((field) => notes.details?.[field] !== undefined)
          .map((field) => [field, notes.details[field]]),
      );
      return { ...appointment, ...details, notes: notes.originalNotes };
    }
  } catch {
    // Plain-text patient notes remain unchanged.
  }
  return appointment;
};

export const updateDoctorAppointment = async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: "Appointment not found" });
    if (String(appointment.counselor) !== String(req.user._id)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const status = req.body.appointment_status || req.body.status;
    if (status && !["pending", "accepted", "confirmed", "booked", "in-progress", "completed", "cancelled", "canceled", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid appointment status" });
    }

    const timing = await getConsultationTiming(appointment, req.body);
    if (timing) {
      appointment.consultation_timing = timing;
      appointment.consultation_started_at = timing.startedAt ? new Date(timing.startedAt) : null;
      appointment.consultation_ended_at = timing.endedAt ? new Date(timing.endedAt) : null;
    }
    if (status) appointment.status = status;
    for (const field of ["diagnosis", "advice", "queue_status", "priority", "checked_in_at", "called_at", "emergency_reason"]) {
      if (req.body[field] !== undefined) appointment[field] = req.body[field];
    }
    if (consultationFields.some((field) => req.body[field] !== undefined)) {
      const existing = expandConsultationNotes(appointment);
      const details = {};
      for (const field of consultationFields) {
        const value = req.body[field] !== undefined ? req.body[field] : existing[field];
        if (value !== undefined) details[field] = value;
      }
      appointment.notes = JSON.stringify({ __doctorConsultation: 1, originalNotes: existing.notes || "", details });
    }
    await appointment.save();
    await emitTimingQueueUpdated(appointment);
    const result = expandConsultationNotes(appointment.toJSON());
    return res.json({ success: true, appointment: result, data: result });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.status ? error.message : "Failed to update appointment" });
  }
};

export const deleteDoctorAppointment = async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: "Appointment not found" });
    if (String(appointment.counselor) !== String(req.user._id)) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    await Appointment.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: "Appointment deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete appointment" });
  }
};

export const updateAppointment = handle(async (req, res) => {
  const counselor = await doctorScope(req, req.body.doctor_id);

  const row = await Appointment.findOne({
    _id: req.params.id,
    counselor,
  });

  if (!row) throw fail(404, "Appointment not found");

  Object.assign(
    row,
    pick(req.body, [
      "notes",
      "diagnosis",
      "advice",
      "patient_location",
      "consultation_mode",
    ]),
  );

  // Existing appointment status support.
  const requestedStatus = req.body.status || req.body.appointment_status;
  if (requestedStatus) {
    row.status =
      requestedStatus === "cancelled" ? "canceled" : requestedStatus;
  }

  // Live queue status support. The same PATCH /:id API can therefore be used
  // by the existing doctor consultation UI without creating another duplicate
  // appointment resource.
  const requestedQueueStatus =
    req.body.queue_status || req.body.queueStatus;

  const allowedQueueStatuses = new Set([
    "booked",
    "waiting",
    "called",
    "in_progress",
    "completed",
    "skipped",
    "no_show",
    "canceled",
  ]);

  if (
    requestedQueueStatus &&
    !allowedQueueStatuses.has(requestedQueueStatus)
  ) {
    throw fail(400, "Invalid queue_status");
  }

  if (requestedQueueStatus === "in_progress") {
    const otherRunning = await Appointment.findOne({
      _id: { $ne: row._id },
      counselor: row.counselor,
      appointment_date: row.appointment_date,
      queue_status: "in_progress",
    }).lean();

    if (otherRunning) {
      throw fail(
        409,
        `Token ${otherRunning.token_number} consultation is already in progress`,
      );
    }

    row.queue_status = "in_progress";
    row.consultation_started_at = new Date();

    // A consultation can only run for an accepted/confirmed appointment.
    if (row.status === "pending") row.status = "confirmed";
  } else if (requestedQueueStatus === "called") {
    row.queue_status = "called";
    row.called_at = new Date();
  } else if (requestedQueueStatus === "completed") {
    row.queue_status = "completed";
    row.status = "completed";
    row.consultation_ended_at = new Date();
  } else if (requestedQueueStatus) {
    row.queue_status = requestedQueueStatus;
  }

  // Backward compatibility: if the existing end-consultation UI already sends
  // status=completed, automatically close the queue item too.
  if (row.status === "completed") {
    row.queue_status = "completed";
    row.consultation_ended_at = row.consultation_ended_at || new Date();
  }

  if (["canceled", "rejected"].includes(row.status)) {
    row.queue_status = "canceled";
    row.slot_key = undefined;
  } else {
    row.slot_key =
      String(row.counselor) + ":" + new Date(row.date).toISOString();
  }

  await saveOnlineAppointment(row);
  emitQueueUpdated(row.counselor, row.appointment_date);

  res.json({
    success: true,
    appointment: await appointmentView(row),
  });
});

export const deleteAppointment = handle(async (req, res) => {
  const row = await Appointment.findOneAndDelete({ ...await filterFor(req), _id: req.params.id });
  if (!row) throw fail(404, 'Appointment not found');
  res.json({ success: true, message: 'Appointment deleted' });
});

async function saveOnlineAppointment(row) {
  if (['canceled', 'rejected'].includes(row.status)) return row.save();
  const local = new Date(new Date(row.date).getTime() + 19800000).toISOString();
  return withAppointmentBooking({ doctorId: row.counselor, patientId: row.patient,
    appointmentDate: local.slice(0, 10), appointmentTime: local.slice(11, 19), excludeId: row._id }, () => row.save());
}

const WAITING_QUEUE_STATUSES = new Set([
  "booked",
  "waiting",
  "called",
]);

const ACTIVE_APPOINTMENT_STATUSES = ["pending", "confirmed"];

const queuePriority = (appointment) =>
  appointment.priority === "emergency"
    ? 0
    : appointment.priority === "urgent"
      ? 1
      : 2;

const sortQueue = (appointments = []) =>
  [...appointments].sort((a, b) => {
    const priorityDifference = queuePriority(a) - queuePriority(b);
    if (priorityDifference !== 0) return priorityDifference;

    return Number(a.token_number || 0) - Number(b.token_number || 0);
  });

const emitQueueUpdated = (doctorId, appointmentDate) => {
  if (!global.io || !doctorId) return;

  const payload = {
    doctorId: String(doctorId),
    appointmentDate,
    updatedAt: new Date().toISOString(),
  };

  global.io
    .to(`doctor_queue_${doctorId}`)
    .emit("queueUpdated", payload);

  global.io
    .to(`user_${doctorId}`)
    .emit("queueUpdated", payload);

  global.io
    .to(`counsellor_${doctorId}`)
    .emit("queueUpdated", payload);

  global.io
    .to(`counselor_${doctorId}`)
    .emit("queueUpdated", payload);
};

const getEstimatedQueueTimes = ({
  patientsAhead,
  averageConsultationMinutes = 10,
}) => {
  const estimatedWaitMinutes =
    Math.max(0, Number(patientsAhead || 0)) *
    averageConsultationMinutes;

  const estimatedTurnTime = new Date(
    Date.now() + estimatedWaitMinutes * 60 * 1000,
  );

  return {
    averageConsultationMinutes,
    estimatedWaitMinutes,
    estimatedTurnTime,
  };
};

/**
 * PATIENT TOKEN MENU
 *
 * GET /api/appointments/my-token-status
 *
 * Returns the logged-in patient's active/upcoming appointments together with
 * live queue information for the corresponding doctor/date/clinic.
 */
export const getMyTokenStatus = async (req, res) => {
  try {
    const patientId = req.user._id;
    const today = todayIST();

    const myAppointments = await Appointment.find({
      patient: patientId,
      status: { $in: ACTIVE_APPOINTMENT_STATUSES },
      appointment_date: { $gte: today },
    })
      .populate(
        "counselor",
        "name fullName firstName lastName profileImage profilePhoto",
      )
      .populate("clinic_id", "name address")
      .sort({ appointment_date: 1, appointment_time: 1, token_number: 1 });

    if (!myAppointments.length) {
      return res.status(200).json({
        success: true,
        patientId,
        totalAppointments: 0,
        appointments: [],
      });
    }

    const result = [];

    for (const appointment of myAppointments) {
      const doctorId =
        appointment.counselor?._id || appointment.counselor;

      const queueFilter = {
        counselor: doctorId,
        appointment_date: appointment.appointment_date,
        status: { $nin: ["canceled", "rejected"] },
      };

      if (appointment.clinic_id?._id) {
        queueFilter.clinic_id = appointment.clinic_id._id;
      } else if (appointment.clinic_id) {
        queueFilter.clinic_id = appointment.clinic_id;
      }

      const doctorAppointments = await Appointment.find(queueFilter)
        .sort({ token_number: 1 })
        .lean();

      const currentAppointment =
        doctorAppointments.find(
          (item) => item.queue_status === "in_progress",
        ) || null;

      const waitingQueue = sortQueue(
        doctorAppointments.filter((item) =>
          WAITING_QUEUE_STATUSES.has(item.queue_status || "booked"),
        ),
      );

      const myWaitingIndex = waitingQueue.findIndex(
        (item) =>
          String(item._id) === String(appointment._id),
      );

      let patientsAhead = 0;

      if (appointment.queue_status === "in_progress") {
        patientsAhead = 0;
      } else if (myWaitingIndex >= 0) {
        patientsAhead = myWaitingIndex;

        if (
          currentAppointment &&
          String(currentAppointment._id) !== String(appointment._id)
        ) {
          patientsAhead += 1;
        }
      }

      const emergencyPatientsAhead =
        myWaitingIndex >= 0
          ? waitingQueue
              .slice(0, myWaitingIndex)
              .filter((item) => item.priority === "emergency").length
          : 0;

      const totalEmergencyWaiting = waitingQueue.filter(
        (item) => item.priority === "emergency",
      ).length;

      const {
        averageConsultationMinutes,
        estimatedWaitMinutes,
        estimatedTurnTime,
      } = getEstimatedQueueTimes({
        patientsAhead,
      });

      result.push({
        appointment: {
          appointmentId: appointment._id,
          appointmentDate: appointment.appointment_date,
          appointmentTime: appointment.appointment_time,
          status: appointment.status,
          bookingSource: appointment.booking_source,
          clinic: appointment.clinic_id,
          doctor: appointment.counselor,
          isToday: appointment.appointment_date === today,
        },

        token: {
          myToken: appointment.token_number,
          queueStatus: appointment.queue_status || "booked",
          priority: appointment.priority || "normal",
        },

        current: {
          currentToken: currentAppointment?.token_number ?? null,
          currentAppointmentId: currentAppointment?._id ?? null,
          doctorStatus: currentAppointment ? "consulting" : "waiting",
        },

        queue: {
          patientsAhead,
          queuePosition:
            myWaitingIndex >= 0
              ? patientsAhead + 1
              : appointment.queue_status === "in_progress"
                ? 1
                : null,
          totalWaiting: waitingQueue.length,
          averageConsultationMinutes,
          estimatedWaitMinutes,
          estimatedTurnTime,
        },

        emergency: {
          active: totalEmergencyWaiting > 0,
          totalEmergencyPatients: totalEmergencyWaiting,
          emergencyPatientsAhead,
          message:
            totalEmergencyWaiting > 0
              ? "Emergency patient is present in the queue. Waiting time may change."
              : null,
        },
      });
    }

    return res.status(200).json({
      success: true,
      patientId,
      totalAppointments: result.length,
      appointments: result,
    });
  } catch (error) {
    console.error("❌ getMyTokenStatus error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch token status",
      error: error.message,
    });
  }
};

/**
 * DOCTOR LIVE QUEUE
 *
 * GET /api/appointments/doctor/queue
 * Optional query:
 *   ?date=2026-09-19
 *   ?clinic_id=<clinic-id>
 *
 * Returns current patient, next patient, waiting count and complete ordered
 * queue for the logged-in doctor.
 */
export const getDoctorQueue = handle(async (req, res) => {
  const doctorId = await doctorScope(
    req,
    req.query.doctor_id || req.body?.doctor_id,
  );

  const appointmentDate = dateOnly(req.query.date || todayIST());

  const filter = {
    counselor: doctorId,
    appointment_date: appointmentDate,
    status: { $nin: ["canceled", "rejected"] },
  };

  if (req.query.clinic_id) {
    filter.clinic_id = req.query.clinic_id;
  }

  const rows = await Appointment.find(filter)
    .populate(
      "patient",
      "fullName profilePhoto profileImage anonymous",
    )
    .populate(
      "counselor",
      "fullName profilePhoto profileImage",
    )
    .populate("clinic_id", "name address")
    .sort({ token_number: 1 })
    .lean();

  const currentPatient =
    rows.find((item) => item.queue_status === "in_progress") || null;

  const waitingQueue = sortQueue(
    rows.filter((item) =>
      WAITING_QUEUE_STATUSES.has(item.queue_status || "booked"),
    ),
  );

  const completedCount = rows.filter(
    (item) =>
      item.queue_status === "completed" ||
      item.status === "completed",
  ).length;

  const emergencyWaitingCount = waitingQueue.filter(
    (item) => item.priority === "emergency",
  ).length;

  const nextPatient = waitingQueue[0] || null;

  const sanitizeQueueAppointment = (appointment) => {
    if (!appointment) return null;

    return {
      ...appointment,
      patient: sanitizeUserForCounselor(
        appointment.patient,
        appointment.patient?._id || appointment.patient,
      ),
    };
  };

  res.json({
    success: true,
    doctorId,
    appointmentDate,

    summary: {
      currentToken: currentPatient?.token_number ?? null,
      currentAppointmentId: currentPatient?._id ?? null,
      waitingCount: waitingQueue.length,
      emergencyWaitingCount,
      completedCount,
      totalAppointments: rows.length,
      nextToken: nextPatient?.token_number ?? null,
    },

    currentPatient: sanitizeQueueAppointment(currentPatient),
    nextPatient: sanitizeQueueAppointment(nextPatient),

    waitingQueue: waitingQueue.map(sanitizeQueueAppointment),

    appointments: rows.map(sanitizeQueueAppointment),
  });
});

/**
 * EMERGENCY PRIORITY
 *
 * PATCH /api/appointments/:id/emergency
 *
 * body:
 * {
 *   "is_emergency": true,
 *   "reason": "Emergency reason",
 *   "doctor_id": "optional-for-admin/nurse/assistant"
 * }
 *
 * Pass is_emergency=false to remove emergency priority.
 */
export const setAppointmentEmergency = handle(async (req, res) => {
  const counselor = await doctorScope(req, req.body.doctor_id);

  const row = await Appointment.findOne({
    _id: req.params.id,
    counselor,
    status: { $nin: ["canceled", "rejected", "completed"] },
  });

  if (!row) {
    throw fail(404, "Active appointment not found");
  }

  const isEmergency = req.body.is_emergency !== false;

  row.priority = isEmergency ? "emergency" : "normal";
  row.emergency_reason = isEmergency
    ? String(req.body.reason || req.body.emergency_reason || "").trim()
    : undefined;

  // An emergency patient is considered active in the waiting queue unless the
  // consultation is already running.
  if (
    isEmergency &&
    ["booked", "waiting", "called"].includes(
      row.queue_status || "booked",
    )
  ) {
    row.queue_status = "waiting";
  }

  await row.save();
  emitQueueUpdated(row.counselor, row.appointment_date);

  await createNotificationSafely({
    recipientId: row.patient,
    actorId: req.user._id,
    type: "appointment",
    title: isEmergency
      ? "Appointment marked as emergency"
      : "Emergency priority removed",
    message: isEmergency
      ? "Your appointment has been moved to the emergency queue."
      : "Your appointment is now back in the normal queue.",
    data: {
      appointmentId: row._id,
      priority: row.priority,
      queue_status: row.queue_status,
    },
    actionUrl: "/appointments",
  });

  res.json({
    success: true,
    message: isEmergency
      ? "Appointment marked as emergency"
      : "Emergency priority removed",
    appointment: await appointmentView(row),
  });
});
