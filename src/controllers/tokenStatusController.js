import Appointment from "../models/appointmentModel.js";
import WalkinAppointment from "../models/walkinAppointmentModel.js";
import User from "../models/userModel.js";
import { DoctorBreak } from "../models/clinicModels.js";
import { buildDaySlots, indiaDateTime, slotRepository, timeMinutes } from "../services/appointmentSlotService.js";
import { clockTime } from "../services/appointmentDelayService.js";

export const tokenTimingRepository = {
  breaks: async (doctorId, date) => {
    try {
      const start = new Date(`${date}T00:00:00+05:30`);
      return await DoctorBreak.find({ doctor_id: doctorId, started_at: {
        $gte: start,
        $lt: new Date(start.getTime() + 86400000),
      } }).lean();
    } catch (error) {
      console.warn("Token status break lookup failed:", error.message);
      return [];
    }
  },
};

const terminal = new Set(["completed", "cancelled", "canceled", "rejected", "reject", "no-show", "no_show"]);
const serving = new Set(["in-progress", "in_progress", "consulting", "serving", "called"]);
const optionalTokenLookup = async (label, lookup, fallback = []) => {
  try {
    return await lookup();
  } catch (error) {
    console.warn(`Token status ${label} lookup failed:`, error.message);
    return fallback;
  }
};
const recordId = (value) => {
  if (!value) return "";
  if (typeof value === "object") return String(value._id || value.id || value.userId || "");
  return String(value);
};
const asArray = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
const safeIndiaDateTime = (value) => {
  try {
    return value ? indiaDateTime(value) : {};
  } catch {
    return {};
  }
};
const normalizeTime = (value) => {
  const minutes = timeMinutes(value);
  return minutes === null ? String(value || "") : clockTime(minutes);
};
const scheduledIso = (date, time) => {
  const minutes = timeMinutes(time);
  if (!date || minutes === null) return null;
  const value = new Date(`${date}T${clockTime(minutes)}+05:30`);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
};
const normalizeTiming = (record = {}) => {
  let timing = record.consultation_timing || {};
  if (typeof timing === "string") {
    try {
      timing = JSON.parse(timing);
    } catch {
      timing = {};
    }
  }
  if (!timing || typeof timing !== "object") timing = {};
  return {
    ...timing,
    startedAt: timing.startedAt || timing.started_at || record.consultation_started_at || null,
    endedAt: timing.endedAt || timing.ended_at || record.consultation_ended_at || null,
    pauses: Array.isArray(timing.pauses) ? timing.pauses : [],
  };
};
const normalize = (record, source) => {
  const fallback = safeIndiaDateTime(record.date);
  const status = String(record.appointment_status || record.status || "pending").toLowerCase();
  const doctorId = recordId(record.doctor_id || record.counselor || record.counselorId || record.doctor);
  const emergency = String(record.priority || "").toLowerCase() === "emergency";
  const time = emergency && !record.appointment_time ? "" : normalizeTime(record.appointment_time || fallback.time || "");
  return {
    id: String(record.id || record._id), source,
    doctorId,
    patientId: recordId(record.patient_id || record.patient),
    date: String(record.appointment_date || fallback.date || "").slice(0, 10),
    time,
    token: Number(record.token_number) > 0 ? Number(record.token_number) : null,
    createdAt: record.createdAt || record.created_at || null,
    status,
    queueStatus: String(record.queue_status || status).toLowerCase(),
    emergency,
    timing: normalizeTiming(record),
  };
};
const hasEndedConsultation = (item) => Boolean(
  item?.timing?.endedAt ||
  item?.timing?.ended_at ||
  item?.timing?.endedAtIso ||
  item?.consultation_ended_at,
);
const isActive = (item) => !terminal.has(item.status) && !terminal.has(item.queueStatus) && !hasEndedConsultation(item);
const isServing = (item) => serving.has(item.status) || serving.has(item.queueStatus);

export const formatTokenStatus = (own, records, doctor, ranges = [], breaks = [], now = Date.now()) => {
  records = asArray(records);
  ranges = asArray(ranges);
  breaks = asArray(breaks);
  // Historical appointments retain their status but do not join a live queue.
  if (!isActive(own)) { records = []; breaks = []; }
  const queue = records.filter((item) => item.doctorId === own.doctorId && item.date === own.date && isActive(item))
    .sort((a, b) => Number(isServing(b)) - Number(isServing(a)) || Number(b.emergency) - Number(a.emergency)
      || (timeMinutes(a.time) ?? 1440) - (timeMinutes(b.time) ?? 1440) || a.id.localeCompare(b.id));
  const position = queue.findIndex((item) => item.id === own.id && item.source === own.source);
  const ahead = position < 0 ? [] : queue.slice(0, position);
  const current = queue.find(isServing);
  const emergency = queue.filter((item) => item.emergency && !isServing(item));
  const started = current?.timing?.startedAt ? new Date(current.timing.startedAt).getTime() : null;
  const defaultSlotDuration = Number(ranges?.[0]?.slot_duration) || 15;
  const durationFor = (item) => {
    const explicitDuration = Number(item.timing?.durationMinutes);
    if (explicitDuration > 0) return explicitDuration;
    const itemMinutes = timeMinutes(item.time);
    const matchedRange = item.date && itemMinutes !== null
      ? ranges.find((range) => {
        try {
          return buildDaySlots([range], item.date).some((slot) => timeMinutes(slot.time) === itemMinutes);
        } catch {
          return false;
        }
      })
      : null;
    return Number(matchedRange?.slot_duration) || defaultSlotDuration;
  };
  const breakIntervals = breaks.map((record) => ({
    start: new Date(record.started_at).getTime(),
    end: record.ended_at ? new Date(record.ended_at).getTime() : new Date(record.started_at).getTime() + Number(record.planned_minutes) * 60000,
  })).filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end));
  const activeBreak = breakIntervals.find((interval) => interval.start <= now && interval.end > now);
  const manualPaused = current?.timing?.state === "paused";
  let elapsedSeconds = null;
  let estimatedTurnTime = null;
  let estimateUncertain = false;
  if (started !== null && Number.isFinite(started)) {
    const pauses = [...breakIntervals, ...(current.timing.pauses || []).map((pause) => ({
      start: new Date(pause.startedAt).getTime(), end: pause.endedAt ? new Date(pause.endedAt).getTime() : now,
    }))].map(({ start, end }) => ({ start: Math.max(started, start), end: Math.min(now, end) }))
      .filter(({ start, end }) => end > start).sort((a, b) => a.start - b.start);
    let pausedMs = 0, previousEnd = started;
    for (const pause of pauses) { pausedMs += Math.max(0, pause.end - Math.max(previousEnd, pause.start)); previousEnd = Math.max(previousEnd, pause.end); }
    elapsedSeconds = Math.max(0, Math.floor((now - started - pausedMs) / 1000));
    // During a pause, do not claim an ETA until the doctor resumes.
    if (!manualPaused && !activeBreak && position >= 0) {
      let cursor = now;
      let known = true;
      for (const item of ahead) {
        const duration = durationFor(item);
        if (!duration) { known = false; break; }
        if (isServing(item)) {
          const remainingSeconds = duration * 60 - elapsedSeconds;
          if (remainingSeconds <= 0) estimateUncertain = true;
          cursor += Math.max(0, remainingSeconds) * 1000;
        }
        else cursor += duration * 60000;
      }
      if (known) estimatedTurnTime = new Date(isServing(own) ? now : cursor).toISOString();
    }
  } else if (!current && position >= 0) {
    let cursor = now;
    let known = true;
    for (const item of ahead) {
      const duration = durationFor(item);
      if (!duration) { known = false; break; }
      cursor += duration * 60000;
    }
    if (known) estimatedTurnTime = new Date(isServing(own) ? now : cursor).toISOString();
  } else if (current && !started && position >= 0) {
    estimateUncertain = true;
  }
  const doctorStatus = activeBreak ? "break" : manualPaused ? "paused" : current ? "consulting" : "waiting";

  const ownMinutes = timeMinutes(own.time);
  const scheduledStartAt = scheduledIso(own.date, own.time);
  let computedDelayMinutes = 0;
  let timingDifferenceMinutes = null;
  let timingRelation = null;
  if (estimatedTurnTime && ownMinutes !== null && scheduledStartAt) {
    const scheduledMs = new Date(scheduledStartAt).getTime();
    const turnMs = new Date(estimatedTurnTime).getTime();
    timingDifferenceMinutes = Math.round((turnMs - scheduledMs) / 60000);
    timingRelation = timingDifferenceMinutes > 0 ? "late" : timingDifferenceMinutes < 0 ? "early" : "on_time";
    if (turnMs > scheduledMs) {
      computedDelayMinutes = Math.max(0, timingDifferenceMinutes);
    }
  } else if (ahead.length > 0 && ownMinutes !== null) {
    const emergencyAhead = ahead.filter((item) => item.emergency);
    if (emergencyAhead.length > 0) {
      computedDelayMinutes = emergencyAhead.reduce((sum, item) => sum + (durationFor(item) || defaultSlotDuration), 0);
    }
  }

  return {
    appointment: {
      appointmentId: `${own.source}:${own.id}`, _id: own.id, source: own.source,
      appointmentDate: own.date, appointmentTime: own.time, status: own.status,
      createdAt: own.createdAt, bookedAt: own.createdAt, scheduledStartAt,
      doctor: { _id: own.doctorId, fullName: doctor?.fullName || "Doctor" },
      estimatedAppointmentTime: estimatedTurnTime ? indiaDateTime(estimatedTurnTime).time : (computedDelayMinutes > 0 && ownMinutes !== null ? clockTime(ownMinutes + computedDelayMinutes) : null),
      estimatedStartAt: estimatedTurnTime,
      delayMinutes: computedDelayMinutes,
      timingRelation,
      timingDifferenceMinutes,
    },
    token: { myToken: own.token, queueStatus: own.queueStatus },
    current: {
      currentToken: current?.token ?? null, doctorStatus,
      consultationStartedAt: current?.timing?.startedAt || null,
      elapsedSeconds, durationMinutes: current ? durationFor(current) : null,
      isYourTurn: Boolean(current && current.id === own.id && current.source === own.source),
      serverTime: new Date(now).toISOString(),
    },
    queue: {
      totalWaiting: queue.filter((item) => !isServing(item)).length,
      patientsAhead: position < 0 ? null : ahead.length,
      queuePosition: position < 0 ? null : position + 1,
      estimatedWaitMinutes: estimatedTurnTime ? Math.max(0, Math.ceil((new Date(estimatedTurnTime).getTime() - now) / 60000)) : null,
      estimatedTurnTime,
      timingRelation,
      timingDifferenceMinutes,
      estimateUncertain,
      notifyWithinMinutes: estimatedTurnTime && !isServing(own) ? Math.max(0, Math.ceil((new Date(estimatedTurnTime).getTime() - now) / 60000)) <= 30 : false,
      notice: estimateUncertain && position > 0
        ? "Your number may be called anytime. Please stay near the clinic."
        : (estimatedTurnTime && !isServing(own) && Math.max(0, Math.ceil((new Date(estimatedTurnTime).getTime() - now) / 60000)) <= 30
          ? "Your number may come within 30 minutes. Please stay near the clinic."
          : null),
    },
    emergency: { active: emergency.length > 0, totalEmergencyPatients: emergency.length,
      emergencyPatientsAhead: ahead.filter((item) => item.emergency).length },
  };
};

export const getMyTokenStatus = async (req, res) => {
  try {
    const userId = recordId(req.user?._id || req.user?.id || req.userId || req.user?.userId);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const byPatient = await optionalTokenLookup("online appointment", () => Appointment.find({ patient: userId }), []);
    const byPatientId = Array.isArray(byPatient) && byPatient.length > 0
      ? []
      : await optionalTokenLookup("online appointment patient_id", () => Appointment.find({ patient_id: userId }), []);
    const online = asArray(byPatient).length > 0 ? asArray(byPatient) : asArray(byPatientId);
    const [walkins] = await Promise.all([
      optionalTokenLookup("walk-in appointment", () => WalkinAppointment.find({ patient_id: userId })),
    ]);
    const mine = [...online.map((record) => normalize(record, "online")), ...asArray(walkins).map((record) => normalize(record, "walkin"))]
      .filter(isActive)
      .sort((a, b) => {
        const timestamp = (item) => Date.parse(item.createdAt || `${item.date}T${item.time || "00:00:00"}+05:30`) || 0;
        return timestamp(b) - timestamp(a) || b.id.localeCompare(a.id);
      });
    const queues = new Map();
    const doctors = new Map();
    const schedules = new Map();
    const doctorBreaks = new Map();
    const appointments = (await Promise.all(mine.map(async (own) => {
      try {
        if (!doctors.has(own.doctorId)) {
          doctors.set(own.doctorId, optionalTokenLookup("doctor", () => User.findById(own.doctorId).select("fullName").lean(), null));
        }
        if (!isActive(own)) return formatTokenStatus(own, [], await doctors.get(own.doctorId));
        const key = `${own.doctorId}:${own.date}`;
        if (!queues.has(key)) queues.set(key, Promise.all([
          optionalTokenLookup("online queue", () => slotRepository.online(own.doctorId, own.date)),
          optionalTokenLookup("walk-in queue", () => slotRepository.walkins(own.doctorId, own.date)),
        ]).then(([booked, walkin]) => {
          const queue = [...asArray(booked).map((record) => normalize(record, "online")), ...asArray(walkin).map((record) => normalize(record, "walkin"))];
          return queue.some((item) => item.id === own.id && item.source === own.source) ? queue : [own, ...queue];
        }));
        if (!schedules.has(own.doctorId)) schedules.set(own.doctorId, optionalTokenLookup("schedule", () => slotRepository.ranges(own.doctorId)));
        if (!doctorBreaks.has(key)) doctorBreaks.set(key, tokenTimingRepository.breaks(own.doctorId, own.date));
        const [queue, doctor, ranges, breaks] = await Promise.all([queues.get(key), doctors.get(own.doctorId), schedules.get(own.doctorId), doctorBreaks.get(key)]);
        return formatTokenStatus(own, queue, doctor, ranges, breaks);
      } catch (error) {
        console.error(`Failed to format token status for ${own.source}:${own.id}:`, error.stack || error.message);
        return null;
      }
    }))).filter(Boolean);
    res.set("Cache-Control", "private, no-store");
    return res.json({ success: true, appointments });
  } catch (error) {
    console.error("Failed to load token status:", error.stack || error.message);
    return res.status(500).json({ success: false, message: "Unable to load token status" });
  }
};
