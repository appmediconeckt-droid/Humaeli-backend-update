import { expect } from 'chai';
import sinon from 'sinon';
import crypto from 'node:crypto';
import User from '../src/models/userModel.js';
import { Clinic } from '../src/models/clinicModels.js';
import Appointment from '../src/models/appointmentModel.js';
import AppointmentPayment from '../src/models/appointmentPaymentModel.js';
import ProviderPaymentSettings from '../src/models/providerPaymentSettingsModel.js';
import { validateProviderPaymentSettings, publicPaymentSettings, expandPaymentMethods } from '../src/services/providerPaymentSettingsService.js';
import { getOwnPaymentSettings, saveOwnPaymentSettings, getProviderPaymentMethods } from '../src/controllers/providerPaymentSettingsController.js';
import { paymentCheckoutDisplay } from '../../chatbot-frontend/src/utils/paymentCheckoutConfig.js';
import { clearGatewayMethodsCache, gatewayMethodsRepository } from '../src/services/gatewayPaymentMethodsService.js';
import { createAppointmentPaymentOrder, verifyAppointmentPayment } from '../src/controllers/appointmentPaymentController.js';
import { appointmentGateway, appointmentPaymentRepository, completeAppointmentPayment, validateCapturedAppointmentPayment } from '../src/services/appointmentPaymentService.js';

const bankAccount = { accountHolder: 'Test Provider', bankName: 'Test Bank', accountNumber: '001234567890', ifscCode: 'TEST0123456' };
const response = () => ({ status: sinon.stub().returnsThis(), json: sinon.spy() });
const settings = { methods: ['credit_card', 'debit_card', 'upi', 'cash'], bankAccount, upiId: 'provider@testbank' };

describe('Provider payment settings', () => {
  let savedMode;
  beforeEach(() => { savedMode = process.env.PAYMENTS_MODE; process.env.PAYMENTS_MODE = 'live'; });
  afterEach(() => { if (savedMode === undefined) delete process.env.PAYMENTS_MODE; else process.env.PAYMENTS_MODE = savedMode; });
  afterEach(() => sinon.restore());
  it('allows selecting card methods before receiving bank details are added', () => {
    for (const method of ['credit_card', 'debit_card']) {
      expect(validateProviderPaymentSettings({ methods: [method] }).methods).to.deep.equal([method]);
      expect(validateProviderPaymentSettings({ methods: [method], bankAccount }).bankAccount.accountNumber).to.equal('001234567890');
    }
  });
  for (const role of ['doctor', 'counsellor']) {
    it(`saves and reloads private receiving details for the authenticated ${role}`, async () => {
      sinon.stub(User, 'findById').resolves({ _id: 'owner', role });
      sinon.stub(ProviderPaymentSettings, 'findOne').returns({ lean: async () => settings });
      const write = sinon.stub(ProviderPaymentSettings, 'findOneAndUpdate').resolves(settings);
      const methods = sinon.stub(User, 'updateOne').resolves({ matchedCount: 1 });
      const res = response();
      await saveOwnPaymentSettings({ userId: 'owner', body: { ...settings, providerId: 'someone-else' } }, res);
      expect(write.firstCall.args[0]).to.deep.equal({ providerId: 'owner' });
      expect(write.firstCall.args[1].$set.bankAccount).to.deep.equal(bankAccount);
      expect(methods.firstCall.args[0]).to.deep.equal({ _id: 'owner' });
      const reload = response();
      await getOwnPaymentSettings({ userId: 'owner' }, reload);
      expect(reload.json.firstCall.args[0].bankAccount).to.deep.equal(bankAccount);
      expect(reload.json.firstCall.args[0].methods).to.deep.equal(settings.methods);
    });
  }
  it('shows only the selected card type or UPI in hosted checkout', () => {
    for (const [method, type] of [['credit_card', 'credit'], ['debit_card', 'debit']]) {
      const config = paymentCheckoutDisplay(method).display;
      expect(config.blocks.chosen.instruments).to.deep.equal([{ method: 'card', types: [type] }]);
      expect(config.preferences.show_default_blocks).to.equal(false);
    }
    expect(paymentCheckoutDisplay('upi').display.sequence).to.deep.equal(['upi']);
    expect(() => paymentCheckoutDisplay('bank_transfer')).to.throw();
  });
  it('accepts a UPI-only configuration without bank details', () => {
    expect(validateProviderPaymentSettings({ methods: ['upi'], upiId: 'provider@testbank' }).methods).to.deep.equal(['upi']);
    expect(() => validateProviderPaymentSettings({ methods: ['upi'], upiId: 'invalid' })).to.throw('UPI ID');
  });
  it('saves method selections without erasing existing receiving details', async () => {
    sinon.stub(User, 'findById').resolves({ _id: 'owner', role: 'doctor' });
    sinon.stub(ProviderPaymentSettings, 'findOne').returns({ lean: async () => ({ ...settings, upiApp: 'phonepe' }) });
    const write = sinon.stub(ProviderPaymentSettings, 'findOneAndUpdate').resolves(settings);
    sinon.stub(User, 'updateOne').resolves({ matchedCount: 1 });
    const res = response();
    await saveOwnPaymentSettings({ userId: 'owner', body: { methods: ['cash', 'upi'] } }, res);
    expect(res.json.firstCall.args[0].success).to.equal(true);
    expect(write.firstCall.args[1].$set).to.deep.include({ bankAccount, upiId: settings.upiId, upiApp: 'phonepe' });
    expect(write.firstCall.args[1].$set.methods).to.deep.equal(['cash', 'upi']);
  });
  it('supports selecting UPI before its receiving ID is added', () => {
    const selected = validateProviderPaymentSettings({ methods: ['upi'] });
    expect(selected.methods).to.deep.equal(['upi']);
    expect(publicPaymentSettings({ consultationCurrency: 'INR' }, selected).unavailableMethods.upi).to.include('setup');
  });
  it('validates bank details independently of the selected methods', () => {
    expect(validateProviderPaymentSettings({ methods: ['cash'], bankAccount }).bankAccount).to.deep.equal(bankAccount);
    expect(() => validateProviderPaymentSettings({ methods: ['cash'], bankAccount: { accountHolder: 'Incomplete' } })).to.throw('account holder');
  });
  it('saves supported UPI app preferences and rejects unknown apps', () => {
    for (const upiApp of ['phonepe', 'google_pay', 'paytm', 'bhim', 'other']) {
      expect(validateProviderPaymentSettings({ methods: ['upi'], upiId: 'provider@testbank', upiApp }).upiApp).to.equal(upiApp);
    }
    expect(() => validateProviderPaymentSettings({ methods: ['upi'], upiId: 'provider@testbank', upiApp: 'unknown' })).to.throw('valid UPI app');
  });
  it('reloads the selected UPI app for the owning provider', async () => {
    sinon.stub(User, 'findById').resolves({ _id: 'owner', role: 'doctor' });
    sinon.stub(ProviderPaymentSettings, 'findOne').returns({ lean: async () => ({ ...settings, upiApp: 'phonepe' }) });
    const res = response();
    await getOwnPaymentSettings({ userId: 'owner' }, res);
    expect(res.json.firstCall.args[0].upiApp).to.equal('phonepe');
  });
  it('rejects invalid account numbers, IFSC and unknown methods', () => {
    for (const invalid of [{ ...bankAccount, accountNumber: 'abc' }, { ...bankAccount, ifscCode: 'INVALID' }]) {
      expect(() => validateProviderPaymentSettings({ methods: ['credit_card'], bankAccount: invalid })).to.throw();
    }
    expect(() => validateProviderPaymentSettings({ methods: ['bank_transfer'] })).to.throw();
  });
  it('expands legacy card settings while exposing no private bank details', () => {
    expect(expandPaymentMethods(['online', 'upi'])).to.deep.equal(['credit_card', 'debit_card', 'upi']);
    const visible = publicPaymentSettings({ consultationFee: 500, consultationCurrency: 'INR' }, settings);
    expect(visible).to.have.keys('methods', 'configuredMethods', 'unavailableMethods', 'consultationFee', 'currency');
    expect(visible.methods).to.include('credit_card').and.include('debit_card').and.include('upi');
    expect(publicPaymentSettings({ acceptedPaymentMethods: ['online', 'upi', 'cash'] }, null).methods).to.deep.equal(['cash', 'wallet']);
  });
  it('keeps Wallet available for live INR appointments even when every optional payment method is disabled', () => {
    const visible = publicPaymentSettings({ consultationCurrency: 'INR' }, { methods: [] });
    expect(visible.methods).to.deep.equal(['wallet']);
    expect(visible.configuredMethods).to.deep.equal(['wallet']);
    expect(visible.unavailableMethods).not.to.have.property('wallet');
    expect(publicPaymentSettings({ consultationCurrency: 'EUR' }, { methods: [] }).configuredMethods).not.to.include('wallet');
  });
  it('does not allow patients to read private provider bank details', async () => {
    sinon.stub(User, 'findById').resolves({ role: 'user' });
    const read = sinon.spy(ProviderPaymentSettings, 'findOne');
    const res = response();
    await getOwnPaymentSettings({ userId: 'patient' }, res);
    expect(res.status.firstCall.args[0]).to.equal(403);
    expect(read.called).to.equal(false);
  });
  it('keeps the saved card and UPI methods visible for EUR with an availability reason', () => {
    const visible = publicPaymentSettings({ consultationCurrency: 'EUR' }, settings);
    expect(visible.configuredMethods).to.deep.equal(settings.methods);
    expect(visible.methods).to.deep.equal(['cash']);
    for (const method of ['credit_card', 'debit_card', 'upi']) expect(visible.unavailableMethods[method]).to.include('EUR');
    expect(visible).not.to.have.property('bankAccount');
    expect(visible).not.to.have.property('upiId');
  });
  it('shows incomplete legacy payment methods with reasons while keeping them unavailable for checkout', () => {
    const visible = publicPaymentSettings({ consultationCurrency: 'INR', acceptedPaymentMethods: ['online', 'upi', 'cash'] }, null);
    expect(visible.configuredMethods).to.deep.equal(['credit_card', 'debit_card', 'upi', 'cash', 'wallet']);
    expect(visible.methods).to.deep.equal(['cash', 'wallet']);
    expect(visible.unavailableMethods.credit_card).to.include('setup');
    expect(visible.unavailableMethods.upi).to.include('setup');
  });
  it('returns payment choices without bank details to the patient', async () => {
    clearGatewayMethodsCache();
    sinon.stub(gatewayMethodsRepository, 'fetch').resolves({ entity: 'methods', upi: true });
    sinon.stub(User, 'findOne').resolves({ _id: 'provider', role: 'doctor', consultationFee: 500, consultationCurrency: 'INR' });
    sinon.stub(ProviderPaymentSettings, 'findOne').returns({ lean: async () => settings });
    const res = response();
    await getProviderPaymentMethods({ params: { providerId: 'provider' } }, res);
    expect(res.json.firstCall.args[0]).not.to.have.property('bankAccount');
    expect(res.json.firstCall.args[0]).not.to.have.property('upiId');
  });
});

describe('Appointment card and UPI payments', () => {
  let savedEnv;
  const record = { _id: 'payment', appointmentId: 'appointment', userId: 'patient', providerId: 'provider', orderId: 'order_test', method: 'credit_card', mode: 'test', amount: 50000, currency: 'INR', status: 'pending' };
  const captured = { id: 'pay_test', order_id: 'order_test', amount: 50000, currency: 'INR', status: 'captured', method: 'card', card: { type: 'credit' } };
  beforeEach(() => {
    savedEnv = [process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET, process.env.PAYMENTS_MODE];
    process.env.PAYMENTS_MODE = 'test';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_fixture'; process.env.RAZORPAY_KEY_SECRET = 'fixture-secret';
    sinon.stub(appointmentPaymentRepository, 'connection').resolves({ query: async () => [[{ acquired: 1 }]], release: sinon.spy() });
  });
  afterEach(() => {
    sinon.restore();
    ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'PAYMENTS_MODE'].forEach((key, index) => {
      if (savedEnv[index] === undefined) delete process.env[key]; else process.env[key] = savedEnv[index];
    });
  });
  it('charges the server fee rather than an amount supplied by the patient', async () => {
    const ownership = sinon.stub(Appointment, 'findOne').resolves({ _id: 'appointment', counselor: 'provider', status: 'confirmed' });
    sinon.stub(AppointmentPayment, 'findOne').resolves(null);
    sinon.stub(User, 'findById').resolves({ _id: 'provider', isActive: true, consultationFee: 500, consultationCurrency: 'INR' });
    sinon.stub(ProviderPaymentSettings, 'findOne').returns({ lean: async () => settings });
    const create = sinon.stub(appointmentGateway.orders, 'create').resolves({ id: 'order_test' });
    sinon.stub(AppointmentPayment, 'create').callsFake(async (data) => data);
    const res = response();
    await createAppointmentPaymentOrder({ user: { role: 'user', _id: 'patient' }, params: { appointmentId: 'appointment' }, body: { method: 'credit_card', amount: 1 } }, res);
    expect(ownership.firstCall.args[0]).to.deep.equal({ _id: 'appointment', patient: 'patient' });
    expect(create.firstCall.args[0].amount).to.equal(50000);
    expect(res.json.firstCall.args[0].method).to.equal('credit_card');
  });
  it('reuses the existing order on retry instead of creating a second charge', async () => {
    sinon.stub(Appointment, 'findOne').resolves({ _id: 'appointment', status: 'confirmed' });
    sinon.stub(AppointmentPayment, 'findOne').resolves(record);
    sinon.stub(appointmentGateway.orders, 'fetchPayments').resolves({ items: [] });
    const create = sinon.spy(appointmentGateway.orders, 'create');
    const res = response();
    await createAppointmentPaymentOrder({ user: { role: 'user', _id: 'patient' }, params: { appointmentId: 'appointment' }, body: { method: 'credit_card' } }, res);
    expect(create.called).to.equal(false);
    expect(res.json.firstCall.args[0].order_id).to.equal('order_test');
  });
  for (const [clinicFee, expected] of [[750, 76000], [null, 51000], [undefined, 51000], [0, 1000]]) {
    it(`uses clinic fee ${clinicFee} with profile fallback and video surcharge`, async () => {
      sinon.stub(Appointment, 'findOne').resolves({ _id: 'appointment', counselor: 'provider', clinic_id: 'clinic', status: 'confirmed', consultation_mode: 'video' });
      sinon.stub(Clinic, 'findById').resolves({ _id: 'clinic', doctor_id: 'provider', fee: clinicFee });
      sinon.stub(AppointmentPayment, 'findOne').resolves(null);
      sinon.stub(User, 'findById').resolves({ _id: 'provider', isActive: true, consultationFee: 500, consultationCurrency: 'INR' });
      sinon.stub(ProviderPaymentSettings, 'findOne').returns({ lean: async () => settings });
      const create = sinon.stub(appointmentGateway.orders, 'create').resolves({ id: 'order_test' });
      sinon.stub(AppointmentPayment, 'create').callsFake(async data => data);
      const res = response();
      await createAppointmentPaymentOrder({ user: { role: 'user', _id: 'patient' }, params: { appointmentId: 'appointment' }, body: { method: 'credit_card', amount: 1 } }, res);
      expect(create.firstCall.args[0].amount).to.equal(expected);
    });
  }
  it('rejects payment for another patient appointment', async () => {
    sinon.stub(Appointment, 'findOne').resolves(null);
    const create = sinon.spy(appointmentGateway.orders, 'create');
    const res = response();
    await createAppointmentPaymentOrder({ user: { role: 'user', _id: 'intruder' }, params: { appointmentId: 'appointment' }, body: { method: 'upi' } }, res);
    expect(res.status.firstCall.args[0]).to.equal(404); expect(create.called).to.equal(false);
  });
  it('rejects wrong card types, methods, amount, currency, order and uncaptured payments', async () => {
    for (const changes of [{ card: { type: 'debit' } }, { method: 'upi' }, { amount: 1 }, { currency: 'USD' }, { order_id: 'other' }, { status: 'authorized' }]) {
      let error;
      try { await validateCapturedAppointmentPayment(record, { ...captured, ...changes }); } catch (caught) { error = caught; }
      expect(error).to.be.an('error');
    }
  });
  it('accepts captured debit-card and UPI payments for their corresponding method', async () => {
    await validateCapturedAppointmentPayment({ ...record, method: 'debit_card' }, { ...captured, card: { type: 'debit' } });
    await validateCapturedAppointmentPayment({ ...record, method: 'upi' }, { ...captured, method: 'upi' });
  });
  it('records verified payment without crediting the user wallet', async () => {
    const write = sinon.stub(AppointmentPayment, 'updateOne').resolves({ matchedCount: 1 });
    const appointment = sinon.stub(Appointment, 'updateOne').resolves({ matchedCount: 1 });
    const wallet = sinon.spy(User, 'updateOne');
    const result = await completeAppointmentPayment(record, captured);
    expect(result.paid).to.equal(true); expect(write.calledOnce).to.equal(true);
    expect(appointment.firstCall.args[1].$set).to.include({ payment_status: 'paid', payment_amount: 500, payment_reference: 'pay_test' });
    expect(wallet.called).to.equal(false);
  });
  it('checks the callback signature before fetching or recording payment', async () => {
    sinon.stub(Appointment, 'findOne').resolves({ _id: 'appointment' });
    sinon.stub(AppointmentPayment, 'findOne').resolves(record);
    const fetch = sinon.spy(appointmentGateway.payments, 'fetch');
    const res = response();
    await verifyAppointmentPayment({ user: { role: 'user', _id: 'patient' }, params: { appointmentId: 'appointment' }, body: { razorpay_order_id: 'order_test', razorpay_payment_id: 'pay_test', razorpay_signature: '0'.repeat(64) } }, res);
    expect(res.status.firstCall.args[0]).to.equal(400); expect(fetch.called).to.equal(false);
  });
  it('verifies an authentic callback and captured payment', async () => {
    sinon.stub(Appointment, 'findOne').resolves({ _id: 'appointment' });
    sinon.stub(AppointmentPayment, 'findOne').resolves(record);
    sinon.stub(AppointmentPayment, 'findById').resolves(record);
    sinon.stub(appointmentGateway.payments, 'fetch').resolves(captured);
    sinon.stub(AppointmentPayment, 'updateOne').resolves({ matchedCount: 1 });
    sinon.stub(Appointment, 'updateOne').resolves({ matchedCount: 1 });
    const signature = crypto.createHmac('sha256', 'fixture-secret').update('order_test|pay_test').digest('hex');
    const res = response();
    await verifyAppointmentPayment({ user: { role: 'user', _id: 'patient' }, params: { appointmentId: 'appointment' }, body: { razorpay_order_id: 'order_test', razorpay_payment_id: 'pay_test', razorpay_signature: signature } }, res);
    expect(res.json.firstCall.args[0].paid).to.equal(true);
  });
});
