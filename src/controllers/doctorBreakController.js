import {
  endDoctorBreak,
  getActiveDoctorBreak,
  startDoctorBreak,
} from "../services/doctorBreakService.js";
import { actorId } from '../utils/clinicAccess.js';

const emitAppointmentDelays = (io, appointments, reason) => {
  for (const appointment of appointments) {
    if (!appointment.patient_id || !["pending", "confirmed"].includes(appointment.appointment_status)) continue;
    io?.to(`user:${appointment.patient_id}`).emit("appointment:delayed", {
      appointment_id: appointment.appointment_id,
      doctor_id: appointment.doctor_id,
      delay_minutes: Number(appointment.delay_minutes),
      original_appointment_at: appointment.original_appointment_at,
      estimated_start_at: appointment.estimated_start_at,
      reason,
    });
  }
};

export const startBreak = async (req, res) => {
  try {
    if (String(req.user.role).toLowerCase() !== "doctor") {
      return res.status(403).json({ success: false, message: "Only a doctor can start a break" });
    }

    const durationMinutes = Number(req.body.duration_minutes);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 240) {
      return res.status(400).json({
        success: false,
        message: "duration_minutes must be an integer between 1 and 240",
      });
    }

    const { breakData, appointments } = await startDoctorBreak({
      doctorId: actorId(req),
      durationMinutes,
      reason: req.body.reason,
    });
    const io = req.app.get("io");
    io?.to(`user:${actorId(req)}`).emit("break:started", breakData);
    emitAppointmentDelays(
      io,
      appointments,
      req.body.reason || "Doctor is currently on a break",
    );

    res.status(201).json({
      success: true,
      break: breakData,
      affected_appointments: appointments,
    });
  } catch (error) {
    console.error("Error starting doctor break:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const endBreak = async (req, res) => {
  try {
    if (String(req.user.role).toLowerCase() !== "doctor") {
      return res.status(403).json({ success: false, message: "Only a doctor can end a break" });
    }

    const { breakData, appointments } = await endDoctorBreak({
      doctorId: actorId(req),
      breakId: req.params.breakId,
    });
    const io = req.app.get("io");
    io?.to(`user:${actorId(req)}`).emit("break:ended", breakData);
    emitAppointmentDelays(io, appointments, "Doctor break duration updated");

    res.json({
      success: true,
      break: breakData,
      updated_appointments: appointments,
    });
  } catch (error) {
    console.error("Error ending doctor break:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const getActiveBreak = async (req, res) => {
  try {
    if (String(req.user.role).toLowerCase() !== "doctor") {
      return res.status(403).json({ success: false, message: "Only a doctor can view break status" });
    }
    const activeBreak = await getActiveDoctorBreak(actorId(req));
    res.json({ success: true, active: Boolean(activeBreak), break: activeBreak });
  } catch (error) {
    console.error("Error getting active doctor break:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
