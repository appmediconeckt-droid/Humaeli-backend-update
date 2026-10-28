import { expect } from 'chai';
import sinon from 'sinon';
import User from '../src/models/userModel.js';
import { clinicFeeUpdate } from '../src/controllers/clinicController.js';

describe('Clinic video additional fees', () => {
  beforeEach(() => sinon.stub(User, 'findById').resolves({ consultationCurrency: 'INR' }));
  afterEach(() => sinon.restore());
  it('saves checkup and video fee together from multipart form strings', async () => {
    expect(await clinicFeeUpdate({ fee: '500', videoConsultationAdditionalFee: '125.50' }, 'doctor')).to.deep.equal({ fee: 500, videoConsultationAdditionalFee: 125.5 });
  });
  it('updates either fee without clearing the other', async () => {
    expect(await clinicFeeUpdate({ videoConsultationAdditionalFee: '0' }, 'doctor')).to.deep.equal({ videoConsultationAdditionalFee: 0 });
    expect(await clinicFeeUpdate({ fee: '750' }, 'doctor')).to.deep.equal({ fee: 750 });
    expect(await clinicFeeUpdate({ clinic_name: 'Updated name' }, 'doctor')).to.deep.equal({});
    expect(await clinicFeeUpdate({ fee: null }, 'doctor')).to.deep.equal({ fee: null });
  });
  it('rejects invalid additional fees', async () => {
    for (const value of [-1, '', 'invalid', true, 0.001, 10000000]) {
      let failure;
      try { await clinicFeeUpdate({ videoConsultationAdditionalFee: value }, 'doctor'); } catch (error) { failure = error; }
      expect(failure?.statusCode).to.equal(400);
    }
  });
});
