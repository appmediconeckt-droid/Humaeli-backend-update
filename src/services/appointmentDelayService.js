// src/services/appointmentDelayService.js
import DoctorBreak from "../models/doctorBreakModel.js";
import Appointment from "../models/appointmentModel.js";
import WalkinAppointment from "../models/walkinAppointmentModel.js";
import { indiaDateTime, timeMinutes } from "./appointmentSlotService.js";

export const clockTime = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`;

/**
 * Calculates delays caused by doctor breaks and emergency appointments
 * for a given doctor on a given date.
 */
export const calculateDoctorDelays = async (doctorId, date) => {
  if (!doctorId || !date) {
    return { breaks: [], emergencies: [], delayEvents: [] };
  }

  try {
    const startOfDay = new Date(`${date}T00:00:00+05:30`);
    const endOfDay = new Date(startOfDay.getTime() + 86400000);

    const [breaks, onlineEmergencies, walkinEmergencies] = await Promise.all([
      DoctorBreak.find({
        doctor_id: doctorId,
        started_at: { $gte: startOfDay, $lt: endOfDay },
      }),
      Appointment.find({
        counselor: doctorId,
        priority: "emergency",
        $or: [
          { appointment_date: date },
          { date: { $gte: startOfDay, $lt: endOfDay } },
        ],
      }),
      WalkinAppointment.find({
        doctor_id: doctorId,
        appointment_date: date,
        priority: "Emergency",
      }),
    ]);

    const delayEvents = [];
    const breakList = Array.isArray(breaks) ? breaks : [];
    const onlineList = Array.isArray(onlineEmergencies) ? onlineEmergencies : [];
    const walkinList = Array.isArray(walkinEmergencies) ? walkinEmergencies : [];

    // 1. Process doctor breaks
    for (const b of breakList) {
      if (b.status === "cancelled") continue;
      const startedAt = new Date(b.started_at);
      const startMin = timeMinutes(indiaDateTime(startedAt).time) || 0;
      let durationMin = 0;

      if (b.status === "active") {
        const elapsed = Math.ceil((Date.now() - startedAt.getTime()) / 60000);
        durationMin = Math.max(Number(b.planned_minutes) || 15, elapsed);
      } else {
        if (b.ended_at) {
          durationMin = Math.max(1, Math.round((new Date(b.ended_at).getTime() - startedAt.getTime()) / 60000));
        } else {
          durationMin = Number(b.planned_minutes) || 15;
        }
      }

      if (durationMin > 0) {
        delayEvents.push({
          type: "break",
          startMinutes: startMin,
          durationMinutes: durationMin,
          endMinutes: startMin + durationMin,
          reason: b.reason || "Doctor Break",
          status: b.status,
        });
      }
    }

    // 2. Process emergency appointments
    const allEmergencies = [...onlineList, ...walkinList];
    for (const em of allEmergencies) {
      const status = String(em.appointment_status || em.status || "pending").toLowerCase();
      if (["cancelled", "canceled", "rejected", "reject"].includes(status)) continue;

      const timing = em.consultation_timing || {};
      const startedAt = timing.startedAt || em.consultation_started_at || em.created_at || em.date;
      const startMin = startedAt ? timeMinutes(indiaDateTime(startedAt).time) || 0 : 0;
      let durationMin = 0;

      if (["in-progress", "in_progress", "consulting"].includes(status)) {
        const startMs = startedAt ? new Date(startedAt).getTime() : Date.now();
        const elapsed = Math.ceil((Date.now() - startMs) / 60000);
        durationMin = Math.max(elapsed, Number(timing.durationMinutes) || 15);
      } else if (["completed", "complete", "done"].includes(status)) {
        if (timing.endedAt && timing.startedAt) {
          durationMin = Math.max(1, Math.round((new Date(timing.endedAt).getTime() - new Date(timing.startedAt).getTime()) / 60000));
        } else if (em.consultation_ended_at && em.consultation_started_at) {
          durationMin = Math.max(1, Math.round((new Date(em.consultation_ended_at).getTime() - new Date(em.consultation_started_at).getTime()) / 60000));
        } else {
          durationMin = Number(timing.durationMinutes) || 15;
        }
      } else {
        durationMin = Number(timing.durationMinutes) || 15;
      }

      if (durationMin > 0) {
        delayEvents.push({
          type: "emergency",
          startMinutes: startMin,
          durationMinutes: durationMin,
          endMinutes: startMin + durationMin,
          reason: em.emergency_reason || "Emergency Consultation",
          status,
        });
      }
    }

    delayEvents.sort((a, b) => a.startMinutes - b.startMinutes);

    return {
      breaks: breaks || [],
      emergencies: allEmergencies,
      delayEvents,
    };
  } catch (error) {
    console.error("Error calculating doctor delays:", error);
    return { breaks: [], emergencies: [], delayEvents: [] };
  }
};

/**
 * Enriches a list of appointments with estimated_start_at,
 * estimated_appointment_time, delay_minutes, delay_reason.
 */
export const enrichAppointmentsWithDelay = async (appointments, doctorId, date) => {
  if (!Array.isArray(appointments) || appointments.length === 0) return appointments;

  const targetDate = date || indiaDateTime().date;
  const targetDoctorId = doctorId || appointments[0]?.counselor || appointments[0]?.doctor_id;

  const { delayEvents } = await calculateDoctorDelays(targetDoctorId, targetDate);

  if (!delayEvents || delayEvents.length === 0) {
    return appointments.map((appt) => {
      const isPlain = typeof appt.toJSON === "function" ? appt.toJSON() : { ...appt };
      return isPlain;
    });
  }

  return appointments.map((appt) => {
    const item = typeof appt.toJSON === "function" ? appt.toJSON() : { ...appt };

    const status = String(item.appointment_status || item.status || "pending").toLowerCase();
    const isCompletedOrCancelled = ["completed", "complete", "cancelled", "canceled", "rejected"].includes(status);
    const isEmergency = String(item.priority || "").toLowerCase() === "emergency";

    if (isEmergency || isCompletedOrCancelled) {
      return item;
    }

    const fallback = item.date ? indiaDateTime(item.date) : {};
    const apptDate = String(item.appointment_date || fallback.date || "").slice(0, 10);
    const apptTime = item.appointment_time || fallback.time;

    if (!apptTime || apptDate !== targetDate) {
      return item;
    }

    const apptMinutes = timeMinutes(apptTime);
    if (apptMinutes === null) return item;

    // Initialize delay tracking
    let applicableDelay = 0;
    const reasons = [];
    // effectiveStart tracks the appointment's start time after applying delays
    let effectiveStart = apptMinutes;
for (const event of delayEvents) {
      // Calculate overlap between event and the current effective start time
      const overlap = Math.max(0, (event.endMinutes ?? (event.startMinutes + event.durationMinutes)) - effectiveStart);
      if (overlap > 0) {
        applicableDelay += overlap;
        effectiveStart += overlap;
        const label = event.type === "emergency"
          ? `Emergency consultation (${overlap} min)`
          : `Doctor break (${overlap} min)`;
        if (!reasons.includes(label)) reasons.push(label);
      }
    }

    if (applicableDelay > 0) {
      const newMinutes = apptMinutes + applicableDelay;
      const originalTime = apptTime.length === 5 ? `${apptTime}:00` : apptTime;
      const scheduledIso = `${apptDate}T${originalTime}+05:30`;
      const scheduledMs = new Date(scheduledIso).getTime();

      item.original_appointment_time = item.appointment_time || originalTime;
      item.original_appointment_at = new Date(scheduledMs).toISOString();
      item.delay_minutes = applicableDelay;
      item.delay_reason = reasons.join(", ");
      item.estimated_appointment_time = clockTime(newMinutes);
      item.estimated_start_at = new Date(scheduledMs + applicableDelay * 60000).toISOString();
    }

    return item;
  });
};
