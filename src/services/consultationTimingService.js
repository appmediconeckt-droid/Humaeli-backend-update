import { buildDaySlots, indiaDateTime, slotRepository, timeMinutes } from "./appointmentSlotService.js";
import { createNotificationSafely } from "./notificationService.js";

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

export const getAppointmentSlotDuration = async (appointment, availableRanges) => {
  const doctorId = appointment.doctor_id || appointment.counselor;
  const fallback = appointment.date ? indiaDateTime(appointment.date) : {};
  const date = appointment.appointment_date || fallback.date;
  const time = appointment.appointment_time || fallback.time;
  if (!doctorId || !date || !time) return 0;

  const ranges = availableRanges || await slotRepository.ranges(doctorId);
  const range = ranges.find((item) =>
    (!appointment.clinic_id || !item.clinic_id || String(item.clinic_id) === String(appointment.clinic_id)) &&
    buildDaySlots([item], date).some((slot) => timeMinutes(slot.time) === timeMinutes(time))
  );
  return Number(range?.slot_duration) || 0;
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
    duration = await getAppointmentSlotDuration(appointment);
  }
  return consultationTransition(appointment.consultation_timing, action, duration);
};

const activeConsultationStatuses = new Set(["in-progress", "in_progress", "consulting", "serving"]);
export const findOtherActiveConsultation = async (appointment) => {
  const doctorId = appointment.doctor_id || appointment.counselor;
  const date = appointment.appointment_date || (appointment.date ? indiaDateTime(appointment.date).date : null);
  const ownId = String(appointment.id || appointment._id || "");
  if (!doctorId || !date || !ownId) return null;

  const [onlineResult, walkinResult] = await Promise.allSettled([
    slotRepository.online(doctorId, date),
    slotRepository.walkins(doctorId, date),
  ]);
  const online = onlineResult.status === "fulfilled" ? onlineResult.value : [];
  const walkins = walkinResult.status === "fulfilled" ? walkinResult.value : [];
  return [
    ...online.map((record) => ({ record, source: "online" })),
    ...walkins.map((record) => ({ record, source: "walkin" })),
  ].find(({ record }) => {
    const id = String(record.id || record._id || "");
    if (id === ownId) return false;
    const status = String(record.appointment_status || record.status || "").toLowerCase();
    const queueStatus = String(record.queue_status || "").toLowerCase();
    return activeConsultationStatuses.has(status) || activeConsultationStatuses.has(queueStatus);
  }) || null;
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

const terminalStatuses = new Set(["completed", "cancelled", "canceled", "rejected", "reject", "no-show", "no_show"]);
const servingStatuses = new Set(["in-progress", "in_progress", "consulting", "serving", "called"]);
const normalizeQueueRecord = (record, source) => {
  const fallback = record.date ? indiaDateTime(record.date) : {};
  const status = String(record.appointment_status || record.status || "pending").toLowerCase();
  return {
    id: String(record.id || record._id),
    source,
    doctorId: String(record.doctor_id || record.counselor?._id || record.counselor || ""),
    date: String(record.appointment_date || fallback.date || "").slice(0, 10),
    time: String(record.priority || "").toLowerCase() === "emergency" && !record.appointment_time ? "" : record.appointment_time || fallback.time || "",
    token: Number(record.token_number) > 0 ? Number(record.token_number) : null,
    patientId: record.patient?._id || record.patient || record.patient_id || null,
    status,
    queueStatus: String(record.queue_status || status).toLowerCase(),
    emergency: String(record.priority || "").toLowerCase() === "emergency",
  };
};

const isActiveQueueRecord = (item) => !terminalStatuses.has(item.status) && !terminalStatuses.has(item.queueStatus);
const isServingQueueRecord = (item) => servingStatuses.has(item.status) || servingStatuses.has(item.queueStatus);

export const notifyUpcomingQueuePatients = async (appointment, { limit = 2 } = {}) => {
  try {
    const doctorId = appointment.doctor_id || appointment.counselor;
    const date = appointment.appointment_date || (appointment.date ? indiaDateTime(appointment.date).date : null);
    if (!doctorId || !date) return [];

    const [online, walkins] = await Promise.all([
      slotRepository.online(doctorId, date),
      slotRepository.walkins(doctorId, date),
    ]);
    const queue = [
      ...online.map((record) => normalizeQueueRecord(record, "online")),
      ...walkins.map((record) => normalizeQueueRecord(record, "walkin")),
    ].filter((item) => item.doctorId === String(doctorId) && item.date === date && isActiveQueueRecord(item))
      .sort((a, b) => Number(isServingQueueRecord(b)) - Number(isServingQueueRecord(a))
        || Number(b.emergency) - Number(a.emergency)
        || (timeMinutes(a.time) ?? 1440) - (timeMinutes(b.time) ?? 1440)
        || a.id.localeCompare(b.id));

    const currentIndex = queue.findIndex((item) => item.id === String(appointment.id || appointment._id));
    const waiting = queue.slice(currentIndex >= 0 ? currentIndex + 1 : 0)
      .filter((item) => !isServingQueueRecord(item) && item.patientId)
      .slice(0, limit);

    await Promise.all(waiting.map((item) => createNotificationSafely({
      recipientId: item.patientId,
      actorId: doctorId,
      type: "appointment",
      title: "Your turn is coming soon",
      message: "Your number may come within 30 minutes. Please stay near the clinic.",
      data: {
        type: "QUEUE_TURN_SOON",
        doctorId: String(doctorId),
        appointmentId: item.id,
        source: item.source,
        token: item.token,
        appointmentDate: item.date,
      },
      actionUrl: "/appointments",
    })));
    return waiting;
  } catch (error) {
    console.error("Upcoming queue notification failed:", error.message);
    return [];
  }
};
