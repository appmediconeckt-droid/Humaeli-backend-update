import { buildDaySlots, indiaDateTime, slotRepository, timeMinutes } from "./appointmentSlotService.js";
import { notifyNextQueueTokens } from './queueTurnNotificationService.js';
import { normalizeQueueAppointment } from "./queueTimingService.js";

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

export const getAppointmentSessionEnd = async (appointment, availableRanges) => {
  const doctorId = appointment.doctor_id || appointment.counselor;
  const fallback = appointment.date ? indiaDateTime(appointment.date) : {};
  const date = appointment.appointment_date || fallback.date;
  const minutes = timeMinutes(appointment.appointment_time || fallback.time);
  if (!doctorId || !date || minutes == null) return null;
  const ranges = (availableRanges || await slotRepository.ranges(doctorId)).filter((range) =>
    !appointment.clinic_id || !range.clinic_id || String(range.clinic_id) === String(appointment.clinic_id));
  const specific = ranges.filter((range) => String(range.availability_date || range.date || '').slice(0, 10) === date);
  const matches = (specific.length ? specific : ranges).filter((range) => {
    try { return buildDaySlots([range], date).some((slot) => timeMinutes(slot.time) === minutes); }
    catch { return false; }
  });
  if (!matches.length) return null;
  const end = Math.max(...matches.map((range) => timeMinutes(range.end_time)).filter((value) => value != null));
  const midnight = new Date(`${date}T00:00:00+05:30`).getTime();
  return Number.isFinite(end) && Number.isFinite(midnight) ? new Date(midnight + end * 60000) : null;
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
  const previous = normalizeQueueAppointment(appointment).timing;
  let duration = previous.durationMinutes;
  if (action === "start" && !previous.startedAt) {
    duration = await getAppointmentSlotDuration(appointment);
  }
  return consultationTransition(previous, action, duration);
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

const terminalStatuses = new Set(["completed", "cancelled", "canceled", "rejected", "reject", "no-show", "no_show", "skipped"]);
// A called patient is next in line until their consultation actually starts.
const servingStatuses = new Set(["in-progress", "in_progress", "in_consultation", "consulting", "serving"]);
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
    urgent: String(record.priority || '').toLowerCase() === 'urgent',
    clinicId: String(record.clinic_id?._id || record.clinic_id?.id || record.clinic_id || ''),
  };
};

const isActiveQueueRecord = (item) => !terminalStatuses.has(item.status) && !terminalStatuses.has(item.queueStatus);
const isServingQueueRecord = (item) => servingStatuses.has(item.status) || servingStatuses.has(item.queueStatus);

export const notifyUpcomingQueuePatients = async (appointment, { limit = 2 } = {}) => {
  try {
    const doctorId = appointment.doctor_id || appointment.counselor;
    const date = appointment.appointment_date || (appointment.date ? indiaDateTime(appointment.date).date : null);
    if (!doctorId || !date) return [];
    const clinicId = String(appointment.clinic_id?._id || appointment.clinic_id?.id || appointment.clinic_id || '');

    const [online, walkins] = await Promise.all([
      slotRepository.online(doctorId, date),
      slotRepository.walkins(doctorId, date),
    ]);
    const queue = [
      ...online.map((record) => normalizeQueueRecord(record, "online")),
      ...walkins.map((record) => normalizeQueueRecord(record, "walkin")),
    ].filter((item) => item.doctorId === String(doctorId) && item.date === date &&
      item.clinicId === clinicId && isActiveQueueRecord(item))
      .sort((a, b) => Number(isServingQueueRecord(b)) - Number(isServingQueueRecord(a))
        || Number(b.queueStatus === 'called') - Number(a.queueStatus === 'called')
        || Number(b.emergency) - Number(a.emergency)
        || Number(b.urgent) - Number(a.urgent)
        || (timeMinutes(a.time) ?? 1440) - (timeMinutes(b.time) ?? 1440)
        || (a.token ?? Infinity) - (b.token ?? Infinity)
        || a.id.localeCompare(b.id));

    const waiting = queue
      .filter((item) => !isServingQueueRecord(item) && item.token !== null)
      .slice(0, limit);
    const serving = queue.find(isServingQueueRecord);
    await notifyNextQueueTokens(waiting, { doctorId, date, clinicId, limit,
      currentAppointmentId: serving?.id || '' });
    return waiting;
  } catch (error) {
    console.error("Upcoming queue notification failed:", error.message);
    return [];
  }
};
