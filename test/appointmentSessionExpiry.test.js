import { expect } from 'chai';
import sinon from 'sinon';
import Appointment from '../src/models/appointmentModel.js';
import { slotRepository } from '../src/services/appointmentSlotService.js';
import { getAppointmentSessionEnd } from '../src/services/consultationTimingService.js';
import { markExpiredAppointmentsNoShow } from '../src/controllers/appointmentController.js';

const at = (time) => new Date(`2026-10-08T${time}+05:30`);
const range = { clinic_id: 'clinic', availability_date: '2026-10-08', start_time: '14:00', end_time: '17:00', slot_duration: 15 };
const booking = { _id: 'booking', counselor: 'doctor', clinic_id: 'clinic', date: at('14:15:00'), appointment_date: '2026-10-08', appointment_time: '14:15:00', status: 'pending', queue_status: 'booked' };
describe('Slot end never removes appointments', () => {
  afterEach(() => sinon.restore());
  it('does not select uncalled bookings for expiration, even after session end', async () => {
    const find = sinon.stub(Appointment, 'find').returns({ lean: async () => [] });
    const remove = sinon.stub(Appointment, 'deleteOne');
    expect(await markExpiredAppointmentsNoShow(at('18:00:00'))).to.equal(0);
    expect(find.firstCall.args[0]).to.include({ queue_status: 'called', checked_in_at: null });
    expect(remove.called).to.equal(false);
  });
  it('retains matching session metadata only for booking/display', async () => {
    const end = await getAppointmentSessionEnd(booking, [
      { ...range, clinic_id: 'other', end_time: '20:00' },
      { ...range, start_time: '18:00', end_time: '20:00' }, range,
    ]);
    expect(end.getTime()).to.equal(at('17:00:00').getTime());
  });
});
