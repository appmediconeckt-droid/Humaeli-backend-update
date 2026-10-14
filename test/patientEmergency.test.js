import { expect } from 'chai';
import sinon from 'sinon';
import Appointment from '../src/models/appointmentModel.js';
import { requestPatientEmergency, patientEmergencyDependencies } from '../src/controllers/patientEmergencyController.js';

describe('Patient emergency requests', () => {
  let req, res, row, find, update, notify;
  beforeEach(() => {
    row = { _id: '507f1f77bcf86cd799439011', status: 'confirmed', queue_status: 'booked', priority: 'normal',
      counselor: { _id: '507f191e810c19729de860ea', role: 'doctor' }, appointment_date: '2026-10-13' };
    req = { user: { _id: '507f191e810c19729de860eb', role: 'user' }, params: { id: row._id }, body: { reason: 'My symptoms are worsening' } };
    res = { status: sinon.stub().returnsThis(), json: sinon.stub().returnsThis() };
    find = sinon.stub(Appointment, 'findOne').returns({ populate: () => ({ lean: async () => row }) });
    update = sinon.stub(Appointment, 'findOneAndUpdate').resolves({});
    notify = sinon.stub(patientEmergencyDependencies, 'notify').resolves({ _id: 'notice' });
  });
  afterEach(() => sinon.restore());
  it('marks only the owned appointment and notifies its doctor using the push service', async () => {
    await requestPatientEmergency(req, res);
    expect(find.firstCall.args[0].patient).to.equal(req.user._id);
    expect(update.firstCall.args[1].$set).to.deep.equal({ priority: 'emergency', emergency_reason: req.body.reason });
    expect(notify.firstCall.args[0]).to.include({ recipientId: row.counselor._id, type: 'appointment' });
    expect(notify.firstCall.args[0].data.type).to.equal('EMERGENCY_APPOINTMENT');
    expect(res.json.firstCall.args[0].success).to.equal(true);
  });
  it('does not notify twice for an existing emergency', async () => {
    row.priority = 'emergency';
    await requestPatientEmergency(req, res);
    expect(update.called).to.equal(false);
    expect(notify.called).to.equal(false);
  });
  it('prevents duplicate alerts from concurrent requests', async () => {
    update.resolves(null);
    await requestPatientEmergency(req, res);
    expect(res.status.calledWith(409)).to.equal(true);
    expect(notify.called).to.equal(false);
  });
  it('rejects appointments belonging to another patient', async () => {
    row = null;
    await requestPatientEmergency(req, res);
    expect(res.status.calledWith(404)).to.equal(true);
    expect(update.called).to.equal(false);
  });
  for (const status of ['completed', 'canceled', 'cancelled', 'rejected']) {
    it(`rejects ${status} appointments`, async () => {
      row.status = status;
      await requestPatientEmergency(req, res);
      expect(res.status.calledWith(400)).to.equal(true);
      expect(notify.called).to.equal(false);
    });
  }
  it('rejects counselor appointments', async () => {
    row.counselor.role = 'counsellor';
    await requestPatientEmergency(req, res);
    expect(res.status.calledWith(400)).to.equal(true);
  });
  it('validates reason and disallows patients removing emergency priority', async () => {
    for (const body of [{ reason: 'short' }, { reason: 'x'.repeat(1001) }, { reason: req.body.reason, is_emergency: false }]) {
      req.body = body;
      await requestPatientEmergency(req, res);
      expect(res.status.calledWith(400)).to.equal(true);
    }
    expect(find.called).to.equal(false);
  });
  it('reports notification failure without losing the saved priority', async () => {
    notify.resolves(null);
    await requestPatientEmergency(req, res);
    expect(res.json.firstCall.args[0].notificationCreated).to.equal(false);
    expect(update.calledOnce).to.equal(true);
  });
});
