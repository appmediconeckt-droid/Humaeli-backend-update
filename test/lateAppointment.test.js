import { expect } from 'chai';
import sinon from 'sinon';
import Appointment from '../src/models/appointmentModel.js';
import DoctorBreak from '../src/models/doctorBreakModel.js';
import Notification from '../src/models/Notification.js';
import User from '../src/models/userModel.js';
import { slotRepository } from '../src/services/appointmentSlotService.js';
import { calculateEstimatedQueue, normalizeQueueAppointment, queueRecordKey, calculateCancellationDeadline } from '../src/services/queueTimingService.js';
import { shouldAutoCancelLateAppointment, checkAndAutoCancelLateAppointments } from '../src/services/lateAppointmentService.js';
import { cancelAbsentAppointment } from '../src/services/appointmentCancellationService.js';

const at = (time) => new Date(`2026-10-10T${time}:00+05:30`);
const row = (id, time, changes = {}) => ({ _id: id, counselor: 'doctor', clinic_id: 'clinic',
  appointment_date: '2026-10-10', appointment_time: time, date: at(time),
  token_number: Number(id), status: 'confirmed', queue_status: 'booked',
  consultation_timing: { durationMinutes: 10 }, ...changes });
const stateFor = (rows, now, breaks = []) => calculateEstimatedQueue(rows.map((item) => normalizeQueueAppointment(item)),
  { doctorId: 'doctor', clinicId: 'clinic', date: '2026-10-10', now: at(now).getTime(), breaks });
const estimate = (state, item) => state.estimates.get(queueRecordKey(normalizeQueueAppointment(item)));
const called = () => row('2', '11:00', { queue_status: 'called', called_at: at('11:00') });

describe('Dynamic grace deadline and real-turn cancellation', () => {
  afterEach(() => sinon.restore());
  it('on-time start keeps the next original schedule and deadline', () => {
    const current = row('1', '10:00', { queue_status: 'in_progress', consultation_timing: { startedAt: at('10:00'), durationMinutes: 10 } });
    const next = row('2', '10:10');
    expect(estimate(stateFor([current, next], '10:00'), next).estimatedStartAt).to.equal(at('10:10').toISOString());
    expect(estimate(stateFor([current, next], '10:00'), next).cancelDeadline).to.equal(at('10:15').toISOString());
  });
  it('20-minute late start shifts all remaining patients deterministically', () => {
    const current = row('1', '10:00', { queue_status: 'in_progress', consultation_timing: { startedAt: at('10:20'), durationMinutes: 10 } });
    const rows = [current, row('2', '10:10'), row('3', '10:20'), row('4', '10:30')];
    const before = structuredClone(rows);
    for (let run = 0; run < 2; run++) {
      const state = stateFor(rows, '10:20');
      expect(rows.slice(1).map((item) => estimate(state, item).estimatedStartAt)).to.deep.equal(['10:30', '10:40', '10:50'].map((time) => at(time).toISOString()));
    }
    expect(rows).to.deep.equal(before);
  });
  it('20-minute consultation on a 10-minute schedule shifts future estimates ten minutes', () => {
    const done = row('1', '10:00', { status: 'completed', queue_status: 'completed', consultation_timing: { startedAt: at('10:00'), endedAt: at('10:20'), durationMinutes: 10 } });
    const rows = [done, row('2', '10:10'), row('3', '10:20')];
    const state = stateFor(rows, '10:20');
    expect(estimate(state, rows[1]).estimatedStartAt).to.equal(at('10:20').toISOString());
    expect(estimate(state, rows[2]).estimatedStartAt).to.equal(at('10:30').toISOString());
  });
  it('arrival at 10:55 for a shifted 11:00 estimate remains valid', () => {
    const own = row('2', '10:30', { queue_status: 'called', called_at: at('11:00'), checked_in_at: at('10:55') });
    const state = stateFor([own], '11:06');
    expect(estimate(state, own).estimatedStartAt).to.equal(at('11:00').toISOString());
    expect(shouldAutoCancelLateAppointment(own, state, at('11:06').getTime())).to.equal(false);
  });
  it('cancels only strictly after grace and never continually advances a called deadline', () => {
    const own = called();
    for (const time of ['11:00', '11:05', '11:06', '11:10']) {
      const state = stateFor([own], time);
      expect(estimate(state, own).cancelDeadline).to.equal(at('11:05').toISOString());
      expect(Boolean(shouldAutoCancelLateAppointment(own, state, at(time).getTime()))).to.equal(['11:06', '11:10'].includes(time));
    }
  });
  it('previous consultation protects even a prematurely called next token', () => {
    const own = called(), previous = row('1', '10:50', { queue_status: 'in_progress', consultation_timing: { startedAt: at('10:50'), durationMinutes: 10 } });
    const state = stateFor([own, previous], '11:06');
    expect(state.current.id).to.equal('1');
    expect(Boolean(shouldAutoCancelLateAppointment(own, state, at('11:06').getTime()))).to.equal(false);
  });
  it('four uncalled bookings survive the 12:00 slot end', () => {
    const rows = ['11:20', '11:30', '11:40', '11:50'].map((time, i) => row(String(i + 1), time));
    const state = stateFor(rows, '12:30');
    expect(state.queue).to.have.length(4);
    for (const item of rows) expect(Boolean(shouldAutoCancelLateAppointment(item, state, at('12:30').getTime()))).to.equal(false);
  });
  it('15-minute break shifts the next estimates and recomputes deadlines', () => {
    const rows = [row('1', '10:00'), row('2', '10:10')];
    const state = stateFor(rows, '10:00', [{ started_at: at('10:00'), ended_at: at('10:15'), status: 'ended' }]);
    expect(estimate(state, rows[0]).estimatedStartAt).to.equal(at('10:15').toISOString());
    expect(estimate(state, rows[1]).cancelDeadline).to.equal(at('10:30').toISOString());
  });
  it('emergency insertion shifts normal patients without changing booked times', () => {
    const own = row('2', '10:00'), emergency = row('9', '10:00', { priority: 'emergency', appointment_time: null });
    const state = stateFor([own, emergency], '10:00');
    expect(state.queue[0].id).to.equal('9');
    expect(estimate(state, own).estimatedStartAt).to.equal(at('10:10').toISOString());
    expect(own.appointment_time).to.equal('10:00');
  });
  it('active break prevents expiry and ended break gives an adjusted deadline', () => {
    const own = called();
    const breaks = [{ started_at: at('11:02'), planned_minutes: 15, status: 'active' }];
    expect(Boolean(shouldAutoCancelLateAppointment(own, stateFor([own], '11:06', breaks), at('11:06').getTime()))).to.equal(false);
    breaks[0] = { ...breaks[0], status: 'ended', ended_at: at('11:17') };
    expect(estimate(stateFor([own], '11:18', breaks), own).cancelDeadline).to.equal(at('11:22').toISOString());
  });
  it('emergency insertion protects an already called absent patient until the emergency resolves', () => {
    const own = called();
    const emergency = row('9', '11:00', { priority: 'emergency', appointment_time: null });
    expect(Boolean(shouldAutoCancelLateAppointment(own, stateFor([own, emergency], '11:06'), at('11:06').getTime()))).to.equal(false);
    emergency.status = 'completed';
    emergency.queue_status = 'completed';
    emergency.consultation_timing = { startedAt: at('11:06'), endedAt: at('11:20'), durationMinutes: 10 };
    const state = stateFor([own, emergency], '11:21');
    expect(estimate(state, own).cancelDeadline).to.equal(at('11:25').toISOString());
    expect(Boolean(shouldAutoCancelLateAppointment(own, state, at('11:21').getTime()))).to.equal(false);
  });
  it('completed history is excluded and remains unchanged', () => {
    const own = row('1', '10:00', { status: 'completed', queue_status: 'completed', consultation_timing: { startedAt: at('10:00'), endedAt: at('10:10') } });
    const before = structuredClone(own), state = stateFor([own], '12:30');
    expect(state.queue).to.have.length(0);
    expect(Boolean(shouldAutoCancelLateAppointment(own, state, at('12:30').getTime()))).to.equal(false);
    expect(own).to.deep.equal(before);
  });
  it('atomic claim loses safely to concurrent arrival or start', async () => {
    const update = sinon.stub(Appointment, 'findOneAndUpdate').resolves(null);
    expect(await cancelAbsentAppointment(called(), at('11:05'), at('11:06'))).to.equal(false);
    expect(update.firstCall.args[0]).to.include({ checked_in_at: null, consultation_started_at: null, 'consultation_timing.startedAt': null, queue_status: 'called' });
  });
  it('repeated claims cannot send duplicate notifications', async () => {
    const own = { ...called(), patient: 'patient' };
    const notification = sinon.stub(Notification, 'create').resolves({ toObject: () => ({ status: 'canceled' }) });
    sinon.stub(User, 'findById').returns({ select: () => ({ lean: async () => null }) });
    sinon.stub(Appointment, 'findOneAndUpdate').onFirstCall().resolves({ ...own, status: 'canceled', cancellation_reason: 'PATIENT_LATE' }).onSecondCall().resolves(null);
    sinon.stub(slotRepository, 'online').resolves([]);
    sinon.stub(slotRepository, 'walkins').resolves([]);
    const old = global.io;
    const emit = sinon.spy();
    global.io = { to: () => ({ emit }) };
    try {
      expect(await cancelAbsentAppointment(own, at('11:05'), at('11:06'))).to.equal(true);
      const calls = emit.callCount;
      expect(await cancelAbsentAppointment(own, at('11:05'), at('11:07'))).to.equal(false);
      expect(emit.callCount).to.equal(calls);
      expect(notification.calledOnce).to.equal(true);
      expect(notification.firstCall.args[0].data.cancellationReason).to.equal('PATIENT_LATE');
    } finally { global.io = old; }
  });
  it('existing backend worker uses authoritative queue and atomic cancellation', async () => {
    const own = called();
    sinon.stub(Appointment, 'find').returns({ lean: async () => [own] });
    sinon.stub(DoctorBreak, 'find').returns({ lean: async () => [] });
    sinon.stub(slotRepository, 'online').resolves([own]);
    sinon.stub(slotRepository, 'walkins').resolves([]);
    sinon.stub(slotRepository, 'ranges').resolves([]);
    const update = sinon.stub(Appointment, 'findOneAndUpdate').resolves(null);
    expect(await checkAndAutoCancelLateAppointments(at('11:06'))).to.equal(0);
    expect(update.calledOnce).to.equal(true);
  });
  it('configurable grace supports zero and safely falls back for invalid values', () => {
    const previous = process.env.PATIENT_GRACE_PERIOD_MINUTES;
    try {
      process.env.PATIENT_GRACE_PERIOD_MINUTES = '0';
      expect(calculateCancellationDeadline(at('11:00'))).to.equal(at('11:00').toISOString());
      process.env.PATIENT_GRACE_PERIOD_MINUTES = '-2';
      expect(calculateCancellationDeadline(at('11:00'))).to.equal(at('11:05').toISOString());
      expect(calculateCancellationDeadline(null)).to.equal(null);
    } finally {
      if (previous == null) delete process.env.PATIENT_GRACE_PERIOD_MINUTES;
      else process.env.PATIENT_GRACE_PERIOD_MINUTES = previous;
    }
  });
});
