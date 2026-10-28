import { expect } from 'chai';
import sinon from 'sinon';
import { commissionSnapshot, summarizeEarnings, payAppointmentInternally } from '../src/controllers/doctorWalletController.js';
import Appointment from '../src/models/appointmentModel.js';
import AppointmentPayment from '../src/models/appointmentPaymentModel.js';
import User from '../src/models/userModel.js';
import Transaction from '../src/models/transactionModel.js';
import { appointmentPaymentRepository } from '../src/services/appointmentPaymentService.js';

describe('Doctor appointment earnings wallet', () => {
  let savedMode;
  beforeEach(() => { savedMode = process.env.PAYMENTS_MODE; process.env.PAYMENTS_MODE = 'live'; });
  afterEach(() => { if (savedMode === undefined) delete process.env.PAYMENTS_MODE; else process.env.PAYMENTS_MODE = savedMode; });
  afterEach(() => sinon.restore());
  it('keeps pending, available, held and bank settlement amounts separate', () => {
    const records = ['pending', 'completed', 'canceled', 'completed'].map((status, i) => ({ _id: String(i), amount: 50000, platformFee: 5000, appointmentId: { _id: 'appointment', status }, settlementStatus: i === 3 ? 'completed' : 'pending_provider_settlement' }));
    const result = summarizeEarnings(records);
    expect(result.summary).to.deep.equal({ pending: 450, available: 450, held: 450, settled: 450, platformFees: 100, processing: 0 });
    expect(result.transactions[0].gross).to.equal(500);
  });
  it('deducts the agreed 20 percent once and handles paise rounding', () => {
    expect(commissionSnapshot(50000)).to.deep.equal({ platformFee: 10000, platformFeePercent: 20 });
    expect(commissionSnapshot(10001).platformFee).to.equal(2000);
    expect(() => commissionSnapshot(NaN)).to.throw();
    const record = { _id: 'payment', amount: 50000, ...commissionSnapshot(50000), appointmentId: { _id: 'appointment', status: 'completed' } };
    expect(summarizeEarnings([record]).summary.available).to.equal(400);
    expect(summarizeEarnings([record]).summary.platformFees).to.equal(100);
    expect(summarizeEarnings([record]).summary.available).to.equal(400);
    expect(summarizeEarnings([{ ...record, settlementStatus: 'processing' }]).summary).to.include({ available: 0, processing: 400 });
  });
  for (const paid of [false, true]) it(paid ? 'does not debit a paid appointment again' : 'recovers an already applied debit without double charging', async () => {
    sinon.stub(appointmentPaymentRepository, 'connection').resolves({ query: async () => [[{ acquired: 1 }]], release() {} });
    sinon.stub(Appointment, 'findOne').resolves({ _id: 'appointment', status: 'pending' });
    sinon.stub(AppointmentPayment, 'findOne').resolves({ _id: 'entry', amount: 50000, method: 'wallet', mode: 'real', status: paid ? 'paid' : 'pending', providerId: 'doctor', paymentId: 'wallet_ref' });
    const debit = sinon.stub(User, 'updateOne').resolves({ modifiedCount: 0 });
    sinon.stub(Transaction, 'findOneAndUpdate').resolves({});
    sinon.stub(User, 'exists').resolves({ _id: 'patient' });
    sinon.stub(AppointmentPayment, 'updateOne').resolves({ modifiedCount: 1 });
    sinon.stub(Appointment, 'updateOne').resolves({ modifiedCount: 1 });
    const res = { json: sinon.spy(), status: sinon.stub().returnsThis() };
    await payAppointmentInternally({ user: { _id: 'patient', role: 'user' }, params: { appointmentId: 'appointment' }, body: {} }, res);
    expect(res.json.firstCall.args[0].paid).to.equal(true);
    expect(debit.callCount).to.equal(paid ? 0 : 1);
    if (!paid) expect(debit.firstCall.args[0].appointmentWalletDebitIds).to.deep.equal({ $ne: 'entry' });
  });
});
