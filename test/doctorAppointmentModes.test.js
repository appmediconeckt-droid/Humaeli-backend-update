import { expect } from 'chai';
import sinon from 'sinon';
import User from '../src/models/userModel.js';
import Appointment from '../src/models/appointmentModel.js';
import { book } from '../src/controllers/appointmentController.js';
import { validateDoctorAppointmentMode } from '../src/services/doctorAppointmentModes.js';

describe('Doctor appointment booking modes', () => {
  afterEach(() => sinon.restore());
  it('accepts general and video appointments and the existing default', () => {
    for (const mode of ['in-clinic', 'video', undefined]) {
      expect(() => validateDoctorAppointmentMode({ role: 'doctor' }, mode)).not.to.throw();
    }
  });
  it('blocks voice and audio aliases for both doctor role and doctor account type', () => {
    for (const provider of [{ role: 'doctor' }, { role: 'user', accountType: 'doctor' }]) {
      for (const mode of ['voice', 'audio', 'phone', 'Voice Call', 'unknown']) {
        expect(() => validateDoctorAppointmentMode(provider, mode)).to.throw('General Checkup or Video');
      }
    }
    expect(() => validateDoctorAppointmentMode({ role: 'counsellor' }, 'voice')).not.to.throw();
  });
  it('rejects a direct patient voice booking before creating an appointment', async () => {
    sinon.stub(User, 'findOne').returns({ select: async () => ({ _id: 'doctor', role: 'doctor' }) });
    const create = sinon.spy(Appointment, 'create');
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await book({ user: { _id: 'patient', role: 'user' }, body: { counselorId: 'doctor', date: new Date(Date.now() + 86400000).toISOString(), consultation_mode: 'voice' } }, res);
    expect(res.code).to.equal(400);
    expect(res.body.message).to.include('General Checkup or Video');
    expect(create.called).to.equal(false);
  });
});
