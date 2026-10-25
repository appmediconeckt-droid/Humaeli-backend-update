import { expect } from 'chai';
import sinon from 'sinon';
import crypto from 'node:crypto';
import Transaction from '../src/models/transactionModel.js';
import { createOrder, verifyPayment, getPaymentConfig, walletGateway } from '../src/controllers/walletController.js';

describe('Razorpay wallet checkout', () => {
  let res, previous;
  beforeEach(() => {
    previous = [process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET];
    process.env.RAZORPAY_KEY_ID = 'rzp_test_fixture';
    process.env.RAZORPAY_KEY_SECRET = 'fixture-secret';
    res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
  });
  afterEach(() => {
    sinon.restore();
    ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'].forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    });
  });
  it('exposes test mode without exposing credentials', () => {
    getPaymentConfig({}, res);
    expect(res.json.firstCall.args[0]).to.deep.equal({ configured: true, mode: 'test', minimumAmount: 100 });
  });
  it('rejects missing credentials before contacting Razorpay', async () => {
    delete process.env.RAZORPAY_KEY_SECRET;
    const gateway = sinon.spy(walletGateway.orders, 'create');
    await createOrder({ body: { amount: 100 }, user: { _id: 'user' } }, res);
    expect(res.status.firstCall.args[0]).to.equal(503);
    expect(gateway.called).to.equal(false);
  });
  it('rejects malformed and incorrect signatures', async () => {
    for (const signature of ['bad', '0'.repeat(64)]) {
      await verifyPayment({ user: { _id: 'user' }, body: {
        razorpay_order_id: 'order_fixture', razorpay_payment_id: 'pay_fixture', razorpay_signature: signature,
      } }, res);
      expect(res.status.lastCall.args[0]).to.equal(400);
    }
  });
  it('does not credit an authorized payment until captured', async () => {
    const transaction = { razorpayOrderId: 'order_fixture', save: sinon.spy() };
    sinon.stub(Transaction, 'findOne').resolves(transaction);
    sinon.stub(walletGateway.payments, 'fetch').resolves({ id: 'pay_fixture', order_id: 'order_fixture', status: 'authorized', captured: false });
    const signature = crypto.createHmac('sha256', 'fixture-secret').update('order_fixture|pay_fixture').digest('hex');
    await verifyPayment({ user: { _id: 'user' }, body: {
      razorpay_order_id: 'order_fixture', razorpay_payment_id: 'pay_fixture', razorpay_signature: signature,
    } }, res);
    expect(res.status.firstCall.args[0]).to.equal(202);
    expect(res.json.firstCall.args[0].pending).to.equal(true);
    expect(transaction.save.called).to.equal(false);
  });
});
