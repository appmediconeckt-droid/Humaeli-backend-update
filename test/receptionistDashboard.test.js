import { expect } from 'chai';
import sinon from 'sinon';
import User from '../src/models/userModel.js';
import Clinic from '../src/models/clinicModel.js';
import Appointment from '../src/models/appointmentModel.js';
import WalkinAppointment from '../src/models/walkinAppointmentModel.js';
import { displayTimingRepository } from '../src/services/displayTimingService.js';
import { receptionistDashboard } from '../src/controllers/receptionistController.js';

describe('Receptionist dashboard', () => {
  let sandbox, res;
  const doctorId = '111111111111111111111111';
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    for (const method of ['online', 'walkins', 'ranges', 'breaks']) sandbox.stub(displayTimingRepository, method).resolves([]);
    res = { status: sinon.stub().returnsThis(), json: sinon.spy(), set: sinon.spy() };
    sandbox.stub(User, 'findById').returns({ select: async () => ({ role: 'receptionist', assignedDoctor: doctorId, clinic_id: 'clinic', isActive: true }) });
  });
  afterEach(() => sandbox.restore());
  it('rejects requests for another doctor before reading appointments', async () => {
    const find = sandbox.stub(Appointment, 'find');
    await receptionistDashboard({ userId: 'staff', query: { doctor_id: 'other' } }, res);
    expect(res.status.calledWith(403)).to.equal(true);
    expect(find.called).to.equal(false);
  });
  const prepare = () => {
    sandbox.stub(User, 'findOne').returns({ select: async () => ({ fullName: 'Dr Example', specialization: 'General medicine' }) });
    sandbox.stub(Clinic, 'find').resolves([{ id: 'clinic', clinic_name: 'Clinic' }]);
  };
  it('rejects a clinic belonging to another doctor', async () => {
    prepare();
    await receptionistDashboard({ userId: 'staff', query: { date: '2026-10-12', clinic_id: 'other' } }, res);
    expect(res.status.calledWith(403)).to.equal(true);
  });
  it('combines online and walk-in records and follows checkup completion', async () => {
    prepare();
    const online = { _id: 'online', counselor: doctorId, appointment_date: '2026-10-12', appointment_time: '10:00', token_number: 1, status: 'confirmed', queue_status: 'in_progress', patient: { fullName: 'Online patient', phoneNumber: '1234567890' }, consultation_started_at: '2026-10-12T04:30:00Z' };
    const chain = { populate: sinon.stub().returnsThis(), sort: sinon.stub().returnsThis(), lean: async () => [online] };
    const find = sandbox.stub(Appointment, 'find').returns(chain);
    sandbox.stub(WalkinAppointment, 'find').returns({ lean: async () => [{ id: 'walkin', doctor_id: doctorId, patient_name: 'Walk-in patient', appointment_date: '2026-10-12', appointment_time: '10:15', token_number: 2, status: 'pending', queue_status: 'waiting' }] });
    const req = { userId: 'staff', query: { date: '2026-10-12' } };
    await receptionistDashboard(req, res);
    let data = res.json.lastCall.args[0];
    expect(find.firstCall.args[0].counselor).to.equal(doctorId);
    expect(find.firstCall.args[0].clinic_id).to.equal('clinic');
    expect(Clinic.find.firstCall.args[0]).to.deep.equal({ doctor_id: doctorId, _id: 'clinic' });
    expect(data.appointments).to.have.length(2);
    expect(data.currentPatients[0].patientName).to.equal('Online patient');
    expect(data.waiting[0].source).to.equal('walkin');
    expect(data.summary).to.deep.equal({ total: 2, waiting: 1, ongoing: 1, completed: 0 });
    online.queue_status = 'completed'; online.status = 'completed';
    await receptionistDashboard(req, res);
    data = res.json.lastCall.args[0];
    expect(data.currentPatients).to.have.length(0);
    expect(data.summary.completed).to.equal(1);
  });
  it('rejects invalid dates', async () => {
    await receptionistDashboard({ userId: 'staff', query: { date: '2026-02-30' } }, res);
    expect(res.status.calledWith(400)).to.equal(true);
  });
});
