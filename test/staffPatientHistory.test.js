import { expect } from 'chai';
import sinon from 'sinon';
import User from '../src/models/userModel.js';
import Clinic from '../src/models/clinicModel.js';
import Appointment from '../src/models/appointmentModel.js';
import WalkinAppointment from '../src/models/walkinAppointmentModel.js';
import Prescription from '../src/models/Prescription.js';
import { FollowUp } from '../src/models/clinicModels.js';
import { staffPatientHistory } from '../src/controllers/staffPatientHistoryController.js';
import { getMyPrescriptions, appointmentToPrescriptionResponse } from '../src/controllers/prescriptionController.js';

const response = () => ({ status: sinon.stub().returnsThis(), json: sinon.spy(), set: sinon.spy() });
const chain = rows => ({ populate() { return this; }, select() { return this; }, sort() { return this; }, lean: async () => rows });
const doctor = { _id: 'doctor-one', role: 'doctor', fullName: 'Dr One', specialization: ['General medicine'] };
const medicine = { name: 'Recorded medicine', dosage: 'Recorded dosage', timeOfDay: ['Night'], timing: 'After meals', duration: '5 days' };
const online = { _id: 'online-one', counselor: 'doctor-one', patient: { _id: 'patient-one', fullName: 'Patient One', phoneNumber: '9876543210', gender: 'female' }, appointment_date: '2026-10-11', clinic_id: 'clinic-one', consultation_ended_at: '2026-10-11T19:00:00Z', status: 'completed', diagnosis: 'Recorded diagnosis', advice: 'Recorded advice', notes: JSON.stringify({ __doctorConsultation: 1, details: { diagnosis: 'Recorded diagnosis', medicines: [medicine], advice: 'Recorded advice', recommended_tests: [{ testName: 'Recorded test' }] } }) };
const walkin = { id: 'walkin-one', doctor_id: 'doctor-one', patient_id: 'patient-one', patient_name: 'Patient One', clinic_id: 'clinic-one', appointment_date: '2026-10-12', appointment_status: 'completed', medicines: JSON.stringify([medicine]), diagnosis: 'Walk-in diagnosis', consultation_timing: { endedAt: '2026-10-12T05:00:00Z' } };
describe('Doctor-scoped staff patient history', () => {
  afterEach(() => sinon.restore());
  const prepare = () => {
    sinon.stub(User, 'findById').returns({ select: async () => ({ role: 'nurse', isActive: true, assignedDoctor: 'doctor-one' }) });
    sinon.stub(User, 'findOne').returns({ select: async () => doctor });
    sinon.stub(Clinic, 'find').resolves([{ id: 'clinic-one', clinic_name: 'Clinic One' }]);
    sinon.stub(Appointment, 'find').returns(chain([online]));
    sinon.stub(WalkinAppointment, 'find').returns(chain([walkin]));
    sinon.stub(Prescription, 'find').returns(chain([{ _id: 'rx-one', psychiatristId: 'doctor-one', patientId: 'patient-one', patientSnapshot: { name: 'Patient One' }, psychiatristSnapshot: { name: 'Dr One' }, problem: 'Chat problem', medicines: [medicine], issuedAt: '2026-10-10T05:00:00Z' }]));
  };
  it('rejects another doctor before reading records', async () => {
    prepare(); const res = response();
    await staffPatientHistory({ userId: 'staff', query: { doctor_id: 'doctor-two' } }, res);
    expect(res.status.calledWith(403)).to.equal(true);
    expect(Appointment.find.called).to.equal(false);
  });
  it('returns only doctor-scoped queries and preserves the patient-side prescription format', async () => {
    prepare(); const res = response();
    await staffPatientHistory({ userId: 'staff', query: {} }, res);
    const data = res.json.firstCall.args[0];
    expect(data.records).to.have.length(3);
    expect(Appointment.find.firstCall.args[0].counselor).to.equal('doctor-one');
    expect(WalkinAppointment.find.firstCall.args[0].doctor_id).to.equal('doctor-one');
    expect(Prescription.find.firstCall.args[0]).to.deep.equal({ psychiatristId: 'doctor-one' });
    const visit = data.records.find(row => row.source === 'online');
    expect(visit.checkedDate).to.equal('2026-10-12');
    expect(visit.prescription.medicines).to.deep.equal(appointmentToPrescriptionResponse(online, doctor).medicines);
    expect(visit.prescription.advice).to.equal('Recorded advice');
    expect(visit.prescription.recommendedTests[0].testName).to.equal('Recorded test');
    expect(data.records.find(row => row.source === 'walkin').prescription.medicines[0].duration).to.equal('5 days');
    expect(data.summary).to.deep.equal({ visits: 2, patients: 1, prescriptions: 3 });
  });
  it('filters using the actual checkup day in India and paginates all record sources', async () => {
    prepare(); const res = response();
    await staffPatientHistory({ userId: 'staff', query: { from: '2026-10-12', to: '2026-10-12', limit: '1', page: '2' } }, res);
    const data = res.json.firstCall.args[0];
    expect(data.total).to.equal(2); expect(data.records).to.have.length(1);
    expect(data.records[0].checkedDate).to.equal('2026-10-12');
  });
  it('does not associate unlinked chat prescriptions with a selected clinic', async () => {
    prepare(); const res = response();
    await staffPatientHistory({ userId: 'staff', query: { clinic_id: 'clinic-one' } }, res);
    expect(Prescription.find.called).to.equal(false);
    expect(res.json.firstCall.args[0].separatePrescriptionsExcluded).to.equal(true);
    expect(Appointment.find.firstCall.args[0].clinic_id).to.equal('clinic-one');
  });
  it('rejects a clinic belonging to a different doctor', async () => {
    prepare(); const res = response();
    await staffPatientHistory({ userId: 'staff', query: { clinic_id: 'clinic-two' } }, res);
    expect(res.status.calledWith(403)).to.equal(true);
  });
  it('validates dates and pagination', async () => {
    prepare();
    for (const query of [{ from: '2026-02-30' }, { from: '2026-10-12', to: '2026-10-10' }, { limit: 100 }, { page: 0 }, { source: 'other' }]) {
      const res = response(); await staffPatientHistory({ userId: 'staff', query }, res); expect(res.status.calledWith(400)).to.equal(true);
    }
  });
  it('includes patient-linked completed walk-ins in the patient prescription list without ID collisions', async () => {
    sinon.stub(Prescription, 'find').returns(chain([]));
    const patientOnline = { ...online, patient: 'patient-one' };
    sinon.stub(Appointment, 'find').returns(chain([patientOnline]));
    sinon.stub(WalkinAppointment, 'find').returns(chain([walkin]));
    sinon.stub(User, 'find').returns(chain([doctor]));
    sinon.stub(User, 'findById').returns(chain([{ fullName: 'Patient One' }]));
    // findById returns one document, rather than an array.
    User.findById.returns({ lean: async () => ({ fullName: 'Patient One', gender: 'female' }) });
    sinon.stub(FollowUp, 'find').returns(chain([]));
    const res = response();
    await getMyPrescriptions({ user: { _id: 'patient-one', role: 'user' } }, res);
    const data = res.json.firstCall.args[0];
    expect(WalkinAppointment.find.firstCall.args[0]).to.deep.equal({ patient_id: 'patient-one', appointment_status: 'completed' });
    expect(data.prescriptions).to.have.length(2);
    expect(new Set(data.prescriptions.map(row => row.id)).size).to.equal(2);
    expect(data.prescriptions.find(row => row.visitSource === 'walkin').medicines[0].name).to.equal(medicine.name);
    expect(data.doctorCards[0].appointments).to.have.length(2);
  });
});
