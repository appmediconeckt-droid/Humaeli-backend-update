import { expect } from 'chai';
import sinon from 'sinon';
import { buildDisplayTiming, getDisplayTiming, displayTimingRepository } from '../src/services/displayTimingService.js';

const date = '2026-10-09';
const at = time => new Date(`${date}T${time}:00+05:30`);
const item = (id, time, extra = {}) => ({ id, doctorId: 'doctor', clinicId: 'clinic', date,
  source: 'online', time: `${time}:00`, token: Number(id), status: 'confirmed', queueStatus: 'waiting', timing: {}, ...extra });
const options = extra => ({ doctorId: 'doctor', clinicId: 'clinic', date, now: at('10:05').getTime(), ...extra });

describe('Doctor display break and delay data', () => {
  afterEach(() => sinon.restore());

  it('returns actual break times, reason and a live remaining-minute countdown', () => {
    const breaks = [{ started_at: at('10:00'), planned_minutes: 15, reason: 'Tea break', status: 'active' }];
    const data = buildDisplayTiming(options({ breaks, records: [item('2', '10:10')] }));
    expect(data.doctorStatus).to.equal('break');
    expect(data.breakInfo).to.include({ headline: 'Doctor is on break', expectedStart: '10:15 AM',
      breakTime: '10:00 AM – 10:15 AM', resumeMinutes: 10, reason: 'Tea break' });
    expect(data.estimatedWaitMinutes).to.equal(10);
    expect(buildDisplayTiming(options({ breaks, now: at('10:09').getTime() })).breakInfo.resumeMinutes).to.equal(6);
  });

  it('stops showing an active break after its planned end without writing to the database', () => {
    const data = buildDisplayTiming(options({ breaks: [{ started_at: at('09:30'), planned_minutes: 15, status: 'active' }] }));
    expect(data.doctorStatus).to.equal('waiting');
    expect(data.breakInfo.breakTime).to.equal('No active break');
    expect(data.breakInfo.resumeMinutes).to.equal(null);
  });

  it('uses consultation timing for the next patient and keeps clinic boundaries', () => {
    const data = buildDisplayTiming(options({ records: [
      item('1', '10:00', { status: 'in-progress', queueStatus: 'in_progress', timing: { startedAt: at('10:00'), durationMinutes: 15 } }),
      item('2', '10:10'), item('3', '10:06', { clinicId: 'other-clinic' }),
    ] }));
    expect(data.doctorStatus).to.equal('consulting');
    expect(data.breakInfo.expectedStart).to.equal('10:15 AM');
    expect(data.breakInfo.headline).to.equal('5 min late');
    expect(data.estimatedWaitMinutes).to.equal(10);
  });

  it('reports a manual consultation pause without inventing a resume time', () => {
    const data = buildDisplayTiming(options({ records: [item('1', '10:00', {
      status: 'in-progress', queueStatus: 'in_progress', timing: { state: 'paused', startedAt: at('10:00'),
        pauses: [{ startedAt: at('10:04'), endedAt: null }] },
    }), item('2', '10:10')] }));
    expect(data.doctorStatus).to.equal('paused');
    expect(data.breakInfo.reason).to.equal('Consultation paused by doctor');
    expect(data.breakInfo.resumeMinutes).to.equal(null);
    expect(data.estimatedWaitLabel).to.equal('Paused');
  });

  it('calculates ten minutes wait for the displayed next token even when it has been called', () => {
    const data = buildDisplayTiming(options({ nextAppointmentId: '2', nextToken: 2, records: [
      item('1', '10:00', { status: 'in-progress', queueStatus: 'in_progress', timing: { startedAt: at('10:00'), durationMinutes: 15 } }),
      item('2', '10:10', { queueStatus: 'called' }),
    ] }));
    expect(data.estimatedWaitMinutes).to.equal(10);
    expect(data.estimatedWaitLabel).to.equal(null);
    expect(data.breakInfo.expectedStart).to.equal('10:15 AM');
  });

  it('matches a displayed token when a queue entry does not contain an appointment ID', () => {
    const data = buildDisplayTiming(options({ nextToken: 3, records: [
      item('2', '10:10'), item('3', '10:20'),
    ] }));
    expect(data.estimatedWaitMinutes).to.equal(20);
  });

  it('explains missing estimates instead of returning an unexplained blank or false zero', () => {
    const late = buildDisplayTiming(options({ records: [item('1', '09:00')] }));
    expect(late.estimatedWaitMinutes).to.equal(null);
    expect(late.estimatedWaitLabel).to.equal('Awaiting doctor');
    const empty = buildDisplayTiming(options({ records: [] }));
    expect(empty.estimatedWaitLabel).to.equal('No waiting patients');
    const overrun = buildDisplayTiming(options({ records: [
      item('1', '09:00', { status: 'in-progress', queueStatus: 'in_progress', timing: { startedAt: at('09:00'), durationMinutes: 15 } }),
      item('2', '09:15'),
    ] }));
    expect(overrun.estimatedWaitLabel).to.equal('Updating estimate');
  });

  it("shows the recalculated wait including the serving doctor break", () => {
    const data = buildDisplayTiming(options({ records: [
      item('1', '10:00', { status: 'in-progress', queueStatus: 'in_progress', timing: { startedAt: at('10:00'), durationMinutes: 15 } }),
      item('2', '10:10'),
    ], breaks: [{ started_at: at('10:04'), planned_minutes: 11, status: 'active' }] }));
    expect(data.estimatedWaitMinutes).to.equal(21);
    expect(data.estimatedWaitLabel).to.equal(null);
  });

  for (const queueStatus of ['waiting', 'called']) {
    it(`shows 58 minutes late at 14:08 for an unstarted 13:10 appointment (${queueStatus})`, () => {
      const records = [item('1', '13:10', { queueStatus })];
      const data = buildDisplayTiming(options({ records, now: at('14:08').getTime() }));
      expect(data.doctorStatus).to.equal('delayed');
      expect(data.breakInfo).to.include({ headline: '58 min late', delayMinutes: 58,
        scheduledStart: '01:10 PM', waitingForDoctor: true, reason: 'Consultation has not started' });
      expect(buildDisplayTiming(options({ records, now: at('14:09').getTime() })).breakInfo.delayMinutes).to.equal(59);
    });
  }

  it('does not show lateness before the booked time and freezes actual start lateness after consultation begins', () => {
    expect(buildDisplayTiming(options({ records: [item('1', '13:10')], now: at('13:09').getTime() })).breakInfo.delayMinutes).to.equal(0);
    const records = [item('1', '13:10', { status: 'in-progress', queueStatus: 'in_progress',
      timing: { startedAt: at('14:08'), durationMinutes: 15 } })];
    expect(buildDisplayTiming(options({ records, now: at('14:10').getTime() })).breakInfo.delayMinutes).to.equal(58);
    expect(buildDisplayTiming(options({ records, now: at('14:11').getTime() })).breakInfo.delayMinutes).to.equal(58);
  });

  it('does not expose patient records or emergency reasons on the public display', () => {
    const data = buildDisplayTiming(options({ records: [item('2', '10:10', { patientId: 'PRIVATE_PATIENT', emergency_reason: 'PRIVATE_REASON' })] }));
    expect(JSON.stringify(data)).not.to.include('PRIVATE_PATIENT').and.not.to.include('PRIVATE_REASON');
  });

  it('loads the selected doctor/day and adapts facility schedule fields', async () => {
    sinon.stub(displayTimingRepository, 'online').resolves([]);
    sinon.stub(displayTimingRepository, 'walkins').resolves([]);
    sinon.stub(displayTimingRepository, 'ranges').resolves([]);
    sinon.stub(displayTimingRepository, 'breaks').resolves([]);
    const data = await getDisplayTiming({ doctorId: 'doctor', date, clinicId: 'clinic',
      timings: [{ day: 5, startTime: '10:00', endTime: '12:00', slotDuration: 15 }] });
    expect(data.timingAvailable).to.equal(true);
    expect(displayTimingRepository.breaks.firstCall.args).to.deep.equal(['doctor', date]);
    expect(displayTimingRepository.ranges.called).to.equal(false);
  });

  it('reports unavailable timing when a lookup fails so the queue can still render', async () => {
    sinon.stub(displayTimingRepository, 'online').resolves([]);
    sinon.stub(displayTimingRepository, 'walkins').resolves([]);
    sinon.stub(displayTimingRepository, 'ranges').resolves([]);
    sinon.stub(displayTimingRepository, 'breaks').rejects(new Error('Break table unavailable'));
    sinon.stub(console, 'error');
    const data = await getDisplayTiming({ doctorId: 'doctor', date });
    expect(data.timingAvailable).to.equal(false);
    expect(data.breakInfo.headline).to.equal('Timing temporarily unavailable');
  });
});
