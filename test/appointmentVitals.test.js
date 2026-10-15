import { expect } from 'chai';
import sinon from 'sinon';
import User from '../src/models/userModel.js';
import Appointment from '../src/models/appointmentModel.js';
import WalkinAppointment from '../src/models/walkinAppointmentModel.js';
import { saveAppointmentVitals } from '../src/controllers/receptionistController.js';
import { validateVitals, vitalsSchemaRepository } from '../src/services/appointmentVitalsService.js';

describe('Appointment vitals', () => {
  let sandbox, res, req, user;
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.useFakeTimers({ now: new Date('2026-10-15T06:00:00Z'), toFake: ['Date'] });
    res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
    user = { role: 'receptionist', assignedDoctor: 'doctor', clinic_id: 'clinic', isActive: true };
    sandbox.stub(User, 'findById').returns({ select: async () => user });
    req = { userId: 'staff', params: { id: 'visit' }, body: { source: 'online', vitals: { blood_pressure: '120/80', pulse: '75', temperature: '37', spo2: '98', respiratory_rate: '16', pain_score: '0' } } };
  });
  afterEach(() => sandbox.restore());
  it('notifies only the linked patient after readings are saved', async () => {
    sandbox.stub(Appointment, 'findOne').resolves({ _id: 'visit', patient: 'patient-account', appointment_date: '2026-10-15', status: 'confirmed', queue_status: 'waiting' });
    const update = sandbox.stub(Appointment, 'updateOne').resolves({ matchedCount: 1 });
    const emit = sinon.spy();
    const to = sinon.stub().returns({ emit });
    const previous = global.io;
    global.io = { to };
    try {
      await saveAppointmentVitals(req, res);
      expect(to.firstCall.args[0]).to.equal('user_patient-account');
      expect(emit.firstCall.args[0]).to.equal('patientVitalsUpdated');
      expect(update.calledBefore(to)).to.equal(true);
      expect(emit.firstCall.args[1]).not.to.have.property('vitals');
    } finally { global.io = previous; }
  });
  it('stores measured values and server-owned recorder metadata in the scoped online appointment', async () => {
    const find = sandbox.stub(Appointment, 'findOne').resolves({ appointment_date: '2026-10-15', status: 'confirmed', queue_status: 'waiting' });
    const update = sandbox.stub(Appointment, 'updateOne').resolves({ matchedCount: 1 });
    req.body.vitals.recorded_by = 'forged';
    await saveAppointmentVitals(req, res);
    expect(find.firstCall.args[0]).to.deep.equal({ _id: 'visit', counselor: 'doctor', clinic_id: 'clinic' });
    const saved = update.firstCall.args[1].$set.vitals;
    expect(saved).to.include({ pulse: 75, pain_score: 0, recorded_by: 'staff', recorded_role: 'receptionist', temperature_unit: 'C' });
    expect(saved.recorded_at).to.be.a('string');
    expect(res.json.firstCall.args[0].success).to.equal(true);
  });
  it('uses walk-in storage and ensures its JSON column exists', async () => {
    req.body.source = 'walkin';
    const find = sandbox.stub(WalkinAppointment, 'findOne').resolves({ appointment_date: '2026-10-15', appointment_status: 'booked' });
    const schema = sandbox.stub(vitalsSchemaRepository, 'query').resolves([[{ Field: 'vitals' }]]);
    const update = sandbox.stub(WalkinAppointment, 'updateOne').resolves({ matchedCount: 1 });
    await saveAppointmentVitals(req, res);
    expect(find.firstCall.args[0]).to.deep.equal({ _id: 'visit', doctor_id: 'doctor', clinic_id: 'clinic' });
    expect(schema.calledOnce).to.equal(true);
    expect(update.calledOnce).to.equal(true);
    expect(update.firstCall.args[0]).to.include({ appointment_status: 'booked' });
  });
  it('does not write when the patient belongs to another clinic or doctor', async () => {
    sandbox.stub(Appointment, 'findOne').resolves(null);
    const update = sandbox.stub(Appointment, 'updateOne');
    await saveAppointmentVitals(req, res);
    expect(res.status.calledWith(404)).to.equal(true);
    expect(update.called).to.equal(false);
  });
  it('rejects staff without recording access', async () => {
    user.role = 'billing';
    const find = sandbox.stub(Appointment, 'findOne');
    await saveAppointmentVitals(req, res);
    expect(res.status.calledWith(403)).to.equal(true);
    expect(find.called).to.equal(false);
  });
  it('allows the owning doctor to record measurements', async () => {
    user.role = 'doctor'; req.userId = 'doctor';
    const find = sandbox.stub(Appointment, 'findOne').resolves({ appointment_date: '2026-10-15', status: 'confirmed' });
    sandbox.stub(Appointment, 'updateOne').resolves({ matchedCount: 1 });
    await saveAppointmentVitals(req, res);
    expect(find.firstCall.args[0]).to.deep.equal({ _id: 'visit', counselor: 'doctor' });
    expect(res.json.firstCall.args[0].vitals.recorded_role).to.equal('doctor');
  });
  for (const row of [{ status: 'completed' }, { status: 'canceled' }, { status: 'confirmed', queue_status: 'completed' }, { status: 'confirmed', consultation_ended_at: '2026-10-15T10:00:00Z' }]) {
    it(`keeps closed visits read-only: ${JSON.stringify(row)}`, async () => {
      sandbox.stub(Appointment, 'findOne').resolves(row);
      const update = sandbox.stub(Appointment, 'updateOne');
      await saveAppointmentVitals(req, res);
      expect(res.status.calledWith(409)).to.equal(true);
      expect(update.called).to.equal(false);
    });
  }
  it('reports a concurrent appointment status change', async () => {
    sandbox.stub(Appointment, 'findOne').resolves({ appointment_date: '2026-10-15', status: 'confirmed', queue_status: 'waiting' });
    sandbox.stub(Appointment, 'updateOne').resolves({ matchedCount: 0 });
    await saveAppointmentVitals(req, res);
    expect(res.status.calledWith(409)).to.equal(true);
  });
  for (const date of ['2026-10-14', '2026-10-16']) {
    it(`rejects direct vitals writes for an appointment outside today: ${date}`, async () => {
      sandbox.stub(Appointment, 'findOne').resolves({ appointment_date: date, status: 'confirmed' });
      const update = sandbox.stub(Appointment, 'updateOne');
      await saveAppointmentVitals(req, res);
      expect(res.status.calledWith(409)).to.equal(true);
      expect(update.called).to.equal(false);
    });
  }
  for (const vitals of [{}, { pulse: true }, { spo2: 101 }, { weight: -1 }, { temperature: 98.6 }, { pulse: 'NaN' }, { blood_pressure: '80/120' }, { pain_score: 2.5 }, { pulse: 70, notes: 'x'.repeat(1001) }]) {
    it(`rejects invalid measurements ${JSON.stringify(vitals).slice(0, 80)}`, () => {
      expect(() => validateVitals(vitals)).to.throw();
    });
  }
  it('leaves unmeasured fields absent and retains a measured zero oxygen value', () => {
    expect(validateVitals({ pulse: '', weight: '', spo2: 0 })).to.deep.equal({ spo2: 0, temperature_unit: 'C' });
  });
});
