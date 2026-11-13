import { expect } from 'chai';
import sinon from 'sinon';
import Appointment from '../src/models/appointmentModel.js';
import { WalkinAppointment } from '../src/models/clinicModels.js';
import { getNoShowCancellationDeadline, shouldAutoCancelLateAppointment, cancelNoShowAfter24Hours,
  checkAndAutoCancelLateAppointments, noShowCancellationEffects } from '../src/services/lateAppointmentService.js';

const start = new Date('2026-11-12T10:00:00+05:30');
const deadline = new Date('2026-11-13T10:00:00+05:30');
const booking = (changes = {}) => ({ _id: 'booking', counselor: 'doctor', patient: 'patient',
  date: start, appointment_date: '2026-11-12', appointment_time: '10:00:00',
  status: 'pending', queue_status: 'booked', ...changes });

describe('24-hour no-show cancellation', () => {
  afterEach(() => sinon.restore());
  for (const source of ['online', 'walkin', 'emergency']) {
    const record = () => booking(source === 'walkin'
      ? { status: undefined, appointment_status: 'booked', doctor_id: 'doctor', patient_id: 'patient' }
      : source === 'emergency' ? { priority: 'emergency', appointment_time: null, createdAt: start } : {});
    it(`${source}: retains the appointment before 24 hours and expires at the boundary`, () => {
      expect(getNoShowCancellationDeadline(record()).getTime()).to.equal(deadline.getTime());
      expect(shouldAutoCancelLateAppointment(record(), null, deadline.getTime() - 1)).to.equal(false);
      expect(shouldAutoCancelLateAppointment(record(), null, deadline.getTime())).to.equal(true);
    });
    it(`${source}: persists cancellation, releases the slot and sends effects only once`, async () => {
      const Model = source === 'walkin' ? WalkinAppointment : Appointment;
      const update = sinon.stub(Model, 'findOneAndUpdate').resolves({ ...record(), cancellation_reason: 'NO_SHOW_24_HOURS' });
      const effects = sinon.stub(noShowCancellationEffects, 'finish').resolves();
      expect(await cancelNoShowAfter24Hours(record(), source, deadline)).to.equal(true);
      const [filter, change] = update.firstCall.args;
      expect(filter).to.include({ checked_in_at: null, consultation_started_at: null, 'consultation_timing.startedAt': null });
      expect(change.$set).to.include({ [source === 'walkin' ? 'appointment_status' : 'status']: source === 'walkin' ? 'cancelled' : 'canceled',
        queue_status: 'canceled', cancellation_reason: 'NO_SHOW_24_HOURS' });
      expect(change.$unset).to.deep.equal({ slot_key: 1 });
      update.resolves(null);
      expect(await cancelNoShowAfter24Hours(record(), source, deadline)).to.equal(false);
      expect(effects.calledOnce).to.equal(true);
    });
  }
  for (const changes of [
    { checked_in_at: start }, { consultation_started_at: start }, { consultation_ended_at: start },
    { consultation_timing: JSON.stringify({ started_at: start.toISOString() }) },
    { consultation_timing: { availability: { status: 'available' } } },
    { consultation_timing: { availability: { returnedAt: start } } },
    { status: 'completed' }, { status: 'canceled' }, { status: 'rejected' },
    { status: 'awaiting_payment' }, { queue_status: 'in_progress' },
    { queueStatus: 'completed' }, { consultation_timing: { state: 'completed' } },
    { consultation_timing: JSON.stringify({ ended_at: start.toISOString() }) },
  ]) it(`protects arrived/started/closed records ${JSON.stringify(changes)}`, () => {
    expect(shouldAutoCancelLateAppointment(booking(changes), null, deadline.getTime() + 1000)).to.equal(false);
  });
  it('does not shorten future bookings or extend the deadline with queue delays', () => {
    expect(shouldAutoCancelLateAppointment(booking(), null, start.getTime() - 1)).to.equal(false);
    expect(getNoShowCancellationDeadline(booking({ estimated_start_at: deadline })).getTime()).to.equal(deadline.getTime());
    expect(shouldAutoCancelLateAppointment(booking({ queue_status: 'skipped' }), null, deadline.getTime())).to.equal(true);
    expect(getNoShowCancellationDeadline({})).to.equal(null);
  });
  it('332-hour absent bookings are eligible across all three appointment types', () => {
    const now = start.getTime() + 332 * 3600000;
    for (const changes of [{}, { status: undefined, appointment_status: 'booked' },
      { priority: 'emergency', appointment_time: null, createdAt: start }]) {
      expect(shouldAutoCancelLateAppointment(booking(changes), null, now)).to.equal(true);
    }
  });
  it('the existing minute worker processes both online/emergency and walk-in sources', async () => {
    sinon.stub(Appointment, 'find').returns({ lean: async () => [booking()] });
    sinon.stub(WalkinAppointment, 'find').returns({ lean: async () => [booking({ appointment_status: 'booked' })] });
    sinon.stub(Appointment, 'findOneAndUpdate').resolves(booking());
    sinon.stub(WalkinAppointment, 'findOneAndUpdate').resolves(booking());
    const effects = sinon.stub(noShowCancellationEffects, 'finish').resolves();
    expect(await checkAndAutoCancelLateAppointments(deadline)).to.equal(2);
    expect(effects.callCount).to.equal(2);
  });
  it('repairs old mobile-completed records instead of canceling finished checkups', async () => {
    const row = booking({ consultation_timing: JSON.stringify({ ended_at: start.toISOString() }) });
    sinon.stub(Appointment, 'find').returns({ lean: async () => [row] });
    sinon.stub(WalkinAppointment, 'find').returns({ lean: async () => [] });
    const update = sinon.stub(Appointment, 'findOneAndUpdate').resolves({ ...row, status: 'completed', queue_status: 'completed' });
    const effects = sinon.stub(noShowCancellationEffects, 'finish').resolves();
    expect(await checkAndAutoCancelLateAppointments(deadline)).to.equal(0);
    expect(update.firstCall.args[1].$set).to.deep.equal({ status: 'completed', queue_status: 'completed' });
    expect(effects.called).to.equal(false);
  });
});
