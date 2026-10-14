import { expect } from 'chai';
import sinon from 'sinon';
import Appointment from '../src/models/appointmentModel.js';
import { WalkinAppointment } from '../src/models/clinicModels.js';
import User from '../src/models/userModel.js';
import { cancelAppointmentManually, manualCancellationEffects } from '../src/controllers/manualAppointmentCancellationController.js';

const response = () => ({ statusCode: 200, status(value) { this.statusCode = value; return this; }, json(body) { this.body = body; return this; } });
const req = (role = 'user', source = 'online') => ({ user: { _id: role === 'user' ? 'patient-a' : 'receptionist-a', role }, params: { id: 'booking-a' }, body: { source } });
describe('Patient and assigned receptionist manual cancellation', () => {
  beforeEach(() => {
    sinon.stub(User, 'findById').returns({ select: async () => ({ role: 'receptionist', isActive: true, assignedDoctor: 'doctor-a', clinic_id: 'clinic-a' }) });
    sinon.stub(Appointment, 'findOne').resolves({ _id: 'booking-a', status: 'confirmed' });
    sinon.stub(Appointment, 'findOneAndUpdate').resolves({ _id: 'booking-a', status: 'canceled' });
    sinon.stub(WalkinAppointment, 'findOne').resolves({ _id: 'booking-a', appointment_status: 'booked' });
    sinon.stub(WalkinAppointment, 'findOneAndUpdate').resolves({ _id: 'booking-a', appointment_status: 'cancelled' });
    sinon.stub(manualCancellationEffects, 'online').resolves();
    sinon.stub(manualCancellationEffects, 'walkin').resolves();
  });
  afterEach(() => sinon.restore());
  it('allows the patient to cancel their own appointment without a time cutoff and releases its slot', async () => {
    const res = response(); await cancelAppointmentManually(req(), res);
    expect(res.statusCode).to.equal(200);
    expect(Appointment.findOne.firstCall.args[0]).to.deep.equal({ _id: 'booking-a', patient: 'patient-a' });
    const [filter, update] = Appointment.findOneAndUpdate.firstCall.args;
    expect(filter.patient).to.equal('patient-a');
    expect(filter.consultation_started_at).to.equal(null);
    expect(update.$set).to.include({ status: 'canceled', queue_status: 'canceled', cancellation_reason: 'PATIENT_REQUEST' });
    expect(update.$unset).to.deep.equal({ slot_key: 1 });
    expect(manualCancellationEffects.online.calledOnce).to.equal(true);
  });
  for (const source of ['online', 'walkin']) {
    it(`restricts receptionist cancellation to their assigned doctor and clinic (${source})`, async () => {
      const res = response(); await cancelAppointmentManually(req('receptionist', source), res);
      const Model = source === 'online' ? Appointment : WalkinAppointment;
      expect(res.statusCode).to.equal(200);
      expect(Model.findOne.firstCall.args[0]).to.deep.equal({ _id: 'booking-a', [source === 'online' ? 'counselor' : 'doctor_id']: 'doctor-a', clinic_id: 'clinic-a' });
      expect(manualCancellationEffects[source].calledOnce).to.equal(true);
    });
  }
  it('rejects another patient appointment without updating it', async () => {
    Appointment.findOne.resolves(null);
    const res = response(); await cancelAppointmentManually(req(), res);
    expect(res.statusCode).to.equal(404);
    expect(Appointment.findOneAndUpdate.called).to.equal(false);
  });
  it('rejects a receptionist with no clinic assignment before looking up an appointment', async () => {
    User.findById.returns({ select: async () => ({ role: 'receptionist', isActive: true, assignedDoctor: 'doctor-a' }) });
    const res = response(); await cancelAppointmentManually(req('receptionist'), res);
    expect(res.statusCode).to.equal(403);
    expect(Appointment.findOne.called).to.equal(false);
  });
  it('protects a concurrently started or completed appointment', async () => {
    Appointment.findOneAndUpdate.resolves(null);
    const res = response(); await cancelAppointmentManually(req(), res);
    expect(res.statusCode).to.equal(409);
    expect(manualCancellationEffects.online.called).to.equal(false);
  });
  it('allows unstarted skipped doctor bookings while retaining atomic start guards', async () => {
    Appointment.findOne.resolves({ _id: 'booking-a', status: 'pending', queue_status: 'skipped' });
    const res = response(); await cancelAppointmentManually(req(), res);
    expect(res.statusCode).to.equal(200);
    const filter = Appointment.findOneAndUpdate.firstCall.args[0];
    expect(filter.queue_status.$nin).not.to.include('skipped');
    expect(filter.queue_status.$nin).not.to.include('no_show');
    expect(filter['consultation_timing.startedAt']).to.equal(null);
    expect(filter['consultation_timing.started_at']).to.equal(null);
  });
  it('repeated cancellation is harmless and does not repeat notifications', async () => {
    Appointment.findOne.resolves({ _id: 'booking-a', status: 'canceled' });
    const res = response(); await cancelAppointmentManually(req(), res);
    expect(res.statusCode).to.equal(200);
    expect(Appointment.findOneAndUpdate.called).to.equal(false);
    expect(manualCancellationEffects.online.called).to.equal(false);
  });
  it('rejects other staff roles', async () => {
    const res = response(); await cancelAppointmentManually(req('nurse'), res);
    expect(res.statusCode).to.equal(403);
    expect(Appointment.findOne.called).to.equal(false);
  });
});
