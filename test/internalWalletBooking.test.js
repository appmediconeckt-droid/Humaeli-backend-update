import { expect } from 'chai';
import sinon from 'sinon';
import Appointment from '../src/models/appointmentModel.js';
import Payment from '../src/models/appointmentPaymentModel.js';
import User from '../src/models/userModel.js';
import Transaction from '../src/models/transactionModel.js';
import { payAppointmentInternally } from '../src/controllers/doctorWalletController.js';
import { appointmentGateway, appointmentPaymentRepository } from '../src/services/appointmentPaymentService.js';

const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
describe('Internal wallet appointment payments', () => {
  let env;
  beforeEach(() => {
    env = { ...process.env };
    delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
    sinon.stub(appointmentPaymentRepository, 'connection').resolves({ query: async () => [[{ acquired: 1 }]], release() {} });
  });
  afterEach(() => {
    sinon.restore();
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  });
  for (const mode of ['test', 'live']) it(`debits once and books without gateway credentials in ${mode} mode`, async () => {
    process.env.PAYMENTS_MODE = mode;
    let balance = 600, debited = false, record;
    const appointment = { _id: 'appointment', patient: 'patient', counselor: 'doctor', status: 'awaiting_payment' };
    sinon.stub(Appointment, 'findOne').resolves(appointment);
    sinon.stub(User, 'findById').resolves({ _id: 'doctor', isActive: true, consultationFee: 500, consultationCurrency: 'INR' });
    sinon.stub(Payment, 'findOne').callsFake(async () => record);
    sinon.stub(Payment, 'create').callsFake(async fields => (record = { ...fields, _id: 'ledger', status: 'pending' }));
    const debit = sinon.stub(User, 'updateOne').callsFake(async (filter, update) => {
      expect(filter.walletBalance.$gte).to.equal(500);
      expect(filter.appointmentWalletDebitIds.$ne).to.equal('ledger');
      if (debited || balance < 500) return { modifiedCount: 0 };
      balance += update.$inc.walletBalance; debited = true;
      return { modifiedCount: 1 };
    });
    sinon.stub(Transaction, 'findOneAndUpdate').resolves({});
    sinon.stub(Payment, 'updateOne').callsFake(async (_filter, update) => { Object.assign(record, update.$set); return { matchedCount: 1 }; });
    sinon.stub(Appointment, 'updateOne').callsFake(async (filter, update) => {
      if (typeof filter.status === 'string' && appointment.status !== filter.status) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(appointment, update.$set); return { matchedCount: 1, modifiedCount: 0 };
    });
    const gateway = sinon.spy(appointmentGateway.orders, 'create');
    for (let i = 0; i < 2; i++) {
      const res = response();
      await payAppointmentInternally({ user: { _id: 'patient', role: 'user' }, params: { appointmentId: 'appointment' }, body: { method: 'wallet' } }, res);
      expect(res.body).to.include({ paid: true, mode: 'live', amount: 500 });
    }
    expect(balance).to.equal(100);
    expect(debit.calledOnce).to.equal(true);
    expect(record.mode).to.equal('real');
    expect(appointment).to.include({ status: 'pending', queue_status: 'booked', payment_status: 'paid', payment_method: 'wallet' });
    expect(gateway.called).to.equal(false);
  });
  it('insufficient balance does not confirm a booking or record a successful payment', async () => {
    process.env.PAYMENTS_MODE = 'test';
    sinon.stub(Appointment, 'findOne').resolves({ _id: 'appointment', status: 'awaiting_payment' });
    sinon.stub(Payment, 'findOne').resolves({ _id: 'ledger', amount: 50000, method: 'wallet', mode: 'real', status: 'pending' });
    sinon.stub(User, 'updateOne').resolves({ modifiedCount: 0 });
    sinon.stub(User, 'exists').resolves(null);
    const booking = sinon.spy(Appointment, 'updateOne');
    const ledger = sinon.spy(Payment, 'updateOne');
    const transaction = sinon.spy(Transaction, 'findOneAndUpdate');
    const res = response();
    await payAppointmentInternally({ user: { _id: 'patient', role: 'user' }, params: { appointmentId: 'appointment' }, body: { method: 'wallet' } }, res);
    expect(res.code).to.equal(409);
    expect(res.body.message).to.include('Insufficient wallet balance');
    expect(booking.called || ledger.called || transaction.called).to.equal(false);
  });
});
