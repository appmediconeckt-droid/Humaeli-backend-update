// src/services/appointmentDelayService.js
import DoctorBreak from "../models/doctorBreakModel.js";
import Appointment from "../models/appointmentModel.js";
import WalkinAppointment from "../models/walkinAppointmentModel.js";
import { indiaDateTime, timeMinutes, slotRepository } from "./appointmentSlotService.js";

import { calculateEstimatedQueue, normalizeQueueAppointment, queueRecordKey } from "./queueTimingService.js";

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
  const targetDoctorId = String(doctorId || appointments[0]?.counselor?._id || appointments[0]?.counselor || appointments[0]?.doctor_id || '');
  const { breaks } = await calculateDoctorDelays(targetDoctorId, targetDate);
  const [online, walkins, ranges] = await Promise.all([
    slotRepository.online(targetDoctorId, targetDate), slotRepository.walkins(targetDoctorId, targetDate), slotRepository.ranges(targetDoctorId),
  ]);
  const sourceFor = (item) => item.doctor_id && !item.counselor ? 'walkin' : 'online';
  const normalized = [
    ...(Array.isArray(online) ? online : []).map((record) => normalizeQueueAppointment(record, 'online')),
    ...(Array.isArray(walkins) ? walkins : []).map((record) => normalizeQueueAppointment(record, 'walkin')),
    ...appointments.map((record) => normalizeQueueAppointment(record, sourceFor(record))),
  ];
  const records = [...new Map(normalized.map((item) => [queueRecordKey(item), item])).values()];
  const states = new Map();
  const now = Date.now();
  return appointments.map((record) => {
    const item = typeof record.toJSON === 'function' ? record.toJSON() : { ...record };
    const own = normalizeQueueAppointment(item, sourceFor(item));
    if (own.date !== targetDate || own.doctorId !== targetDoctorId) return item;
    if (!states.has(own.clinicId)) states.set(own.clinicId, calculateEstimatedQueue(records, {
      doctorId: targetDoctorId, date: targetDate, clinicId: own.clinicId, ranges: Array.isArray(ranges) ? ranges : [], breaks, now,
    }));
    const timing = states.get(own.clinicId).estimates.get(queueRecordKey(own));
    if (!timing) return item;
    return {
      ...item,
      original_appointment_time: item.appointment_time,
      original_appointment_at: timing.scheduledStartAt,
      estimated_appointment_time: timing.estimatedStartAt ? indiaDateTime(timing.estimatedStartAt).time : null,
      estimated_start_at: timing.estimatedStartAt, estimated_end_at: timing.estimatedEndAt,
      actual_start_at: timing.actualStartAt, actual_end_at: timing.actualEndAt,
      expected_duration_minutes: timing.expectedDurationMinutes, waiting_minutes: timing.waitingMinutes,
      timing_difference_minutes: timing.timingDifferenceMinutes, timing_label: timing.timingLabel,
      delay_minutes: Math.max(0, timing.timingDifferenceMinutes || 0),
      delay_reason: timing.timingDifferenceMinutes > 0 ? 'Live consultation queue' : null,
    };
  });
};
