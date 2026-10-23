import { expect } from 'chai';
import sinon from 'sinon';
import Appointment from '../src/models/appointmentModel.js';
import { Clinic } from '../src/models/clinicModels.js';
import { getDoctorRatingSummary } from '../src/controllers/doctorRatingController.js';
import { summarizeAppointmentRatings, attachDoctorRatings, attachAppointmentDoctorRatings, withRatingLock, doctorRatingRepository } from '../src/services/doctorRatingService.js';

describe('Doctor and clinic rating aggregates', () => {
  afterEach(() => sinon.restore());
  const row = (patient, stars, submittedAt = '2026-10-20') => ({ patient, counselor: 'doctor-1', clinic_id: 'clinic-1', doctorRating: { stars, submittedAt }, clinicRating: { stars, submittedAt } });
  for (const type of ['doctor', 'clinic']) {
    it(`computes ${type} averages once per patient, preserving the first legacy review`, () => {
      const rows = [row('patient-1', 1, '2026-10-22'), row('patient-1', 5), row('patient-2', 4), row('patient-3', 99)];
      const summary = summarizeAppointmentRatings(rows, type).get(`${type}-1`);
      expect(summary.ratingCount).to.equal(2);
      expect(summary.rating).to.equal(4.5);
      expect(summary.reviews).to.have.length(2);
    });
  }
  it('attaches real appointment ratings to doctors while preserving consultant ratings', async () => {
    sinon.stub(Appointment, 'find').returns({ select() { return this; }, lean: async () => [row('patient-1', 5), row('patient-2', 3)] });
    const profiles = await attachDoctorRatings([{ _id: 'doctor-1', role: 'doctor', rating: 0 }, { _id: 'doctor-2', role: 'doctor', rating: 4.9 }, { _id: 'consultant', role: 'counsellor', rating: 4.2 }]);
    expect(profiles[0]).to.include({ rating: 4, ratingCount: 2 });
    expect(profiles[1]).to.include({ rating: 0, ratingCount: 0 });
    expect(profiles[2].rating).to.equal(4.2);
  });
  it('releases the rating lock after a failed submission', async () => {
    const connection = { query: sinon.stub().resolves([[{ acquired: 1 }]]), release: sinon.spy() };
    sinon.stub(doctorRatingRepository, 'connection').resolves(connection);
    try { await withRatingLock('doctor', 'doctor-1', async () => { throw new Error('save failed'); }); }
    catch (error) { expect(error.message).to.equal('save failed'); }
    expect(connection.query.lastCall.args[0]).to.include('RELEASE_LOCK');
    expect(connection.release.calledOnce).to.equal(true);
  });
  it('returns the actual doctor average in appointment profiles instead of a stale saved rating', async () => {
    const find = sinon.stub(Appointment, 'find').returns({ select() { return this; }, lean: async () => [row('patient-1', 5), row('patient-2', 4)] });
    const result = await attachAppointmentDoctorRatings([
      { _id: 'visit-1', counselor: { _id: 'doctor-1', role: 'doctor', rating: 0 } },
      { _id: 'visit-2', counselor: { _id: 'doctor-1', role: 'doctor', rating: 0 } },
    ]);
    expect(find.calledOnce).to.equal(true);
    expect(result[0].counselor).to.include({ rating: 4.5, ratingCount: 2 });
    expect(result[1].counselor).to.include({ rating: 4.5, ratingCount: 2 });
  });
  it('includes reviewer names only when requested for the private doctor view', () => {
    const rows = [{ ...row({ _id: 'patient-1', fullName: 'Arun' }, 5), _id: 'visit-1' },
      { ...row({ _id: 'patient-2', fullName: 'Priya' }, 3), _id: 'visit-2' }];
    const publicSummary = summarizeAppointmentRatings(rows).get('doctor-1');
    expect(publicSummary.ratingCount).to.equal(2);
    expect(publicSummary.reviews[0]).not.to.have.property('reviewerName');
    const privateSummary = summarizeAppointmentRatings(rows, 'doctor', { includeReviewer: true }).get('doctor-1');
    expect(privateSummary.reviews.map(review => review.reviewerName)).to.deep.equal(['Arun', 'Priya']);
    expect(privateSummary.distribution).to.include({ 5: 1, 3: 1 });
  });
  it('returns separate doctor and clinic reviews scoped to the signed-in doctor', async () => {
    const rows = [{ ...row({ _id: 'patient-1', fullName: 'Arun' }, 5), _id: 'visit-1' }];
    const find = sinon.stub(Appointment, 'find').returns({ select() { return this; }, populate() { return this; }, lean: async () => rows });
    sinon.stub(Clinic, 'find').returns({ select() { return this; }, lean: async () => [{ _id: 'clinic-1', clinic_name: 'City Clinic' }] });
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
    await getDoctorRatingSummary({ user: { _id: 'doctor-1' }, query: { doctorId: 'other-doctor' } }, res);
    expect(find.firstCall.args[0].counselor).to.equal('doctor-1');
    const body = res.json.firstCall.args[0];
    expect(body).to.include({ rating: 5, ratingCount: 1 });
    expect(body.reviews[0].reviewerName).to.equal('Arun');
    expect(body.clinics[0]).to.include({ name: 'City Clinic', rating: 5, ratingCount: 1 });
    expect(body.clinics[0].reviews[0].reviewerName).to.equal('Arun');
  });
});
