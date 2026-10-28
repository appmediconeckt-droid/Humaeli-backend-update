import { expect } from 'chai';
import sinon from 'sinon';
import Settings from '../src/models/providerPaymentSettingsModel.js';
import Payment from '../src/models/appointmentPaymentModel.js';
import User from '../src/models/userModel.js';
import { getDoctorWallet, payAppointmentInternally } from '../src/controllers/doctorWalletController.js';
import { setupDoctorTestBank } from '../src/controllers/doctorSettlementController.js';
import { paymentMode, requireGatewayEnvironment, requireRecordEnvironment } from '../src/services/paymentEnvironment.js';
import { appointmentPaymentRepository } from '../src/services/appointmentPaymentService.js';
import { bankFingerprint, settlementGateway } from '../src/services/doctorSettlementService.js';
import { publicPaymentSettings } from '../src/services/providerPaymentSettingsService.js';

const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const bank = { accountHolder: 'Test Doctor', bankName: 'Test Bank', accountNumber: '1234567890', ifscCode: 'HDFC0000053' };
describe('Razorpay test and live isolation', () => {
  let env;
  beforeEach(() => { env = { ...process.env }; Object.assign(process.env, { PAYMENTS_MODE: 'test', RAZORPAY_KEY_ID: 'rzp_test_payments', RAZORPAY_KEY_SECRET: 'fixture', RAZORPAYX_KEY_ID: 'rzp_test_payouts', RAZORPAYX_KEY_SECRET: 'fixture', RAZORPAYX_ACCOUNT_NUMBER: 'test-account', DOCTOR_BANK_PAYOUTS_ENABLED: 'true' }); });
  afterEach(() => { sinon.restore(); for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); });
  it('rejects live credentials in test mode and test credentials in live mode', () => {
    expect(() => requireGatewayEnvironment('rzp_live_account', 'secret')).to.throw('test');
    expect(() => requireRecordEnvironment({ mode: 'real' })).to.throw('another environment');
    process.env.PAYMENTS_MODE = 'live';
    expect(() => requireGatewayEnvironment('rzp_test_account', 'secret')).to.throw('live');
    expect(() => requireRecordEnvironment({ mode: 'test' })).to.throw('another environment');
    expect(paymentMode()).to.equal('live');
  });
  it('never replays an order under another merchant account', () => {
    expect(() => requireRecordEnvironment({ mode: 'test', gatewayKeyId: 'rzp_test_other' })).to.throw('another Razorpay account');
  });
  it('removes local dummy payments even when the old feature flag is enabled', async () => {
    process.env.DEMO_APPOINTMENT_PAYMENTS = 'true';
    const res = response();
    await payAppointmentInternally({ user: { role: 'user' }, body: { mode: 'demo', method: 'upi' } }, res);
    expect(res.code).to.equal(403);
    expect(res.body.message).to.include('removed');
  });
  it('does not spend existing wallet money on test appointments', async () => {
    const res = response();
    await payAppointmentInternally({ user: { role: 'user' }, body: { method: 'wallet' } }, res);
    expect(res.code).to.equal(409);
    const choices = publicPaymentSettings({ consultationCurrency: 'INR', acceptedPaymentMethods: ['credit_card', 'upi'] }, null);
    expect(choices.methods).to.deep.equal(['credit_card', 'upi']);
  });
  it('excludes old dummy and live balances from test earnings, then excludes tests from live earnings', async () => {
    const row = mode => ({ _id: mode, mode, amount: 50000, platformFee: 10000, appointmentId: { _id: 'appointment', status: 'completed' }, method: 'upi' });
    sinon.stub(Payment, 'find').returns({ populate() { return this; }, sort() { return this; }, lean: async () => [row('demo'), row('test'), row('real')] });
    sinon.stub(Settings, 'findOne').returns({ select: async () => ({ bankAccount: bank }) });
    for (const mode of ['test', 'live']) {
      process.env.PAYMENTS_MODE = mode;
      const res = response();
      await getDoctorWallet({ user: { _id: 'doctor', role: 'doctor' } }, res);
      expect(res.body.transactions.map(row => row.id)).to.deep.equal([mode === 'test' ? 'test' : 'real']);
      expect(res.body.summary.available).to.equal(400);
      expect(res.body.mode).to.equal(mode);
    }
  });
  it('test beneficiary setup cannot run in live mode or from a patient account', async () => {
    const gateway = sinon.spy(settlementGateway, 'request');
    for (const [mode, role] of [['live', 'doctor'], ['test', 'user']]) {
      process.env.PAYMENTS_MODE = mode;
      const res = response();
      await setupDoctorTestBank({ user: { _id: 'doctor', role } }, res);
      expect(res.code).to.equal(403);
    }
    expect(gateway.called).to.equal(false);
  });
  it('creates a RazorpayX test beneficiary once and keeps it separate from live bank approval', async () => {
    sinon.stub(appointmentPaymentRepository, 'connection').resolves({ query: async () => [[{ acquired: 1 }]], release() {} });
    const saved = { bankAccount: bank, payoutFundAccountId: 'fa_live' };
    sinon.stub(Settings, 'findOne').returns({ select: async () => saved });
    sinon.stub(User, 'findById').resolves({ email: 'doctor@example.invalid' });
    sinon.stub(Settings, 'updateOne').callsFake(async (_filter, update) => { Object.assign(saved, update.$set); });
    const gateway = sinon.stub(settlementGateway, 'request');
    gateway.onFirstCall().resolves({ id: 'cont_test' });
    gateway.onSecondCall().resolves({ id: 'fa_test', account_type: 'bank_account', active: true });
    for (let i = 0; i < 2; i++) {
      const res = response();
      await setupDoctorTestBank({ user: { _id: 'doctor', role: 'doctor' } }, res);
      expect(res.body.success).to.equal(true);
    }
    expect(gateway.callCount).to.equal(2);
    expect(saved.payoutFundAccountId).to.equal('fa_live');
    expect(saved.payoutTestFundAccountId).to.equal('fa_test');
    expect(saved.payoutTestBankFingerprint).to.equal(bankFingerprint(bank));
  });
});
