import { expect } from 'chai';
import { appointmentAdditionalFee } from '../src/services/appointmentFees.js';

describe('Doctor video appointment fee', () => {
  it('uses the selected clinic video fee and defaults to zero', () => {
    for (const provider of [{ role: 'doctor' }, { accountType: 'doctor' }]) {
      expect(appointmentAdditionalFee('video', { videoConsultationAdditionalFee: 125.5 }, provider)).to.equal(125.5);
      expect(appointmentAdditionalFee('video', null, provider)).to.equal(0);
      expect(appointmentAdditionalFee('video', { videoConsultationAdditionalFee: 0 }, provider)).to.equal(0);
      expect(appointmentAdditionalFee('in-clinic', { videoConsultationAdditionalFee: 125.5 }, provider)).to.equal(0);
    }
  });
  it('keeps two clinic additional fees independent', () => {
    const doctor = { role: 'doctor' };
    expect(appointmentAdditionalFee('video', { videoConsultationAdditionalFee: 100 }, doctor)).to.equal(100);
    expect(appointmentAdditionalFee('video', { videoConsultationAdditionalFee: 250 }, doctor)).to.equal(250);
    expect(appointmentAdditionalFee('in-clinic', { videoConsultationAdditionalFee: 250 }, doctor)).to.equal(0);
  });
  it('preserves existing consultant pricing', () => {
    expect(appointmentAdditionalFee('video', {}, { role: 'counsellor' })).to.equal(10);
  });
});
