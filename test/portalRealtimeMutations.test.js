import { expect } from 'chai';
import sinon from 'sinon';
import Prescription from '../src/models/Prescription.js';
import { uploadPatientPhoto, updatePrescriptionFestivalTheme } from '../src/controllers/prescriptionController.js';

const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

describe('Prescription mutation real-time delivery', () => {
  let previousIo, events;
  beforeEach(() => {
    previousIo = global.io;
    events = [];
    global.io = { to: room => ({ emit: (event, payload) => events.push({ room, event, payload }) }) };
  });
  afterEach(() => { global.io = previousIo; sinon.restore(); });

  it('publishes a saved patient photo to both patient and psychiatrist', async () => {
    let finishSave;
    sinon.stub(Prescription, 'findOneAndUpdate').returns(new Promise(resolve => { finishSave = resolve; }));
    const req = { user: { _id: 'patient', role: 'user' }, params: { id: 'rx' }, file: { buffer: Buffer.from('photo'), mimetype: 'image/png', originalname: 'photo.png' } };
    const res = response();
    const pending = uploadPatientPhoto(req, res);
    expect(events).to.have.length(0);
    finishSave({ _id: 'rx', patientId: 'patient', psychiatristId: 'doctor' });
    await pending;
    expect(res.body.success).to.equal(true);
    expect(events.map(({ room }) => room)).to.deep.equal(['user_patient', 'user_doctor']);
    expect(events.every(({ event }) => event === 'prescriptions:updated')).to.equal(true);
    expect(JSON.stringify(events)).not.to.include('photo.png');
  });

  it('never emits an update for a rejected upload or a failed save', async () => {
    const req = { user: { _id: 'patient', role: 'user' }, params: { id: 'rx' }, file: { buffer: Buffer.from('photo'), mimetype: 'image/png' } };
    sinon.stub(Prescription, 'findOneAndUpdate').rejects(new Error('simulated persistence failure'));
    const res = response();
    await uploadPatientPhoto(req, res);
    expect(res.statusCode).to.equal(500);
    expect(events).to.have.length(0);
    const forbidden = response();
    await updatePrescriptionFestivalTheme({ user: { role: 'user' }, body: {} }, forbidden);
    expect(forbidden.statusCode).to.equal(403);
    expect(events).to.have.length(0);
  });
});
