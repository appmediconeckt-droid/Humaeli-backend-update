import { expect } from 'chai';
import sinon from 'sinon';
import WalkinAppointment from '../src/models/walkinAppointmentModel.js';
import Appointment from '../src/models/appointmentModel.js';
import DoctorBreak from '../src/models/doctorBreakModel.js';
import User from '../src/models/userModel.js';
import Clinic from '../src/models/clinicModel.js';
import { slotRepository } from '../src/services/appointmentSlotService.js';
import { walkinPatientId, patientWalkinView, getPatientWalkinAppointments } from '../src/services/patientWalkinAppointments.js';

describe('Patient walk-in appointments', () => {
  afterEach(() => sinon.restore());

  it('uses the authenticated patient identity and leaves guest/provider bookings unlinked', () => {
    expect(walkinPatientId({ _id: 'patient1', role: 'user' })).to.equal('patient1');
    expect(walkinPatientId({ _id: 'doctor1', role: 'doctor' })).to.equal(undefined);
    expect(walkinPatientId()).to.equal(undefined);
  });

  it('queries only the logged-in patients records', async () => {
    const find = sinon.stub(WalkinAppointment, 'find').returns({ lean: async () => [] });
    expect(await getPatientWalkinAppointments('patient1')).to.deep.equal([]);
    expect(find.firstCall.args[0]).to.deep.equal({ patient_id: 'patient1' });
  });

  it('adapts doctor, clinic, schedule and token to the existing patient appointment cards', () => {
    const doctor = { _id: 'doctor1', fullName: 'Doctor One', role: 'doctor' };
    const row = patientWalkinView({ _id: 'visit1', patient_id: 'patient1', doctor_id: 'doctor1',
      clinic_id: 'clinic1', appointment_date: '2026-11-14', appointment_time: '10:30:00',
      appointment_status: 'booked', token_number: 7 }, doctor, { clinic_name: 'Clinic One' });
    expect(row).to.include({ _id: 'visit1', appointment_type: 'walkin', patient: 'patient1',
      status: 'confirmed', consultationMode: 'Walk-in', clinic_name: 'Clinic One', token_number: 7 });
    expect(row.counselor).to.deep.equal(doctor);
    expect(new Date(row.date).toISOString()).to.equal('2026-11-14T05:00:00.000Z');
  });

  it('loads linked visits with doctor and clinic details and applies date/status filters', async () => {
    const row = { _id: 'walkin1', patient_id: 'patient1', doctor_id: 'doctor1', clinic_id: 'clinic1',
      appointment_date: '2026-11-14', appointment_time: '10:30', appointment_status: 'booked', token_number: 7 };
    sinon.stub(WalkinAppointment, 'find').callsFake(filter => filter.patient_id
      ? { lean: async () => [row] } : Promise.resolve([]));
    sinon.stub(Appointment, 'find').resolves([]);
    sinon.stub(DoctorBreak, 'find').resolves([]);
    sinon.stub(User, 'find').returns({ select() { return this; }, lean: async () => [{ _id: 'doctor1', fullName: 'Doctor One', role: 'doctor' }] });
    sinon.stub(Clinic, 'find').returns({ select() { return this; }, lean: async () => [{ _id: 'clinic1', clinic_name: 'Clinic One' }] });
    sinon.stub(slotRepository, 'online').resolves([]);
    sinon.stub(slotRepository, 'walkins').resolves([row]);
    sinon.stub(slotRepository, 'ranges').resolves([]);
    const rows = await getPatientWalkinAppointments('patient1', {}, { status: 'confirmed' });
    expect(rows).to.have.length(1);
    expect(rows[0].counselor.fullName).to.equal('Doctor One');
    expect(rows[0].clinic_name).to.equal('Clinic One');
    expect(await getPatientWalkinAppointments('patient1', {}, { status: 'completed' })).to.deep.equal([]);
    expect(await getPatientWalkinAppointments('patient1', { date: { $gte: new Date('2026-11-15') } })).to.deep.equal([]);
  });

  it('preserves cancellation and completion, including legacy consultation end metadata', () => {
    const base = { appointment_date: '2026-11-14', appointment_time: '10:30' };
    expect(patientWalkinView({ ...base, appointment_status: 'cancelled' }).status).to.equal('canceled');
    expect(patientWalkinView({ ...base, appointment_status: 'booked',
      consultation_timing: { endedAt: '2026-11-14T06:00:00Z' } }).status).to.equal('completed');
  });
});
