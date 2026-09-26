import Appointment from "../models/appointmentModel.js";
import WalkinAppointment from "../models/walkinAppointmentModel.js";
import User from "../models/userModel.js";
import DoctorBreak from "../models/doctorBreakModel.js";
import { buildDaySlots, indiaDateTime, slotRepository, timeMinutes } from "../services/appointmentSlotService.js";
import { clockTime } from "../services/appointmentDelayService.js";

export const tokenTimingRepository = {
  breaks: (doctorId, date) => DoctorBreak.find({ doctor_id: doctorId, started_at: {
    $gte: new Date(`${date}T00:00:00+05:30`),
    $lt: new Date(new Date(`${date}T00:00:00+05:30`).getTime() + 86400000),
  } }),
};

const terminal = new Set(["completed", "cancelled", "canceled", "rejected", "reject", "no-show", "no_show"]);
const serving = new Set(["in-progress", "in_progress", "consulting", "serving", "called"]);
const normalize = (record, source) => {
  const fallback = record.date ? indiaDateTime(record.date) : {};
  const status = String(record.appointment_status || record.status || "pending").toLowerCase();
  return {
    id: String(record.id || record._id), source,
    doctorId: String(record.doctor_id || record.counselor?._id || record.counselor || ""),
    date: String(record.appointment_date || fallback.date || "").slice(0, 10),
    time: String(record.priority || "").toLowerCase() === "emergency" && !record.appointment_time ? "" : record.appointment_time || fallback.time || "",
    token: Number(record.token_number) > 0 ? Number(record.token_number) : null,
    createdAt: record.createdAt || record.created_at || null,
    status,
    queueStatus: String(record.queue_status || status).toLowerCase(),
    emergency: String(record.priority || "").toLowerCase() === "emergency",
    timing: record.consultation_timing || (record.consultation_started_at ? {
      startedAt: record.consultation_started_at, endedAt: record.consultation_ended_at,
    } : {}),
  };
};
const isActive = (item) => !terminal.has(item.status) && !terminal.has(item.queueStatus);
const isServing = (item) => serving.has(item.status) || serving.has(item.queueStatus);

export const formatTokenStatus = (own, records, doctor, ranges = [], breaks = [], now = Date.now()) => {
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
  const durationFor = (item) => Number(item.timing?.durationMinutes) || Number(ranges.find((range) =>
    buildDaySlots([range], item.date).some((slot) => timeMinutes(slot.time) === timeMinutes(item.time)))?.slot_duration) || defaultSlotDuration;
  const breakIntervals = breaks.map((record) => ({
    start: new Date(record.started_at).getTime(),
    end: record.ended_at ? new Date(record.ended_at).getTime() : new Date(record.started_at).getTime() + Number(record.planned_minutes) * 60000,
  })).filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end));
  const activeBreak = breakIntervals.find((interval) => interval.start <= now && interval.end > now);
  const manualPaused = current?.timing?.state === "paused";
  let elapsedSeconds = null;
  let estimatedTurnTime = null;
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
        if (isServing(item)) cursor += Math.max(0, duration * 60 - elapsedSeconds) * 1000;
        else cursor += duration * 60000;
      }
      if (known) estimatedTurnTime = new Date(isServing(own) ? now : cursor).toISOString();
    }
  }
  const doctorStatus = activeBreak ? "break" : manualPaused ? "paused" : current ? "consulting" : "waiting";

  const ownMinutes = timeMinutes(own.time);
  let computedDelayMinutes = 0;
  if (estimatedTurnTime && ownMinutes !== null) {
    const scheduledMs = new Date(`${own.date}T${own.time}+05:30`).getTime();
    const turnMs = new Date(estimatedTurnTime).getTime();
    if (turnMs > scheduledMs) {
      computedDelayMinutes = Math.max(0, Math.round((turnMs - scheduledMs) / 60000));
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
      createdAt: own.createdAt,
      doctor: { _id: own.doctorId, fullName: doctor?.fullName || "Doctor" },
      estimatedAppointmentTime: estimatedTurnTime ? indiaDateTime(estimatedTurnTime).time : (computedDelayMinutes > 0 && ownMinutes !== null ? clockTime(ownMinutes + computedDelayMinutes) : null),
      estimatedStartAt: estimatedTurnTime,
      delayMinutes: computedDelayMinutes,
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
    },
    emergency: { active: emergency.length > 0, totalEmergencyPatients: emergency.length,
      emergencyPatientsAhead: ahead.filter((item) => item.emergency).length },
  };
};

export const getMyTokenStatus = async (req, res) => {
  try {
    const userId = req.user._id;
    const [online, walkins] = await Promise.all([
      Appointment.find({ patient: userId }),
      WalkinAppointment.find({ patient_id: userId }),
    ]);
    const mine = [...online.map((record) => normalize(record, "online")), ...walkins.map((record) => normalize(record, "walkin"))]
      .sort((a, b) => {
        const timestamp = (item) => Date.parse(item.createdAt || `${item.date}T${item.time || "00:00:00"}+05:30`) || 0;
        return timestamp(b) - timestamp(a) || b.id.localeCompare(a.id);
      });
    const queues = new Map();
    const doctors = new Map();
    const schedules = new Map();
    const doctorBreaks = new Map();
    const appointments = await Promise.all(mine.map(async (own) => {
      if (!doctors.has(own.doctorId)) doctors.set(own.doctorId, User.findById(own.doctorId).select("fullName").lean());
      if (!isActive(own)) return formatTokenStatus(own, [], await doctors.get(own.doctorId));
      const key = `${own.doctorId}:${own.date}`;
      if (!queues.has(key)) queues.set(key, Promise.all([
        slotRepository.online(own.doctorId, own.date), slotRepository.walkins(own.doctorId, own.date),
      ]).then(([booked, walkin]) => [...booked.map((record) => normalize(record, "online")), ...walkin.map((record) => normalize(record, "walkin"))]));
      if (!schedules.has(own.doctorId)) schedules.set(own.doctorId, slotRepository.ranges(own.doctorId));
      if (!doctorBreaks.has(key)) doctorBreaks.set(key, tokenTimingRepository.breaks(own.doctorId, own.date));
      const [queue, doctor, ranges, breaks] = await Promise.all([queues.get(key), doctors.get(own.doctorId), schedules.get(own.doctorId), doctorBreaks.get(key)]);
      return formatTokenStatus(own, queue, doctor, ranges, breaks);
    }));
    res.set("Cache-Control", "private, no-store");
    return res.json({ success: true, appointments });
  } catch (error) {
    console.error("Failed to load token status:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load token status" });
  }
};
