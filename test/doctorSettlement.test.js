import { expect } from 'chai';
import sinon from 'sinon';
import Appointment from '../src/models/appointmentModel.js';
import Payment from '../src/models/appointmentPaymentModel.js';
import Settings from '../src/models/providerPaymentSettingsModel.js';
import { appointmentPaymentRepository } from '../src/services/appointmentPaymentService.js';
import { bankFingerprint, settleDoctorPayment, settlementGateway, validatedPayoutState } from '../src/services/doctorSettlementService.js';

describe('Doctor bank settlement', () => {
  let record, gateway, updates, savedEnv;
  const bank = { accountNumber: '1234567890', ifscCode: 'ABCD0123456', accountHolder: 'Doctor' };
  beforeEach(() => {
    savedEnv = { ...process.env };
    Object.assign(process.env, { DOCTOR_BANK_PAYOUTS_ENABLED: 'true', PAYMENTS_MODE: 'test', RAZORPAYX_KEY_ID: 'rzp_test_payout', RAZORPAYX_KEY_SECRET: 'test', RAZORPAYX_ACCOUNT_NUMBER: 'platform' });
    record = { _id: 'payment', appointmentId: 'appointment', providerId: 'doctor', amount: 50000, platformFee: 10000, mode: 'test', status: 'paid', settlementStatus: 'pending_provider_settlement', toObject() { return { ...this }; } };
    sinon.stub(appointmentPaymentRepository, 'connection').resolves({ query: async () => [[{ acquired: 1 }]], release() {} });
    sinon.stub(Payment, 'findOne').callsFake(() => ({ select: async () => record }));
    updates = sinon.stub(Payment, 'updateOne').callsFake(async (_filter, update) => { Object.assign(record, update.$set); return { modifiedCount: 1 }; });
    sinon.stub(Appointment, 'findById').resolves({ status: 'completed' });
    sinon.stub(Settings, 'findOne').returns({ select: async () => ({ bankAccount: bank, payoutTestKeyId: 'rzp_test_payout', payoutTestFundAccountId: 'fa_doctor', payoutTestBankFingerprint: bankFingerprint(bank) }) });
    gateway = sinon.stub(settlementGateway, 'request').callsFake(async (_path, payload) => ({ id: 'pout_one', amount: payload.amount, currency: 'INR', fund_account_id: payload.fund_account_id, reference_id: payload.reference_id, status: 'processing' }));
  });
  afterEach(() => { sinon.restore(); for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]; Object.assign(process.env, savedEnv); });
  it('reserves only the 80 percent share before calling the bank', async () => {
    await settleDoctorPayment('payment', 'doctor');
    expect(record.payoutPayload.amount).to.equal(40000);
    expect(record.settlementStatus).to.equal('processing');
    expect(updates.calledBefore(gateway)).to.equal(true);
    expect(gateway.firstCall.args[2]).to.equal(record.payoutKey);
  });
  it('preserves the exact idempotency key and payload across an uncertain timeout', async () => {
    gateway.onFirstCall().rejects(new Error('timeout'));
    try { await settleDoctorPayment('payment', 'doctor'); } catch { /* Retry with persisted request. */ }
    const key = record.payoutKey;
    expect(record.settlementStatus).to.equal('processing');
    await settleDoctorPayment('payment', 'doctor', true);
    expect(gateway.secondCall.args[2]).to.equal(key);
    expect(gateway.secondCall.args[1]).to.deep.equal(gateway.firstCall.args[1]);
  });
  it('only confirms completion after checking provider amount, beneficiary and reference', async () => {
    await settleDoctorPayment('payment', 'doctor');
    const result = { id: 'pout_one', amount: 40000, currency: 'INR', fund_account_id: 'fa_doctor', reference_id: 'payment', status: 'processed', utr: 'bank-reference' };
    gateway.resolves(result);
    expect((await settleDoctorPayment('payment', 'doctor', true)).settlementStatus).to.equal('completed');
    expect(record.payoutUtr).to.equal('bank-reference');
    expect(() => validatedPayoutState(record, { ...result, amount: 50000 })).to.throw('mismatch');
    expect(validatedPayoutState(record, { ...result, status: 'reversed' }).settlementStatus).to.equal('failed');
  });
  it('blocks demo payouts and payouts before appointment completion', async () => {
    record.mode = 'demo';
    try { await settleDoctorPayment('payment', 'doctor'); expect.fail('should reject demo'); } catch (error) { expect(error.statusCode).to.equal(400); }
    record.mode = 'test';
    Appointment.findById.resolves({ status: 'pending' });
    try { await settleDoctorPayment('payment', 'doctor'); expect.fail('should reject pending'); } catch (error) { expect(error.statusCode).to.equal(409); }
    expect(gateway.called).to.equal(false);
  });
  it('requires bank reverification after account details change', async () => {
    Settings.findOne.returns({ select: async () => ({ bankAccount: { ...bank, accountNumber: 'changed' }, payoutTestKeyId: 'rzp_test_payout', payoutTestFundAccountId: 'fa_doctor', payoutTestBankFingerprint: bankFingerprint(bank) }) });
    try { await settleDoctorPayment('payment', 'doctor'); expect.fail('should reject changed bank'); } catch (error) { expect(error.statusCode).to.equal(409); }
    expect(gateway.called).to.equal(false);
  });
  it('never pays test earnings through live credentials after a mode switch', async () => {
    process.env.PAYMENTS_MODE = 'live';
    try { await settleDoctorPayment('payment', 'doctor'); expect.fail('cross-mode payout'); }
    catch (error) { expect(error.statusCode).to.equal(409); }
    expect(gateway.called).to.equal(false);
  });
  it('keeps an uncertain payout tied to its original RazorpayX account', async () => {
    await settleDoctorPayment('payment', 'doctor');
    process.env.RAZORPAYX_KEY_ID = 'rzp_test_other';
    try { await settleDoctorPayment('payment', 'doctor', true); expect.fail('cross-account payout'); }
    catch (error) { expect(error.statusCode).to.equal(409); }
    expect(gateway.callCount).to.equal(1);
  });
});
