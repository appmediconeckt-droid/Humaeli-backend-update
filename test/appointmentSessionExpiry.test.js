import { expect } from 'chai';
import sinon from 'sinon';
import Appointment from '../src/models/appointmentModel.js';
import { slotRepository } from '../src/services/appointmentSlotService.js';
import { getAppointmentSessionEnd } from '../src/services/consultationTimingService.js';
import { markExpiredAppointmentsNoShow } from '../src/controllers/appointmentController.js';

const at = (time) => new Date(`2026-10-08T${time}+05:30`);
const range = { clinic_id: 'clinic', availability_date: '2026-10-08', start_time: '14:00', end_time: '17:00', slot_duration: 15 };
const booking = { _id: 'booking', counselor: 'doctor', clinic_id: 'clinic', date: at('14:15:00'), appointment_date: '2026-10-08', appointment_time: '14:15:00', status: 'pending', queue_status: 'booked' };
describe('Doctor session expiry for absent online patients', () => {
  beforeEach(() => {
    sinon.stub(Appointment, 'find').returns({ lean: async () => [booking] });
    sinon.stub(slotRepository, 'ranges').resolves([range]);
    sinon.stub(Appointment, 'deleteOne').resolves({ deletedCount: 1 });
    sinon.stub(Appointment, 'updateOne').resolves({ modifiedCount: 1 });
  });
  afterEach(() => sinon.restore());
  it('keeps the 14:15 patient after their fifteen-minute duration and until 17:00', async () => {
    for (const time of ['14:30:00', '16:00:00', '16:59:59']) expect(await markExpiredAppointmentsNoShow(at(time))).to.equal(0);
    expect(Appointment.deleteOne.called).to.equal(false);
    expect(await markExpiredAppointmentsNoShow(at('17:00:00'))).to.equal(1);
    expect(Appointment.deleteOne.firstCall.args[0]).to.include({ _id: 'booking', checked_in_at: null, consultation_started_at: null, 'consultation_timing.startedAt': null });
  });
  for (const changes of [
    { checked_in_at: at('16:50:00') }, { queue_status: 'waiting' }, { queue_status: 'called' },
    { consultation_started_at: at('16:50:00') }, { consultation_timing: { startedAt: at('16:50:00').toISOString() } },
    { status: 'completed' }, { status: 'canceled' }, { queue_status: 'skipped' },
    { priority: 'emergency', appointment_time: null },
  ]) it(`preserves an arrived/started/history appointment ${JSON.stringify(changes)}`, async () => {
    Appointment.find.returns({ lean: async () => [{ ...booking, ...changes }] });
    expect(await markExpiredAppointmentsNoShow(at('18:00:00'))).to.equal(0);
    expect(Appointment.deleteOne.called).to.equal(false);
  });
  it('uses the matching clinic and session rather than a later range or another clinic', async () => {
    const end = await getAppointmentSessionEnd(booking, [
      { ...range, clinic_id: 'other', end_time: '20:00' },
      { ...range, start_time: '18:00', end_time: '20:00' }, range,
    ]);
    expect(end.getTime()).to.equal(at('17:00:00').getTime());
  });
  it('specific-date hours override recurrent hours for expiry', async () => {
    const end = await getAppointmentSessionEnd(booking, [
      { ...range, availability_date: null, weekday: 4, end_time: '20:00' }, range,
    ]);
    expect(end.getTime()).to.equal(at('17:00:00').getTime());
  });
  it('never deletes a booking without matching availability', async () => {
    slotRepository.ranges.resolves([]);
    expect(await markExpiredAppointmentsNoShow(at('18:00:00'))).to.equal(0);
    expect(Appointment.deleteOne.called).to.equal(false);
  });
  it('restores a legacy early no-show flag while the session remains open', async () => {
    Appointment.find.returns({ lean: async () => [{ ...booking, queue_status: 'no_show' }] });
    expect(await markExpiredAppointmentsNoShow(at('14:31:00'))).to.equal(0);
    expect(Appointment.updateOne.firstCall.args[1]).to.deep.equal({ $set: { queue_status: 'booked' } });
    expect(Appointment.deleteOne.called).to.equal(false);
  });
});
