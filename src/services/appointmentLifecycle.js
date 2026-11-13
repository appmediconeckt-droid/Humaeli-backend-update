const normalize = value => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

// Reconcile mobile/legacy completion metadata without changing stored history.
export function normalizeAppointmentLifecycle(record, source = 'online') {
  const status = normalize(source === 'walkin' ? record.appointment_status || record.status : record.status || record.appointment_status);
  if (['canceled', 'cancelled', 'rejected'].includes(status)) return record;
  let timing = record.consultation_timing || record.consultationTiming || {};
  if (typeof timing === 'string') { try { timing = JSON.parse(timing); } catch { timing = {}; } }
  const ended = record.consultation_ended_at || record.consultationEndedAt || timing.endedAt || timing.ended_at;
  const complete = [status, record.status, record.appointment_status, record.appointmentStatus, record.walkin_status, record.queue_status, record.queueStatus, timing.state]
    .some(value => ['completed', 'complete', 'done'].includes(normalize(value)))
    || (Boolean(ended) && Number.isFinite(Date.parse(ended)));
  if (!complete) return record;
  return { ...record, status: 'completed', appointment_status: 'completed', queue_status: 'completed' };
}
