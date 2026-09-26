// mindCrawller/src/controllers/appointmentController.js
import Appointment from "../models/appointmentModel.js";
import User from "../models/userModel.js";
import { createNotificationSafely } from "../services/notificationService.js";
import { withAppointmentSlot, indiaDateTime } from "../services/appointmentSlotService.js";
import { getConsultationTiming, emitQueueUpdated } from "../services/consultationTimingService.js";
import { validateAppointmentPriority, createEmergencyAppointment } from "../services/emergencyAppointmentService.js";
import { enrichAppointmentsWithDelay } from "../services/appointmentDelayService.js";

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

// Get end of day in IST
const getEndOfDayIST = (date) => {
  const istDate = toIST(date);
  const endOfDay = new Date(istDate);
  endOfDay.setHours(23, 59, 59, 999);
  return new Date(endOfDay.getTime() - IST_OFFSET); // Convert back to UTC
};

export const book = async (req, res) => {
  try {
    const { counselorId, date, notes } = req.body;

    // Basic validation
    if (!counselorId || (req.body.priority !== "emergency" && !date)) {
      return res
        .status(400)
        .json({ message: "counselorId and date are required" });
    }

    const priorityFields = validateAppointmentPriority(req.body);
    const counselor = await User.findOne({
      _id: counselorId,
      role: { $in: ["counsellor", "doctor"] },
      isActive: true,
      profileCompleted: true,
    }).select("_id role");

    if (!counselor) {
      return res.status(404).json({
        message: "Counselor not found or profile is not complete yet",
      });
    }





    if (priorityFields.priority === "emergency") {
      if (counselor.role !== "doctor") return res.status(400).json({ message: "Emergency appointments are available with doctors only" });
    }
    const payload = {
      ...(priorityFields.priority === "emergency" ? priorityFields : {}),
      patient: req.user._id, // `auth` middleware puts the logged‑in user on req.user
      counselor: counselorId,
      date,
      notes,
      patient_location: req.body.patient_location || null,
    };
    const usesSlots = counselor.role === "doctor" || req.body.appointment_time || req.body.clinic_id;
    let staffIds = [];
    let appointment;
    if (priorityFields.priority === "emergency") {
      const result = await createEmergencyAppointment({ patientId: req.user._id, doctorId: counselorId, body: req.body });
      appointment = result.appointment;
      staffIds = result.staffIds;
    } else appointment = usesSlots
      ? await withAppointmentSlot({
          doctorId: counselorId,
          date: req.body.appointment_date || indiaDateTime(date).date,
          time: req.body.appointment_time || indiaDateTime(date).time,
          clinicId: req.body.clinic_id,
        }, (slot) => {
          return Appointment.create({
          ...payload,
          date: new Date(`${slot.date}T${slot.time}+05:30`),
          appointment_date: slot.date,
          appointment_time: slot.time,
          clinic_id: slot.clinicId,
          token_number: slot.token,
          slot_key: `${counselorId}:${slot.date}:${slot.time}`,
          consultation_mode: req.body.consultation_mode,
          booking_source: "online",
          status: "pending",
        }); })
      : await Appointment.create(payload);

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

    await Promise.all([...new Set([String(counselorId), ...staffIds])].map((recipientId) => createNotificationSafely({
      recipientId,
      actorId: req.user._id,
      type: "appointment",
      title: priorityFields.priority === "emergency" ? "Emergency appointment request" : "New appointment request",
      message: priorityFields.priority === "emergency"
        ? `${req.user.fullName || "A patient"} has sent an emergency appointment request to your clinic. Please review it now.`
        : `${req.user.fullName || "A user"} requested an appointment for ${new Date(date).toLocaleString("en-IN")}.`,
      data: { appointmentId: appointment._id || appointment.id, status: appointment.status, date: appointment.date, priority: priorityFields.priority, clinicId: appointment.clinic_id },
      actionUrl: recipientId !== String(counselorId) ? "" : counselor.role === "doctor" ? "/appointmentlist" : "/counselor/appointments",
    })));

    await emitQueueUpdated(appointment);

    return res.status(201).json(appointment);
  } catch (err) {
    console.error("❌ book appointment error", err);
    return res.status(err.status || 500).json({ message: err.status ? err.message : "Server error" });
  }
};

export const getAppointments = async (req, res) => {
  try {
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
      $or: [{ patient: userId }, { counselor: userId }, ...(req.query.doctor_id ? [{ counselor: req.query.doctor_id }] : [])],
      ...dateFilter,
    })
      .populate("patient", "fullName phoneNumber dateOfBirth age gender bloodGroup address locationData profilePhoto anonymous")
      .populate("counselor", "fullName profilePhoto anonymous")
      .sort({ date: -1 })
      .lean();

    const expanded = appointments.map(expandConsultationNotes);
    const requestedDoctorId = req.query.doctor_id || req.query.doctorId;
    const userRole = String(req.user?.role || "").toLowerCase();
    const targetDoctor = requestedDoctorId || (userRole === "doctor" ? userId : null);
    const targetDate = date ? String(date).slice(0, 10) : indiaDateTime().date;
    const enriched = await enrichAppointmentsWithDelay(expanded, targetDoctor, targetDate);

    return res.json(enriched);
  } catch (err) {
    console.error("❌ get appointments error", err);
    return res.status(500).json({ message: "Server error" });
  }
};

const consultationFields = [
  "medicine", "additional_notes", "follow_up_required", "follow_up_date",
  "testName", "completeBy", "reason", "instructions", "recommended_tests", "recommendedTests",
];

// The existing notes column preserves consultation details without requiring a
// schema migration. Keep the patient's original notes in the envelope.
export const expandConsultationNotes = (appointment) => {
  try {
    const notes = JSON.parse(appointment.notes);
    if (notes?.__doctorConsultation === 1) {
      const details = Object.fromEntries(consultationFields
        .filter((field) => notes.details?.[field] !== undefined)
        .map((field) => [field, notes.details[field]]));
      return { ...appointment, ...details, notes: notes.originalNotes };
    }
  } catch { /* Existing plain-text notes remain unchanged. */ }
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
    await emitQueueUpdated(appointment);
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

export const updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user._id;

    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    // Basic authorization: user must be either patient or counselor
    if (
      appointment.patient.toString() !== userId.toString() &&
      appointment.counselor.toString() !== userId.toString()
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const timing = await getConsultationTiming(appointment, req.body);
    if (timing) appointment.consultation_timing = timing;
    appointment.status = status;
    await appointment.save();
    await emitQueueUpdated(appointment);

    await createNotificationSafely({
      recipientId: appointment.patient,
      actorId: req.user._id,
      type: "appointment",
      title: `Appointment ${status}`,
      message: `Your appointment request has been ${status}.`,
      data: { appointmentId: appointment._id, status, date: appointment.date },
      actionUrl: "/appointments",
    });

    return res.json({
      message: `Appointment ${status} successfully`,
      appointment,
    });
  } catch (err) {
    console.error("❌ update status error", err);
    return res.status(500).json({ message: "Server error" });
  }
};
