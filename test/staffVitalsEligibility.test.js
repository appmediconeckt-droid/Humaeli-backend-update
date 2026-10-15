import { expect } from 'chai';
import sinon from 'sinon';
import User from '../src/models/userModel.js';
import Clinic from '../src/models/clinicModel.js';
import Appointment from '../src/models/appointmentModel.js';
import WalkinAppointment from '../src/models/walkinAppointmentModel.js';
import { staffAppointments } from '../src/controllers/staffAppointmentsController.js';

describe('Daily vitals appointment list and patient phones', () => {
  let sandbox;
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.useFakeTimers({ now: new Date('2026-10-14T20:00:00Z'), toFake: ['Date'] }); // Oct 15 in India
    sandbox.stub(User, 'findById').returns({ select: async () => ({ role: 'receptionist', assignedDoctor: 'doctor', clinic_id: 'clinic', isActive: true }) });
    sandbox.stub(User, 'findOne').returns({ select: async () => ({ fullName: 'Doctor' }) });
    sandbox.stub(Clinic, 'find').resolves([{ _id: 'clinic' }]);
  });
  afterEach(() => sandbox.restore());
  it('filters before pagination to today active visits and preserves phones for online and walk-in patients', async () => {
    const common = { counselor: 'doctor', clinic_id: 'clinic', appointment_date: '2026-10-15', appointment_time: '10:00', status: 'confirmed' };
    const online = [
      { ...common, _id: 'today', patient: { fullName: 'Today', phone: '9876543210' } },
      { ...common, _id: 'completed', status: 'completed' },
      { ...common, _id: 'ended', consultation_ended_at: '2026-10-15T04:00:00Z' },
      { ...common, _id: 'past', appointment_date: '2026-10-14' },
      { ...common, _id: 'future', appointment_date: '2026-10-16' },
      { ...common, _id: 'cancelled', status: 'canceled' },
    ];
    const find = sandbox.stub(Appointment, 'find').returns({ populate() { return this; }, lean: async () => online });
    sandbox.stub(WalkinAppointment, 'find').returns({ lean: async () => [{ ...common, id: 'walkin', doctor_id: 'doctor', patient_name: 'Walk-in', phoneNumber: '9123456780' }] });
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy(), set() {} };
    await staffAppointments({ userId: 'staff', query: { vitals_only: 'true', limit: '10' } }, res);
    const response = res.json.firstCall.args[0];
    expect(find.firstCall.args[0]).to.include({ appointment_date: '2026-10-15', clinic_id: 'clinic', counselor: 'doctor' });
    expect(response.total).to.equal(2);
    expect(response.appointments.map(row => row.id)).to.have.members(['today', 'walkin']);
    expect(response.appointments.map(row => row.phoneNumber)).to.have.members(['9876543210', '9123456780']);
  });
});
