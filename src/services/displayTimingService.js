import { DoctorBreak } from '../models/clinicModels.js';
import { slotRepository } from './appointmentSlotService.js';
import { calculateEstimatedQueue, normalizeQueueAppointment, isServingQueueAppointment, queueRecordKey } from './queueTimingService.js';

export const displayTimingRepository = {
  online: slotRepository.online,
  walkins: slotRepository.walkins,
  ranges: slotRepository.ranges,
  breaks: (doctorId, date) => {
    const start = new Date(`${date}T00:00:00+05:30`);
    return DoctorBreak.find({ doctor_id: doctorId, started_at: { $gte: start, $lt: new Date(start.getTime() + 86400000) } }).lean();
  },
};
const clock = value => value == null || !Number.isFinite(new Date(value).getTime()) ? null :
  new Date(value).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();

export function buildDisplayTiming({ doctorId, date, clinicId = '', records = [], ranges = [], breaks = [], now = Date.now(), nextAppointmentId, nextToken }) {
  const scoped = records.filter(item => item.doctorId === String(doctorId) && item.date === date && item.clinicId === String(clinicId));
  const state = calculateEstimatedQueue(scoped, { doctorId: String(doctorId), date, clinicId: String(clinicId), ranges, breaks, now });
  const activeBreak = breaks.find(row => row.status === 'active' &&
    new Date(row.started_at).getTime() <= now && new Date(row.started_at).getTime() + Number(row.planned_minutes) * 60000 > now);
  const breakEnd = activeBreak ? new Date(new Date(activeBreak.started_at).getTime() + Number(activeBreak.planned_minutes) * 60000) : null;
  const next = state.queue.find(item => item !== state.current && item.token !== null &&
    (nextAppointmentId ? item.id === String(nextAppointmentId) : nextToken != null ? String(item.token) === String(nextToken) : true));
  const estimate = next ? state.estimates.get(queueRecordKey(next)) : null;
  const current = state.queue.find(isServingQueueAppointment);
  const delayTarget = current && !current.timing?.startedAt ? current : next || current;
  const delayEstimate = delayTarget ? state.estimates.get(queueRecordKey(delayTarget)) : null;
  const scheduledAt = delayEstimate?.scheduledStartAt;
  const unstarted = Boolean(delayTarget && !delayTarget.timing?.startedAt);
  const overdueMinutes = unstarted && scheduledAt ? Math.max(0, Math.floor((now - new Date(scheduledAt).getTime()) / 60000)) : 0;
  const delayMinutes = Math.max(overdueMinutes, Number(delayEstimate?.timingDifferenceMinutes) || 0, 0);
  const waitingForDoctor = unstarted && overdueMinutes > 0 && !current?.timing?.startedAt;
  const expectedAt = estimate?.estimatedStartAt || (breakEnd ? breakEnd.toISOString() : null);
  const paused = state.doctorStatus === 'paused';
  const late = !paused && !activeBreak && delayMinutes > 0;
  const hasNext = Boolean(next || nextAppointmentId || nextToken != null);
  let estimatedWaitMinutes = estimate?.estimateUncertain ? null : estimate?.waitingMinutes ?? null;
  let estimatedWaitLabel = null;
  if (!hasNext) estimatedWaitLabel = 'No waiting patients';
  else if (paused && !activeBreak) estimatedWaitLabel = 'Paused';
  else if (activeBreak && estimatedWaitMinutes == null) {
    const scheduledWait = estimate?.scheduledStartAt ? Math.ceil((new Date(estimate.scheduledStartAt).getTime() - now) / 60000) : 0;
    const minimum = Math.max(0, scheduledWait, Math.ceil((breakEnd.getTime() - now) / 60000));
    estimatedWaitLabel = `At least ${minimum} min`;
  } else if (waitingForDoctor) {
    estimatedWaitMinutes = null;
    estimatedWaitLabel = 'Awaiting doctor';
  } else if (estimatedWaitMinutes == null) estimatedWaitLabel = 'Updating estimate';
  return {
    timingAvailable: true,
    doctorStatus: activeBreak ? 'break' : waitingForDoctor && !paused ? 'delayed' : state.doctorStatus,
    estimatedWaitMinutes, estimatedWaitLabel,
    breakInfo: {
      headline: activeBreak ? 'Doctor is on break' : paused ? 'Consultation paused' : late ? `${delayMinutes} min late` : 'No delay reported',
      delayMinutes, scheduledStart: clock(scheduledAt), waitingForDoctor,
      expectedStart: clock(expectedAt), expectedStartAt: expectedAt,
      breakTime: activeBreak ? `${clock(activeBreak.started_at)} – ${clock(breakEnd)}` : 'No active break',
      startedAt: activeBreak ? new Date(activeBreak.started_at).toISOString() : null,
      endsAt: breakEnd?.toISOString() || null,
      resumeMinutes: breakEnd ? Math.max(0, Math.ceil((breakEnd.getTime() - now) / 60000)) : null,
      reason: activeBreak ? activeBreak.reason || 'Doctor break' : paused ? 'Consultation paused by doctor' : waitingForDoctor ? 'Consultation has not started' : late ? 'Live consultation queue' : 'No delay reported',
    },
  };
}

export async function getDisplayTiming({ doctorId, date, clinicId = '', timings, nextAppointmentId, nextToken }) {
  try {
    const [online, walkins, ranges, breaks] = await Promise.all([
      displayTimingRepository.online(doctorId, date), displayTimingRepository.walkins(doctorId, date),
      timings ? Promise.resolve(timings) : displayTimingRepository.ranges(doctorId),
      displayTimingRepository.breaks(doctorId, date),
    ]);
    const normalizedRanges = ranges.map(row => ({ ...row,
      weekday: row.weekday ?? row.day, start_time: row.start_time ?? row.startTime,
      end_time: row.end_time ?? row.endTime, slot_duration: row.slot_duration ?? row.slotDuration,
    }));
    return buildDisplayTiming({ doctorId, date, clinicId, ranges: normalizedRanges, breaks, nextAppointmentId, nextToken,
      records: [...online.map(row => normalizeQueueAppointment(row, 'online')), ...walkins.map(row => normalizeQueueAppointment(row, 'walkin'))] });
  } catch (error) {
    console.error('Display timing lookup failed:', error.message);
    return { timingAvailable: false, estimatedWaitMinutes: null, estimatedWaitLabel: 'Timing unavailable',
      breakInfo: { headline: 'Timing temporarily unavailable', reason: 'Timing temporarily unavailable' } };
  }
}
