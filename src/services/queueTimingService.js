import { buildDaySlots, indiaDateTime, timeMinutes } from './appointmentSlotService.js';

const MINUTE = 60000;
const terminal = new Set(['completed', 'complete', 'done', 'cancelled', 'canceled', 'rejected', 'reject', 'no-show', 'no_show', 'skipped']);
const serving = new Set(['in-progress', 'in_progress', 'in_consultation', 'consulting', 'serving', 'called']);
const timestamp = (value) => value == null || value === '' ? null : Number.isFinite(new Date(value).getTime()) ? new Date(value).getTime() : null;
const iso = (value) => value == null ? null : new Date(value).toISOString();
const idOf = (value) => String(value?._id || value?.id || value || '');
export const patientGraceMinutes = () => {
  const value = Number(process.env.PATIENT_GRACE_PERIOD_MINUTES ?? 5);
  return Number.isFinite(value) && value >= 0 ? value : 5;
};
export const calculateCancellationDeadline = (estimated) => {
  const start = timestamp(estimated);
  return start == null ? null : iso(start + patientGraceMinutes() * MINUTE);
};
export const queueRecordKey = (item) => `${item.source}:${item.id}`;
export const scheduledQueueTime = (date, time) => {
  const minutes = timeMinutes(time);
  if (!date || minutes == null) return null;
  return iso(timestamp(`${date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00+05:30`));
};

export const normalizeQueueAppointment = (record, source = record.source || 'online') => {
  let fallback = {};
  try { if (record.date) fallback = indiaDateTime(record.date); } catch { /* Invalid legacy dates have no schedule. */ }
  let timing = record.timing || record.consultation_timing || {};
  if (typeof timing === 'string') { try { timing = JSON.parse(timing); } catch { timing = {}; } }
  if (!timing || typeof timing !== 'object') timing = {};
  const emergency = record.emergency ?? String(record.priority || '').toLowerCase() === 'emergency';
  const time = record.time ?? (emergency && !record.appointment_time ? '' : record.appointment_time || fallback.time || '');
  const status = String(record.appointment_status || record.status || 'pending').toLowerCase();
  return {
    id: idOf(record.id || record._id), source,
    doctorId: idOf(record.doctorId || record.doctor_id || record.counselor || record.counselorId || record.doctor),
    clinicId: idOf(record.clinicId || record.clinic_id),
    patientId: idOf(record.patientId || record.patient_id || record.patient),
    date: String(record.appointment_date || (record.source ? record.date : fallback.date) || '').slice(0, 10),
    time: scheduledQueueTime('2000-01-01', time) ? indiaDateTime(scheduledQueueTime('2000-01-01', time)).time : String(time),
    token: Number(record.token ?? record.token_number) > 0 ? Number(record.token ?? record.token_number) : null,
    createdAt: record.createdAt || record.created_at || null,
    patientArrivalTime: record.patientArrivalTime || record.checked_in_at || null,
    calledAt: record.calledAt || record.called_at || null,
    status, queueStatus: String(record.queueStatus || record.queue_status || status).toLowerCase(), emergency,
    timing: {
      ...timing,
      startedAt: timing.startedAt || timing.started_at || record.consultation_started_at || null,
      endedAt: timing.endedAt || timing.ended_at || record.consultation_ended_at || null,
      pauses: Array.isArray(timing.pauses) ? timing.pauses : [],
    },
  };
};

export const isActiveQueueAppointment = (item) => !terminal.has(item.status) && !terminal.has(item.queueStatus) && timestamp(item.timing?.endedAt) == null;
export const isServingQueueAppointment = (item) => isActiveQueueAppointment(item) && (serving.has(item.status) || serving.has(item.queueStatus));
export const calculateWaitingMinutes = (estimated, now) => estimated == null ? null : Math.max(0, Math.ceil((estimated - now) / MINUTE));
export const calculateTimingDifference = (start, scheduled) => start == null || scheduled == null ? null : Math.round((start - scheduled) / MINUTE);
export const getTimingLabel = (difference, started = false) => difference == null ? null :
  `${started ? 'Started ' : ''}${difference === 0 ? 'on time' : `${Math.abs(difference)} min ${difference > 0 ? 'late' : 'early'}`}`;

const mergeIntervals = (intervals) => {
  const merged = [];
  for (const interval of intervals.filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start).sort((a, b) => a.start - b.start)) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
};
const skipInterruptions = (start, intervals) => {
  for (const interval of intervals) if (interval.start <= start && interval.end > start) start = interval.end;
  return start;
};
const workEnd = (start, duration, intervals) => {
  let end = start + duration * MINUTE;
  for (const interval of intervals) {
    if (interval.start >= end) break;
    if (interval.end > start) end += interval.end - Math.max(start, interval.start);
  }
  return end;
};

/** Pure read-time calculation. Booked times, tokens and persisted timing are never modified. */
export const calculateEstimatedQueue = (records, { doctorId, date, clinicId = '', ranges = [], breaks = [], now = Date.now(), clampToNow = true } = {}) => {
  const scoped = records.filter((item) => item.doctorId === doctorId && item.date === date &&
    (!clinicId || !item.clinicId || item.clinicId === clinicId));
  const scopedRanges = ranges.filter((range) => !clinicId || !range.clinic_id || idOf(range.clinic_id) === clinicId);
  const durationFor = (item) => {
    if (Number(item.timing?.durationMinutes) > 0) return Number(item.timing.durationMinutes);
    const range = scopedRanges.find((range) => {
      if (item.clinicId && range.clinic_id && idOf(range.clinic_id) !== item.clinicId) return false;
      try { return buildDaySlots([range], item.date).some((slot) => timeMinutes(slot.time) === timeMinutes(item.time)); }
      catch { return false; }
    });
    return Number(range?.slot_duration) || Number(scopedRanges[0]?.slot_duration) || 15;
  };
  const breakIntervals = mergeIntervals(breaks.filter((record) => !['cancelled', 'canceled'].includes(record.status)).map((record) => {
    const start = timestamp(record.started_at);
    return { start, end: timestamp(record.ended_at) ?? (start == null ? null : start + (Number(record.planned_minutes) || 15) * MINUTE) };
  }));
  const activeBreak = breakIntervals.find(({ start, end }) => start <= now && end > now);
  const queue = scoped.filter(isActiveQueueAppointment).sort((a, b) =>
    Number(Boolean(b.timing?.startedAt)) - Number(Boolean(a.timing?.startedAt)) ||
    Number(isServingQueueAppointment(b)) - Number(isServingQueueAppointment(a)) || Number(b.emergency) - Number(a.emergency) ||
    (timeMinutes(a.time) ?? 1440) - (timeMinutes(b.time) ?? 1440) || (a.token ?? Infinity) - (b.token ?? Infinity) || a.id.localeCompare(b.id) || a.source.localeCompare(b.source));
  const current = queue.find(isServingQueueAppointment);
  const manualPaused = current?.timing?.state === 'paused';
  const started = timestamp(current?.timing?.startedAt);
  const pauses = mergeIntervals([...breakIntervals, ...(current?.timing?.pauses || []).map((pause) => ({
    start: timestamp(pause.startedAt || pause.started_at), end: timestamp(pause.endedAt || pause.ended_at) ?? now,
  }))]);
  const pausedMs = started == null ? 0 : pauses.reduce((sum, { start, end }) => sum + Math.max(0, Math.min(now, end) - Math.max(started, start)), 0);
  const elapsedSeconds = started == null ? null : Math.max(0, Math.floor((now - started - pausedMs) / 1000));
  const completedEnds = scoped.filter((item) => !['cancelled', 'canceled', 'rejected', 'reject'].includes(item.status))
    .map((item) => timestamp(item.timing?.endedAt)).filter((end) => end != null && end <= now);
  let cursor = Math.max(clampToNow ? now : -Infinity, ...completedEnds);
  if (!Number.isFinite(cursor)) cursor = Math.min(now, ...queue.map((item) => timestamp(scheduledQueueTime(item.date, item.time))).filter((value) => value != null));
  let uncertain = Boolean(current && started == null);
  const estimates = new Map();
  for (const item of queue) {
    const scheduled = timestamp(scheduledQueueTime(item.date, item.time));
    const actualStart = timestamp(item.timing?.startedAt);
    const duration = durationFor(item);
    let estimatedStart = null, estimatedEnd = null;
    if (item === current && actualStart != null) {
      estimatedStart = actualStart;
      estimatedEnd = workEnd(actualStart, duration, pauses);
      if (estimatedEnd <= now) { estimatedEnd = now + MINUTE; uncertain = true; }
      cursor = estimatedEnd;
    } else if (item === current && timestamp(item.calledAt) != null && !manualPaused && !activeBreak) {
      // An explicitly called, absent patient gets a stable deadline. Clamping
      // their estimate to now on every worker tick would prevent expiry forever.
      const afterCallBreakEnds = breakIntervals.filter(({ start }) => start >= timestamp(item.calledAt) && start <= now).map(({ end }) => end);
      estimatedStart = skipInterruptions(Math.max(timestamp(item.calledAt), scheduled ?? -Infinity, ...completedEnds, ...afterCallBreakEnds), breakIntervals);
      estimatedEnd = workEnd(estimatedStart, duration, breakIntervals);
      cursor = Math.max(now, estimatedEnd);
      uncertain = false;
    } else if (!manualPaused && (!uncertain || started != null)) {
      // Walk-ins retain their assigned slot floor; emergency priority can bypass it.
      estimatedStart = skipInterruptions(Math.max(cursor, item.emergency ? cursor : scheduled ?? cursor), breakIntervals);
      estimatedEnd = workEnd(estimatedStart, duration, breakIntervals);
      cursor = estimatedEnd;
    }
    const difference = calculateTimingDifference(actualStart ?? estimatedStart, scheduled);
    estimates.set(queueRecordKey(item), {
      scheduledStartAt: iso(scheduled), estimatedStartAt: iso(estimatedStart), estimatedEndAt: iso(estimatedEnd),
      cancelDeadline: calculateCancellationDeadline(iso(estimatedStart)), patientArrivalTime: item.patientArrivalTime || null,
      actualStartAt: iso(actualStart), actualEndAt: iso(timestamp(item.timing?.endedAt)), expectedDurationMinutes: duration,
      waitingMinutes: item === current && actualStart != null ? 0 : calculateWaitingMinutes(estimatedStart, now),
      timingDifferenceMinutes: difference, timingRelation: difference == null ? null : difference > 0 ? 'late' : difference < 0 ? 'early' : 'on_time',
      timingLabel: getTimingLabel(difference, actualStart != null), estimateUncertain: uncertain && item !== current,
    });
  }
  // History remains available to existing history consumers without rejoining the live queue.
  for (const item of scoped.filter((item) => !isActiveQueueAppointment(item))) {
    const scheduled = timestamp(scheduledQueueTime(item.date, item.time));
    const actualStart = timestamp(item.timing?.startedAt);
    const actualEnd = timestamp(item.timing?.endedAt);
    const difference = calculateTimingDifference(actualStart, scheduled);
    estimates.set(queueRecordKey(item), {
      scheduledStartAt: iso(scheduled), estimatedStartAt: iso(actualStart), estimatedEndAt: iso(actualEnd), actualStartAt: iso(actualStart), actualEndAt: iso(actualEnd),
      expectedDurationMinutes: durationFor(item), waitingMinutes: null, timingDifferenceMinutes: difference,
      timingRelation: difference == null ? null : difference > 0 ? 'late' : difference < 0 ? 'early' : 'on_time', timingLabel: getTimingLabel(difference, actualStart != null), estimateUncertain: false,
    });
  }
  return { queue, current, estimates, elapsedSeconds, durationMinutes: current ? durationFor(current) : null,
    doctorStatus: activeBreak ? 'break' : manualPaused ? 'paused' : current ? 'consulting' : 'waiting' };
};
