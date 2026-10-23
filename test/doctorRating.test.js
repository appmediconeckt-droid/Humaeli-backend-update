import { doctorRatingRepository } from '../src/services/doctorRatingService.js';
import { expect } from 'chai';
import sinon from 'sinon';
import Appointment from '../src/models/appointmentModel.js';
import { submitDoctorRating } from '../src/controllers/doctorRatingController.js';

describe('Doctor appointment ratings', () => {
  let req, res, find, update;
  const appointmentId = '507f1f77bcf86cd799439011';
  beforeEach(() => {
    sinon.stub(doctorRatingRepository, 'connection').resolves({ query: sinon.stub().resolves([[{ acquired: 1 }]]), release: sinon.spy() });
    sinon.stub(Appointment, 'exists').resolves(false);
    req = { user: { role: 'user', _id: '507f191e810c19729de860ea' }, params: { id: appointmentId }, body: { rating: 5, review: ' Helpful ' } };
    res = { status: sinon.stub().returnsThis(), json: sinon.stub().returnsThis() };
    const appointment = { _id: appointmentId, status: 'completed', counselor: { _id: '507f1f77bcf86cd799439013', role: 'doctor' } };
    find = sinon.stub(Appointment, 'findOne').returns({ populate: () => ({ lean: async () => appointment }) });
    update = sinon.stub(Appointment, 'findOneAndUpdate').resolves({ doctorRating: { stars: 5, review: 'Helpful' } });
  });
  afterEach(() => sinon.restore());
  it('saves a completed appointment rating using an ownership and duplicate guard', async () => {
    await submitDoctorRating(req, res);
    expect(res.status.calledWith(201)).to.equal(true);
    expect(find.firstCall.args[0].patient).to.equal(req.user._id);
    expect(update.firstCall.args[0]).to.deep.include({ patient: req.user._id, status: 'completed', doctorRating: { $exists: false } });
    expect(update.firstCall.args[1].$set.doctorRating.review).to.equal('Helpful');
  });
  it('rejects rating the same doctor through a different completed appointment', async () => {
    Appointment.exists.resolves(true);
    await submitDoctorRating(req, res);
    expect(res.status.calledWith(409)).to.equal(true);
    expect(update.called).to.equal(false);
    const filter = Appointment.exists.firstCall.args[0];
    expect(filter.patient).to.equal(req.user._id);
    expect(filter).not.to.have.property('_id');
  });
  it('rejects a duplicate submission', async () => {
    update.resolves(null);
    await submitDoctorRating(req, res);
    expect(res.status.calledWith(409)).to.equal(true);
  });
  for (const [name, appointment, status] of [
    ['another patient appointment', null, 404],
    ['unfinished appointment', { status: 'confirmed', counselor: { _id: '507f1f77bcf86cd799439013', role: 'doctor' } }, 400],
    ['counselor appointment', { status: 'completed', counselor: { role: 'counsellor' } }, 400],
  ]) {
    it(`rejects ${name}`, async () => {
      find.returns({ populate: () => ({ lean: async () => appointment }) });
      await submitDoctorRating(req, res);
      expect(res.status.calledWith(status)).to.equal(true);
      expect(update.called).to.equal(false);
    });
  }
  it('rejects invalid stars and excessive review text', async () => {
    for (const body of [{ rating: 0 }, { rating: 6 }, { rating: 1.5 }, { rating: '5' }, { rating: 5, review: 'x'.repeat(501) }]) {
      req.body = body;
      await submitDoctorRating(req, res);
      expect(res.status.calledWith(400)).to.equal(true);
    }
    expect(find.called).to.equal(false);
  });
  it('rejects non-patient users', async () => {
    req.user.role = 'doctor';
    await submitDoctorRating(req, res);
    expect(res.status.calledWith(403)).to.equal(true);
    expect(find.called).to.equal(false);
  });
});
