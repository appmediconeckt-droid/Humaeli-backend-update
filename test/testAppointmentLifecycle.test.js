import { expect } from 'chai';
import sinon from 'sinon';
import crypto from 'node:crypto';
import { Clinic } from '../src/models/clinicModels.js';
import Appointment from '../src/models/appointmentModel.js';
import Payment from '../src/models/appointmentPaymentModel.js';
import Settings from '../src/models/providerPaymentSettingsModel.js';
import User from '../src/models/userModel.js';
import { createAppointmentPaymentOrder, verifyAppointmentPayment } from '../src/controllers/appointmentPaymentController.js';
import { getDoctorWallet } from '../src/controllers/doctorWalletController.js';
import { requestDoctorSettlement } from '../src/controllers/doctorSettlementController.js';
import { appointmentGateway, appointmentPaymentRepository } from '../src/services/appointmentPaymentService.js';
import { bankFingerprint, settlementGateway } from '../src/services/doctorSettlementService.js';

const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
describe('Razorpay test appointment lifecycle (isolated provider APIs and persistence)', () => {
  it('verifies a payment, separates pending/available, and settles exactly 80% once', async () => {
    const env = { ...process.env };
    try {
      Object.assign(process.env, { PAYMENTS_MODE: 'test', RAZORPAY_KEY_ID: 'rzp_test_fixture', RAZORPAY_KEY_SECRET: 'fixture', RAZORPAYX_KEY_ID: 'rzp_test_payout', RAZORPAYX_KEY_SECRET: 'fixture', RAZORPAYX_ACCOUNT_NUMBER: 'test-source', DOCTOR_BANK_PAYOUTS_ENABLED: 'true' });
      const appointment = { _id: 'appointment', patient: 'patient', counselor: 'doctor', status: 'confirmed', consultation_mode: 'video', clinic_id: 'clinic' };
      const bank = { accountHolder: 'Test Doctor', accountNumber: '1234567890', ifscCode: 'HDFC0000053' };
      const settings = { methods: ['debit_card'], bankAccount: bank, payoutTestFundAccountId: 'fa_test', payoutTestBankFingerprint: bankFingerprint(bank), payoutTestKeyId: process.env.RAZORPAYX_KEY_ID };
      let record;
      sinon.stub(appointmentPaymentRepository, 'connection').resolves({ query: async () => [[{ acquired: 1 }]], release() {} });
      sinon.stub(Clinic, 'findById').callsFake(() => ({ _id: 'clinic', doctor_id: 'doctor', fee: 500, videoConsultationAdditionalFee: 125, select() { return { lean: async () => ({ clinic_name: 'Test Clinic' }) }; } }));
      sinon.stub(Appointment, 'findOne').resolves(appointment);
      sinon.stub(Appointment, 'findById').resolves(appointment);
      sinon.stub(Appointment, 'updateOne').callsFake(async (filter, update) => {
        if (typeof filter.status === 'string' && filter.status !== appointment.status) return { matchedCount: 0, modifiedCount: 0 };
        Object.assign(appointment, update.$set);
        return { matchedCount: 1, modifiedCount: 0 };
      });
      sinon.stub(User, 'findById').resolves({ _id: 'doctor', role: 'doctor', isActive: true, consultationFee: 500, consultationCurrency: 'INR' });
      sinon.stub(Settings, 'findOne').returns({ lean: async () => settings, select: async () => settings });
      sinon.stub(Payment, 'findOne').callsFake(filter => filter.providerId ? { select: async () => record } : Promise.resolve(record));
      sinon.stub(Payment, 'findById').callsFake(async () => record);
      sinon.stub(Payment, 'create').callsFake(async fields => (record = { ...fields, _id: 'payment', status: 'pending', toObject() { return { ...this }; } }));
      sinon.stub(Payment, 'updateOne').callsFake(async (_filter, update) => { Object.assign(record, update.$set); });
      sinon.stub(Payment, 'find').returns({ populate() { return this; }, sort() { return this; }, lean: async () => record ? [{ ...record, appointmentId: appointment, userId: { fullName: 'Test Patient' } }] : [] });
      const orders = sinon.stub(appointmentGateway.orders, 'create').resolves({ id: 'order_test' });
      const captured = { id: 'pay_test', order_id: 'order_test', amount: 62500, currency: 'INR', method: 'card', card: { type: 'debit' }, status: 'captured' };
      sinon.stub(appointmentGateway.payments, 'fetch').resolves(captured);
      const patientRequest = { user: { _id: 'patient', role: 'user' }, params: { appointmentId: 'appointment' } };
      const doctorRequest = { user: { _id: 'doctor', role: 'doctor' }, params: { paymentId: 'payment' }, body: {} };
      const order = response();
      await createAppointmentPaymentOrder({ ...patientRequest, body: { method: 'debit_card', amount: 1 } }, order);
      expect(order.body.mode).to.equal('test');
      expect(record.mode).to.equal('test');
      expect(record.amount).to.equal(62500);
      expect(record.platformFee).to.equal(12500);
      const signature = crypto.createHmac('sha256', 'fixture').update('order_test|pay_test').digest('hex');
      for (let i = 0; i < 2; i++) {
        const verified = response();
        await verifyAppointmentPayment({ ...patientRequest, body: { razorpay_order_id: 'order_test', razorpay_payment_id: 'pay_test', razorpay_signature: signature } }, verified);
        expect(verified.body.paid).to.equal(true);
      }
      const pending = response(); await getDoctorWallet(doctorRequest, pending);
      expect(pending.body.summary).to.include({ pending: 500, available: 0 });
      appointment.status = 'completed';
      const available = response(); await getDoctorWallet(doctorRequest, available);
      expect(available.body.summary).to.include({ pending: 0, available: 500, platformFees: 125 });
      let payoutState = 'processing';
      const bankApi = sinon.stub(settlementGateway, 'request').callsFake(async () => ({ id: 'pout_test', ...record.payoutPayload, status: payoutState }));
      const payout = response(); await requestDoctorSettlement(doctorRequest, payout);
      expect(payout.body.settlementStatus).to.equal('processing');
      expect(record.payoutPayload.amount).to.equal(50000);
      const processing = response(); await getDoctorWallet(doctorRequest, processing);
      expect(processing.body.summary).to.include({ available: 0, processing: 500 });
      payoutState = 'processed';
      const checked = response(); await requestDoctorSettlement({ ...doctorRequest, body: { checkOnly: true } }, checked);
      expect(checked.body.settlementStatus).to.equal('completed');
      const settled = response(); await getDoctorWallet(doctorRequest, settled);
      expect(settled.body.summary).to.include({ available: 0, processing: 0, settled: 500, platformFees: 125 });
      expect(orders.calledOnce).to.equal(true);
      expect(bankApi.getCalls().filter(call => call.args[0] === 'payouts').length).to.equal(1);
      expect(bankApi.secondCall.args[0]).to.equal('payouts/pout_test');
    } finally {
      sinon.restore();
      for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
      Object.assign(process.env, env);
    }
  });
});
