import { expect } from 'chai';
import sinon from 'sinon';
import mongoose from '../src/persistence/mongoose.js';
import mysql from 'mysql2/promise';
import Appointment from '../src/models/appointmentModel.js';
import { WalkinAppointment, DoctorBreak } from '../src/models/clinicModels.js';
import User from '../src/models/userModel.js';
import { getAppointments, getAppointmentAll } from '../src/controllers/appointmentController.js';
import { updateWalkinAppointment, getWalkinAppointments } from '../src/controllers/walkinAppointmentController.js';

const doctorId = '507f1f77bcf86cd799439011';
const medicine = { name: 'Recorded medicine', dosage: 'Recorded dosage', timings: ['Morning'], durationValue: '5', durationType: 'Days' };
const chain = rows => ({ populate() { return this; }, sort() { return this; }, lean: async () => rows });
const response = () => ({ status: sinon.stub().returnsThis(), json: sinon.spy() });

describe('Appointment medicine readback', () => {
  beforeEach(() => sinon.stub(User, 'findById').returns({ select: async () => ({ role: 'doctor', isActive: true }) }));
  afterEach(() => sinon.restore());
  const online = () => ({ _id: 'online-record', status: 'completed', notes: JSON.stringify({
    __doctorConsultation: 1, originalNotes: 'Original patient notes',
    details: { medicine: 'Recorded medicine', medicines: [medicine] },
  }) });
  it('returns saved medicine fields in the doctor dashboard list', async () => {
    sinon.stub(Appointment, 'find').returns(chain([online()]));
    const res = response();
    await getAppointments({ user: { _id: doctorId, role: 'doctor' }, query: {} }, res);
    expect(res.json.firstCall.args[0][0]).to.include({ medicine: 'Recorded medicine', notes: 'Original patient notes' });
    expect(res.json.firstCall.args[0][0].medicines).to.deep.equal([medicine]);
  });
  it('returns saved medicine fields in patient appointment history', async () => {
    sinon.stub(Appointment, 'find').returns(chain([online()]));
    const res = response();
    await getAppointmentAll({ user: { _id: doctorId, role: 'doctor' }, query: {} }, res);
    expect(res.json.firstCall.args[0].appointments[0].medicines).to.deep.equal([medicine]);
  });
  it('keeps ordinary patient notes unchanged', async () => {
    sinon.stub(Appointment, 'find').returns(chain([{ notes: 'Normal notes', status: 'pending' }]));
    const res = response();
    await getAppointments({ user: { _id: doctorId, role: 'doctor' }, query: {} }, res);
    expect(res.json.firstCall.args[0][0].notes).to.equal('Normal notes');
  });
  it('persists walk-in medicine text and structured medicine fields, then returns them on reload', async () => {
    const oldDb = mongoose.connection.db;
    mongoose.connection.db = { pool: {}, databaseName: 'unit-test' };
    try {
      sinon.stub(mysql, 'createConnection').resolves({ execute: async () => [[{ acquired: 1 }]], end: async () => {} });
      sinon.stub(Appointment, 'find').returns(chain([]));
      const row = { _id: 'walkin-record', doctor_id: doctorId, appointment_date: '2026-10-13', appointment_time: '10:00',
        appointment_status: 'completed', phone_number: '9999999999',
        validate: sinon.stub().resolves(), save: sinon.stub().resolves(), toObject() { return { ...this }; } };
      sinon.stub(WalkinAppointment, 'findOne').resolves(row);
      const find = sinon.stub(WalkinAppointment, 'find').returns(chain([]));
      const res = response();
      await updateWalkinAppointment({ user: { _id: doctorId, role: 'doctor' }, params: { id: row._id },
        body: { medicine: 'Recorded medicine', medicines: [medicine] } }, res);
      expect(row.save.calledOnce).to.equal(true);
      expect(row.medicines).to.deep.equal([medicine]);
      find.returns(chain([row]));
      sinon.stub(DoctorBreak, 'find').returns(chain([]));
      sinon.stub(DoctorBreak, 'findOne').resolves(null);
      const loaded = response();
      await getWalkinAppointments({ user: { _id: doctorId, role: 'doctor' }, query: {} }, loaded);
      expect(loaded.json.firstCall.args[0].data[0].medicines).to.deep.equal([medicine]);
    } finally { mongoose.connection.db = oldDb; }
  });
});
