import { expect } from 'chai';
import sinon from 'sinon';
import mongoose from '../src/persistence/mongoose.js';
import mysql from 'mysql2/promise';
import User from '../src/models/userModel.js';
import Appointment from '../src/models/appointmentModel.js';
import { WalkinAppointment } from '../src/models/clinicModels.js';
import { slotRepository } from '../src/services/appointmentSlotService.js';
import { updateWalkinAppointment } from '../src/controllers/walkinAppointmentController.js';
const doctorId = '507f1f77bcf86cd799439011';
const visitId = '507f191e810c19729de860ea';
describe('Walk-in consultation start', () => {
  let row, save, res, oldDb, oldIo;
  beforeEach(() => {
    oldDb = mongoose.connection.db; oldIo = global.io; global.io = undefined;
    mongoose.connection.db = { pool: {}, databaseName: 'unit-test' };
    row = WalkinAppointment.hydrate({ _id: visitId, doctor_id: doctorId, patient_name: 'Test Patient', phone_number: '9999999999',
      symptoms: 'Recorded symptoms', appointment_date: '2026-10-13', appointment_time: '10:00', token_number: 1,
      appointment_status: 'booked' });
    save = sinon.stub(row, 'save').resolves(row);
    sinon.stub(User, 'findById').returns({ select: async () => ({ role: 'doctor', isActive: true }) });
    sinon.stub(WalkinAppointment, 'findOne').resolves(row);
    sinon.stub(Appointment, 'find').returns({ lean: async () => [] });
    sinon.stub(WalkinAppointment, 'find').returns({ lean: async () => [] });
    sinon.stub(mysql, 'createConnection').resolves({ execute: async () => [[{ acquired: 1 }]], end: async () => {} });
    sinon.stub(slotRepository, 'online').resolves([]); sinon.stub(slotRepository, 'walkins').resolves([]);
    sinon.stub(slotRepository, 'ranges').resolves([]);
    res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
  });
  afterEach(() => { sinon.restore(); mongoose.connection.db = oldDb; global.io = oldIo; });
  const update = body => updateWalkinAppointment({ user: { _id: doctorId }, params: { id: visitId }, body }, res);
  it('validates and saves in-progress status with the consultation start time', async () => {
    await update({ status: 'in-progress' });
    expect(save.calledOnce).to.equal(true);
    expect(row.appointment_status).to.equal('in-progress');
    expect(row.queue_status).to.equal('in_progress');
    expect(row.consultation_started_at).to.be.instanceOf(Date);
    expect(row.consultation_timing.startedAt).to.exist;
    expect(res.json.firstCall.args[0].success).to.equal(true);
  });
  it('normalizes the underscore status alias', async () => {
    await update({ appointment_status: 'in_progress' });
    expect(row.appointment_status).to.equal('in-progress'); expect(save.calledOnce).to.equal(true);
    expect(row.consultation_started_at).to.be.instanceOf(Date);
  });
  it('persists the start and end timestamps when a started visit is completed', async () => {
    await update({ status: 'in-progress' });
    const started = row.consultation_started_at.getTime();
    await update({ status: 'completed' });
    expect(row.queue_status).to.equal('completed');
    expect(row.consultation_started_at.getTime()).to.equal(started);
    expect(row.consultation_ended_at).to.be.instanceOf(Date);
  });
  it('rejects invalid statuses with a client error', async () => {
    await update({ status: 'invalid' }); expect(res.status.calledWith(400)).to.equal(true); expect(save.called).to.equal(false);
  });
  for (const status of ['completed', 'cancelled']) {
    it(`cannot restart a ${status} appointment`, async () => {
      row.appointment_status = status; await update({ status: 'in-progress' });
      expect(res.status.calledWith(409)).to.equal(true); expect(save.called).to.equal(false);
    });
  }
  it('prevents starting a second simultaneous consultation', async () => {
    slotRepository.online.resolves([{ _id: 'another', counselor: doctorId, status: 'confirmed', queue_status: 'in_progress' }]);
    await update({ status: 'in-progress' });
    expect(res.status.calledWith(409)).to.equal(true); expect(save.called).to.equal(false);
  });
});
