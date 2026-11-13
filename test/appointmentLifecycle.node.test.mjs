import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAppointmentLifecycle } from '../src/services/appointmentLifecycle.js';

test('API responses reconcile completion from mobile queue/timing metadata for both appointment sources', () => {
 for (const source of ['online', 'walkin']) for (const completion of [
  { queue_status: 'completed' },
  { consultation_timing: { state: 'completed' } },
  { consultation_timing: JSON.stringify({ endedAt: '2026-11-03T08:00:00Z' }) },
  { consultation_ended_at: '2026-11-03T08:00:00Z' },
  { consultation_timing: JSON.stringify({ ended_at: '2026-11-03T08:00:00Z' }) },
  { consultationTiming: { ended_at: '2026-11-03T08:00:00Z' } },
  { consultationEndedAt: '2026-11-03T08:00:00Z' },
  { queueStatus: 'completed' },
  { status: 'completed' },
 ]) {
  const row = { status: 'confirmed', appointment_status: 'booked', ...completion };
  const saved = JSON.stringify(row);
  const result = normalizeAppointmentLifecycle(row, source);
  assert.equal(result.status, 'completed');
  assert.equal(result.appointment_status, 'completed');
  assert.equal(result.queue_status, 'completed');
  assert.equal(JSON.stringify(row), saved);
 }
});

test('active, cancelled, rejected and unpaid records are not fabricated as completions', () => {
 for (const status of ['confirmed', 'pending', 'canceled', 'cancelled', 'rejected', 'awaiting_payment']) {
  const row = { status, consultation_timing: '{invalid' };
  assert.equal(normalizeAppointmentLifecycle(row), row);
 }
 const cancelled = { status: 'canceled', queue_status: 'completed', consultation_ended_at: '2026-11-03T08:00:00Z' };
 assert.equal(normalizeAppointmentLifecycle(cancelled), cancelled);
});
