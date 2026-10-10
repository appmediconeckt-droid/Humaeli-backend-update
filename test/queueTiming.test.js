import { expect } from 'chai';
import { formatTokenStatus } from '../src/controllers/tokenStatusController.js';
import { calculateEstimatedQueue, normalizeQueueAppointment, queueRecordKey } from '../src/services/queueTimingService.js';

const at = (time) => new Date(`2026-10-08T${time}:00+05:30`).toISOString();
const ms = (time) => Date.parse(at(time));
const patient = (id, time, changes = {}) => ({ id, source: 'online', doctorId: 'doctor', clinicId: 'clinic', date: '2026-10-08', time: `${time}:00`, token: Number(id), status: 'pending', queueStatus: 'waiting', timing: { durationMinutes: 10 }, ...changes });
const running = (scheduled = '12:00', start = '12:00') => patient('7', scheduled, { status: 'in-progress', queueStatus: 'in_progress', timing: { startedAt: at(start), durationMinutes: 10 } });
const result = (own, queue, now, breaks = []) => formatTokenStatus(own, queue, {}, [], breaks, ms(now));

describe('Required appointment queue timing scenarios', () => {
  it('1: scheduled 12:00, actual start 12:00 is on time', () => {
    const own = running();
    expect(result(own, [own], '12:03').appointment).to.include({ scheduledStartAt: at('12:00'), actualStartAt: at('12:00'), timingDifferenceMinutes: 0, timingLabel: 'Started on time' });
  });
  it('2: actual start 12:08 freezes eight minutes late at every refresh', () => {
    const own = running('12:00', '12:08');
    for (const now of ['12:09', '12:15', '12:25']) {
      expect(result(own, [own], now).appointment).to.include({ timingDifferenceMinutes: 8, timingLabel: 'Started 8 min late', estimatedStartAt: at('12:08') });
    }
  });
  it('3: actual 15-minute completion cascades five minutes to all subsequent slots', () => {
    const done = { ...running(), status: 'completed', timing: { startedAt: at('12:00'), endedAt: at('12:15'), durationMinutes: 10 } };
    const queue = [done, patient('8', '12:10'), patient('9', '12:20'), patient('10', '12:30')];
    for (const [index, expected] of [[1, '12:15'], [2, '12:25'], [3, '12:35']]) {
      expect(result(queue[index], queue, '12:15').appointment).to.include({ estimatedStartAt: at(expected), timingDifferenceMinutes: 5 });
    }
  });
  it('4: early completion does not pull an online 12:10 slot to 12:07', () => {
    const done = { ...running(), status: 'completed', timing: { startedAt: at('12:00'), endedAt: at('12:07'), durationMinutes: 10 } };
    const own = patient('8', '12:10');
    expect(result(own, [done, own], '12:07').appointment).to.include({ estimatedStartAt: at('12:10'), timingDifferenceMinutes: 0 });
  });
  it('5: waiting is ten minutes while scheduled lateness is fifteen minutes', () => {
    const current = running('11:50', '12:05');
    const own = patient('8', '12:00');
    const value = result(own, [current, own], '12:05');
    expect(value.queue.estimatedWaitMinutes).to.equal(10);
    expect(value.appointment.timingDifferenceMinutes).to.equal(15);
  });
  it('6: an overrun keeps the serving token and never promises zero wait', () => {
    const current = running(), own = patient('8', '12:10');
    const value = result(own, [current, own], '12:13');
    expect(value.current.currentToken).to.equal(7);
    expect(value.queue).to.include({ estimatedWaitMinutes: 1, estimateUncertain: true });
    expect(value.queue.estimatedTurnTime).to.equal(at('12:14'));
  });
  it('7: break 12:05–12:12 delays the 12:10 patient only two minutes and cascades', () => {
    const own = patient('8', '12:10'), next = patient('9', '12:20');
    const breaks = [{ started_at: at('12:05'), ended_at: at('12:12'), status: 'ended' }];
    expect(result(own, [own, next], '12:05', breaks).appointment).to.include({ estimatedStartAt: at('12:12'), timingDifferenceMinutes: 2 });
    expect(result(next, [own, next], '12:05', breaks).appointment).to.include({ estimatedStartAt: at('12:22'), timingDifferenceMinutes: 2 });
  });
  it('8: first actual start fifteen minutes late propagates fifteen minutes', () => {
    const current = running('12:00', '12:15'), second = patient('8', '12:10'), third = patient('9', '12:20');
    const queue = [current, second, third];
    expect(result(current, queue, '12:15').appointment.timingDifferenceMinutes).to.equal(15);
    expect(result(second, queue, '12:15').appointment).to.include({ estimatedStartAt: at('12:25'), timingDifferenceMinutes: 15 });
    expect(result(third, queue, '12:15').appointment).to.include({ estimatedStartAt: at('12:35'), timingDifferenceMinutes: 15 });
  });
  it('9: own token matches now serving and own start delay remains frozen', () => {
    const own = running('12:00', '12:08'), value = result(own, [own, patient('8', '12:10')], '12:20');
    expect(value.token.myToken).to.equal(value.current.currentToken);
    expect(value.current.isYourTurn).to.equal(true);
    expect(value.queue).to.include({ patientsAhead: 0, queuePosition: 1, estimatedWaitMinutes: 0, timingLabel: 'Started 8 min late' });
  });
  it('10: completed records keep actual start, end and historical delay', () => {
    const own = { ...running('12:00', '12:08'), status: 'completed', timing: { startedAt: at('12:08'), endedAt: at('12:25'), durationMinutes: 10 } };
    const value = result(own, [own], '13:00');
    expect(value.appointment).to.include({ actualStartAt: at('12:08'), actualEndAt: at('12:25'), timingDifferenceMinutes: 8, timingLabel: 'Started 8 min late' });
    expect(value.queue).to.include({ totalWaiting: 0, patientsAhead: null, estimatedWaitMinutes: null });
  });
});

describe('Queue timing safety and isolation', () => {
  it('does not apply a future break before its start', () => {
    const own = patient('8', '12:10');
    expect(result(own, [own], '12:00', [{ started_at: at('12:40'), ended_at: at('12:47') }]).appointment.estimatedStartAt).to.equal(at('12:10'));
  });
  it('ignores cancelled breaks and appointments', () => {
    const own = patient('8', '12:10'), cancelled = patient('7', '12:00', { status: 'canceled' });
    const value = result(own, [own, cancelled], '12:00', [{ started_at: at('12:05'), ended_at: at('12:30'), status: 'cancelled' }]);
    expect(value.queue.patientsAhead).to.equal(0);
    expect(value.appointment.estimatedStartAt).to.equal(at('12:10'));
  });
  it('does not mix doctors, clinics or dates', () => {
    const own = patient('8', '12:10');
    const others = [patient('1', '12:00', { clinicId: 'other' }), patient('2', '12:00', { doctorId: 'other' }), patient('3', '12:00', { date: '2026-10-09' })];
    expect(result(own, [own, ...others], '12:00').queue).to.include({ patientsAhead: 0, totalWaiting: 1 });
  });
  it('uses clinic-specific consultation duration and preserves token order', () => {
    const own = patient('8', '12:10', { timing: {} }), next = patient('9', '12:20', { timing: {} });
    const state = calculateEstimatedQueue([next, own], { doctorId: 'doctor', date: own.date, clinicId: 'clinic', now: ms('12:00'), ranges: [
      { clinic_id: 'other', availability_date: own.date, start_time: '12:00', end_time: '13:00', slot_duration: 30 },
      { clinic_id: 'clinic', availability_date: own.date, start_time: '12:00', end_time: '13:00', slot_duration: 10 },
    ] });
    expect(state.estimates.get(queueRecordKey(own)).expectedDurationMinutes).to.equal(10);
    expect(state.queue.map((item) => item.token)).to.deep.equal([8, 9]);
  });
  it('walk-ins retain assigned slots and participate in the same cascade', () => {
    const current = running('12:00', '12:05'), own = patient('8', '12:10', { source: 'walkin' });
    expect(result(own, [current, own], '12:05').appointment.estimatedStartAt).to.equal(at('12:15'));
  });
  it('completed emergency overlap adds only two minutes, with no double counting', () => {
    const emergency = { ...running('12:05', '12:05'), emergency: true, time: '', status: 'completed', timing: { startedAt: at('12:05'), endedAt: at('12:12'), durationMinutes: 7 } };
    const own = patient('8', '12:10');
    expect(result(own, [emergency, own], '12:12').appointment).to.include({ estimatedStartAt: at('12:12'), timingDifferenceMinutes: 2 });
  });
  it('overlapping break and manual pause count only once', () => {
    const current = running();
    current.timing.pauses = [{ startedAt: at('12:02'), endedAt: at('12:06') }];
    const own = patient('8', '12:10');
    const value = result(own, [current, own], '12:08', [{ started_at: at('12:03'), ended_at: at('12:05') }]);
    expect(value.current.elapsedSeconds).to.equal(240);
    expect(value.appointment.estimatedStartAt).to.equal(at('12:14'));
  });
  it('reuses legacy timestamps and parses JSON timing without changing the record', () => {
    const raw = { id: 'one', counselor: 'doctor', clinic_id: 'clinic', appointment_date: '2026-10-08', appointment_time: '12:00 PM', status: 'completed', consultation_timing: '{"durationMinutes":10}', consultation_started_at: at('12:08'), consultation_ended_at: at('12:25') };
    const before = structuredClone(raw), own = normalizeQueueAppointment(raw, 'online');
    expect(result(own, [own], '13:00').appointment.timingDifferenceMinutes).to.equal(8);
    expect(raw).to.deep.equal(before);
  });
});
