import { expect } from 'chai';
import sinon from 'sinon';
import { latestPatientVitals } from '../src/services/patientVitalsService.js';
import { getMyVitals } from '../src/controllers/patientVitalsController.js';
import Appointment from '../src/models/appointmentModel.js';
import WalkinAppointment from '../src/models/walkinAppointmentModel.js';

describe('Patient profile vitals', () => {
  afterEach(() => sinon.restore());
  const old = { _id: 'old', appointment_date: '2026-10-10', vitals: { blood_pressure: '120/80', weight: 65, recorded_at: '2026-10-10T10:00:00Z', recorded_by: 'private-staff-id' } };
  it('keeps previous readings when a new appointment has no measurements', () => {
    expect(latestPatientVitals([old, { _id: 'new', appointment_date: '2026-10-15' }], []).appointmentId).to.equal('old');
  });
  it('selects the latest measurement across online and linked walk-in visits without merging old fields', () => {
    const latest = latestPatientVitals([old], [{ _id: 'walkin', appointment_date: '2026-10-15', vitals: { pulse: 75, recorded_at: '2026-10-15T10:00:00Z' } }]);
    expect(latest.source).to.equal('walkin');
    expect(latest.vitals.pulse).to.equal(75);
    expect(latest.vitals).not.to.have.property('weight');
  });
  it('does not rank profile or appointment updatedAt over the measurement date', () => {
    const latest = latestPatientVitals([{ ...old, updatedAt: '2099-01-01' }, { _id: 'latest', appointment_date: '2026-10-11', vitals: { pulse: 80 } }], []);
    expect(latest.appointmentId).to.equal('latest');
  });
  it('accepts legacy JSON readings and excludes recorder identifiers', () => {
    const latest = latestPatientVitals([{ ...old, vitals: JSON.stringify({ ...old.vitals, bp: '120/80' }) }], []);
    expect(latest.vitals.blood_pressure).to.equal('120/80');
    expect(latest.vitals).not.to.have.property('recorded_by');
  });
  it('returns no snapshot for empty or malformed readings', () => {
    expect(latestPatientVitals([{ vitals: '{bad' }, { vitals: { notes: 'only notes' } }], [])).to.equal(null);
  });
  it('uses only authenticated patient links even if another user is requested', async () => {
    const find = sinon.stub(Appointment, 'find').returns({ select: () => ({ lean: async () => [old] }) });
    const walkins = sinon.stub(WalkinAppointment, 'find').returns({ lean: async () => [] });
    const res = { set: sinon.spy(), json: sinon.spy(), status: sinon.stub().returnsThis() };
    await getMyVitals({ userId: 'own-account', query: { patient_id: 'other' } }, res);
    expect(find.firstCall.args[0]).to.deep.equal({ patient: 'own-account' });
    expect(walkins.firstCall.args[0]).to.deep.equal({ patient_id: 'own-account' });
    expect(res.json.firstCall.args[0].latest.appointmentId).to.equal('old');
  });
});
