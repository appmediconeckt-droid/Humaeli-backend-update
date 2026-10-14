import { expect } from 'chai';
import sinon from 'sinon';
import Appointment from '../src/models/appointmentModel.js';
import User from '../src/models/userModel.js';
import { FollowUp, WalkinAppointment } from '../src/models/clinicModels.js';
import { appointmentFollowUp, syncAppointmentFollowUp, recoverAppointmentFollowUps } from '../src/services/appointmentFollowUpService.js';
import { createFollowUp, getAllFollowUps } from '../src/controllers/followupController.js';
import { updateDoctorAppointment } from '../src/controllers/appointmentController.js';
const doctorId = '507f1f77bcf86cd799439011';
const patientId = '507f191e810c19729de860ea';
const online = { _id: 'online1', counselor: doctorId, patient: patientId, status: 'completed',
  notes: JSON.stringify({ __doctorConsultation: 1, details: { follow_up_required: true, follow_up_date: '2026-10-20' } }) };
const chain = rows => ({ populate() { return this; }, sort() { return this; }, lean: async () => rows });
describe('Appointment follow-up synchronization', () => {
  let upsert;
  beforeEach(() => {
    upsert = sinon.stub(FollowUp, 'findOneAndUpdate').resolves({});
    sinon.stub(Appointment, 'updateOne').resolves({});
    sinon.stub(WalkinAppointment, 'updateOne').resolves({});
  });
  afterEach(() => sinon.restore());
  it('creates the online appointment follow-up with the correct patient and date', async () => {
    await syncAppointmentFollowUp(online);
    expect(upsert.firstCall.args[0]).to.deep.equal({ appointment_id: 'online1' });
    expect(upsert.firstCall.args[1].$set).to.include({ doctor_id: doctorId, patient_id: patientId });
    expect(upsert.firstCall.args[1].$set.follow_up_date.toISOString()).to.equal('2026-10-19T18:30:00.000Z');
  });
  it('creates the menu record through the actual doctor completion controller', async () => {
    const row = { _id: 'visit1', counselor: doctorId, patient: patientId, notes: 'Patient notes', status: 'confirmed',
      save: sinon.stub().resolves(), toJSON() { return { ...this }; } };
    sinon.stub(Appointment, 'findById').resolves(row);
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
    await updateDoctorAppointment({ params: { id: row._id }, user: { _id: doctorId },
      body: { appointment_status: 'completed', follow_up_required: true, follow_up_date: '2026-10-20' } }, res);
    expect(row.save.calledOnce).to.equal(true);
    expect(upsert.calledOnce).to.equal(true);
    expect(upsert.firstCall.args[0]).to.deep.equal({ appointment_id: 'visit1' });
    expect(res.json.firstCall.args[0].appointment.follow_up_date).to.equal('2026-10-20');
  });
  it('does not schedule a date when follow-up was not selected', async () => {
    expect(appointmentFollowUp({ follow_up_required: false, follow_up_date: '2026-10-20' })).to.equal(null);
    await syncAppointmentFollowUp({ follow_up_required: false }); expect(upsert.called).to.equal(false);
  });
  it('preserves the India follow-up date for stored UTC timestamps', () => {
    expect(appointmentFollowUp({ follow_up_required: true, follow_up_date: '2026-10-19T18:30:00.000Z' }).day).to.equal('2026-10-20');
  });
  it('recovers old appointments without overwriting manually edited follow-ups', async () => {
    sinon.stub(Appointment, 'find').returns(chain([online]));
    sinon.stub(WalkinAppointment, 'find').returns(chain([]));
    await recoverAppointmentFollowUps(doctorId);
    expect(upsert.firstCall.args[1]).to.have.property('$setOnInsert');
    expect(Appointment.updateOne.firstCall.args[1]).to.deep.equal({ $set: { follow_up_synced: true } });
    expect(Appointment.find.firstCall.args[0].follow_up_synced).to.deep.equal({ $ne: true });
  });
  it('returns scalar ownership IDs and the populated patient name in the list', async () => {
    sinon.stub(User, 'findById').returns({ select: async () => ({ role: 'doctor', isActive: true }) });
    sinon.stub(Appointment, 'find').returns(chain([])); sinon.stub(WalkinAppointment, 'find').returns(chain([]));
    sinon.stub(FollowUp, 'find').returns(chain([{ _id: 'f1', patient_id: { _id: patientId, fullName: 'Patient One' }, doctor_id: { _id: doctorId, fullName: 'Doctor One' } }]));
    const res = { json: sinon.spy(), status: sinon.stub().returnsThis() };
    await getAllFollowUps({ user: { _id: doctorId }, query: {} }, res);
    expect(res.json.firstCall.args[0][0]).to.include({ patient_id: patientId, doctor_id: doctorId, patient_name: 'Patient One' });
  });
  it('allows a follow-up for the doctor’s accountless walk-in patient', async () => {
    sinon.stub(User, 'findById').returns({ select: async () => ({ role: 'doctor', isActive: true }) });
    sinon.stub(WalkinAppointment, 'findOne').returns({ lean: async () => ({ _id: 'walk1', patient_name: 'Walk-in Patient' }) });
    const create = sinon.stub(FollowUp, 'create').resolves({ _id: 'f1' });
    const res = { json: sinon.spy(), status: sinon.stub().returnsThis() };
    await createFollowUp({ user: { _id: doctorId }, body: { walkin_id: 'walk1', follow_up_date: '2026-10-20' } }, res);
    expect(create.firstCall.args[0]).to.include({ walkin_id: 'walk1', patient_name: 'Walk-in Patient', doctor_id: doctorId });
    expect(res.status.calledWith(201)).to.equal(true);
  });
  it('rejects another doctor’s walk-in patient', async () => {
    sinon.stub(User, 'findById').returns({ select: async () => ({ role: 'doctor', isActive: true }) });
    sinon.stub(WalkinAppointment, 'findOne').returns({ lean: async () => null });
    const create = sinon.stub(FollowUp, 'create'); const res = { json: sinon.spy(), status: sinon.stub().returnsThis() };
    await createFollowUp({ user: { _id: doctorId }, body: { walkin_id: 'other' } }, res);
    expect(res.status.calledWith(404)).to.equal(true); expect(create.called).to.equal(false);
  });
});
