import { buildDaySlots, indiaDateTime, slotRepository, timeMinutes } from "./appointmentSlotService.js";

export const consultationTransition = (previous, action, duration, now = new Date()) => {
  const timing = structuredClone(previous || {});
  const at = now.toISOString();
  if (action === "start") {
    if (!timing.startedAt) {
      Object.assign(timing, { startedAt: at, endedAt: null, pauses: [], durationMinutes: duration || null, state: "consulting" });
    }
    return timing;
  }
  if (!timing.startedAt || timing.endedAt) return timing;
  if (action === "pause" && timing.state !== "paused") {
    timing.pauses = [...(timing.pauses || []), { startedAt: at, endedAt: null }];
    timing.state = "paused";
  }
  if (action === "resume" && timing.state === "paused") {
    const last = timing.pauses?.at(-1);
    if (last && !last.endedAt) last.endedAt = at;
    timing.state = "consulting";
  }
  if (action === "end") {
    const last = timing.pauses?.at(-1);
    if (last && !last.endedAt) last.endedAt = at;
    timing.endedAt = at;
    timing.state = "completed";
  }
  return timing;
};

export const getConsultationTiming = async (appointment, body) => {
  if (body.consultation_action && !["pause", "resume"].includes(body.consultation_action)) {
    throw Object.assign(new Error("Invalid consultation action"), { status: 400 });
  }
  const status = String(body.appointment_status || body.status || "").toLowerCase();
  const action = body.consultation_action || (status === "in-progress" ? "start" : ["completed", "cancelled", "canceled"].includes(status) ? "end" : null);
  if (!action) return appointment.consultation_timing;
  if (!["start", "pause", "resume", "end"].includes(action)) throw Object.assign(new Error("Invalid consultation action"), { status: 400 });
  let duration = appointment.consultation_timing?.durationMinutes;
  if (action === "start" && !appointment.consultation_timing?.startedAt) {
    const doctorId = appointment.doctor_id || appointment.counselor;
    const fallback = appointment.date ? indiaDateTime(appointment.date) : {};
    const date = appointment.appointment_date || fallback.date;
    const time = appointment.appointment_time || fallback.time;
    const ranges = await slotRepository.ranges(doctorId);
    const range = date && ranges.find((range) =>
      (!appointment.clinic_id || !range.clinic_id || String(range.clinic_id) === String(appointment.clinic_id)) &&
      buildDaySlots([range], date).some((slot) => timeMinutes(slot.time) === timeMinutes(time)));
    duration = range ? Number(range.slot_duration) : null;
  }
  return consultationTransition(appointment.consultation_timing, action, duration);
};

// Timing updates contain no patient details and go only to affected users.
export const emitQueueUpdated = async (appointment) => {
  if (!global.io) return;
  try {
    const doctorId = appointment.doctor_id || appointment.counselor;
    const date = appointment.appointment_date || (appointment.date ? indiaDateTime(appointment.date).date : null);
    if (!doctorId || !date) return;
    const [online, walkins] = await Promise.all([slotRepository.online(doctorId, date), slotRepository.walkins(doctorId, date)]);
    const ids = new Set([String(doctorId), ...online.map((item) => item.patient?._id || item.patient), ...walkins.map((item) => item.patient_id)].filter(Boolean));
    for (const id of ids) global.io.to(`user_${id}`).emit("queueUpdated", { doctorId, date });
  } catch (error) { console.error("Queue update notification failed:", error.message); }
};
