import { expect } from 'chai';
import sinon from 'sinon';
import Appointment from '../src/models/appointmentModel.js';
import AppointmentPayment from '../src/models/appointmentPaymentModel.js';
import { releaseUnpaidAppointmentSlot } from '../src/controllers/appointmentPaymentController.js';
import { appointmentGateway, appointmentPaymentRepository } from '../src/services/appointmentPaymentService.js';

describe('Release a failed appointment payment slot', () => {
  let saved;
  beforeEach(() => {
    saved = [process.env.PAYMENTS_MODE, process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET];
    Object.assign(process.env, { PAYMENTS_MODE: 'test', RAZORPAY_KEY_ID: 'rzp_test_fixture', RAZORPAY_KEY_SECRET: 'fixture' });
    sinon.stub(appointmentPaymentRepository, 'connection').resolves({ query: async () => [[{ acquired: 1 }]], release() {} });
  });
  afterEach(() => {
    sinon.restore();
    ['PAYMENTS_MODE', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'].forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i];
    });
  });
  for (const status of ['failed', 'empty', 'authorized', 'captured']) {
    it(`${status}: releases only a definitely unpaid draft`, async () => {
      sinon.stub(Appointment, 'findOne').resolves({ _id: 'draft', patient: 'patient', counselor: 'doctor', status: 'awaiting_payment', payment_status: 'pending' });
      sinon.stub(AppointmentPayment, 'findOne').resolves({ _id: 'ledger', appointmentId: 'draft', userId: 'patient', providerId: 'doctor',
        method: 'upi', mode: 'test', orderId: 'order_test', amount: 120000, currency: 'INR' });
      sinon.stub(appointmentGateway.orders, 'fetchPayments').resolves({ items: status === 'empty' ? [] : [{
        id: 'pay_test', order_id: 'order_test', status, method: 'upi', amount: 120000, currency: 'INR',
      }] });
      const ledger = sinon.stub(AppointmentPayment, 'updateOne').resolves({ matchedCount: 1 });
      const booking = sinon.stub(Appointment, 'updateOne').resolves({ matchedCount: 1, modifiedCount: 0 });
      const res = { json: sinon.spy(), status: sinon.stub().returnsThis() };
      await releaseUnpaidAppointmentSlot({ user: { _id: 'patient', role: 'user' }, params: { appointmentId: 'draft' } }, res);
      const body = res.json.firstCall.args[0];
      if (['failed', 'empty'].includes(status)) {
        expect(body.released).to.equal(true);
        expect(booking.firstCall.args[1]).to.deep.equal({ $set: { queue_status: 'canceled' }, $unset: { slot_key: 1 } });
        expect(ledger.firstCall.args[1].$set.slotReleased).to.equal(true);
      } else if (status === 'authorized') {
        expect(body.pending).to.equal(true);
        expect(booking.called).to.equal(false);
      } else {
        expect(body.paid).to.equal(true);
        expect(booking.firstCall.args[1].$set).to.include({ status: 'pending', payment_status: 'paid' });
      }
    });
  }
  it('releases a draft when checkout never created a payment order', async () => {
    sinon.stub(Appointment, 'findOne').resolves({ _id: 'draft', status: 'awaiting_payment' });
    sinon.stub(AppointmentPayment, 'findOne').resolves(null);
    const update = sinon.stub(Appointment, 'updateOne').resolves({ matchedCount: 1 });
    const res = { json: sinon.spy(), status: sinon.stub().returnsThis() };
    await releaseUnpaidAppointmentSlot({ user: { _id: 'patient', role: 'user' }, params: { appointmentId: 'draft' } }, res);
    expect(res.json.firstCall.args[0].released).to.equal(true);
    expect(update.firstCall.args[1].$unset).to.deep.equal({ slot_key: 1 });
  });
  for (const accessible of [true, false]) it(`checks a rotated key's original order before releasing (accessible: ${accessible})`, async () => {
    sinon.stub(Appointment, 'findOne').resolves({ _id: 'draft', status: 'awaiting_payment' });
    sinon.stub(AppointmentPayment, 'findOne').resolves({ _id: 'ledger', appointmentId: 'draft', userId: 'patient',
      mode: 'test', gatewayKeyId: 'rzp_test_old', orderId: 'order_old', amount: 120000, currency: 'INR', method: 'upi', status: 'pending' });
    const order = sinon.stub(appointmentGateway.orders, 'fetch');
    if (accessible) order.resolves({ id: 'order_old', amount: 120000, currency: 'INR', notes: { appointmentId: 'draft' } });
    else order.rejects(Object.assign(new Error('Order cannot be verified'), { statusCode: 503 }));
    sinon.stub(appointmentGateway.orders, 'fetchPayments').resolves({ items: [] });
    sinon.stub(AppointmentPayment, 'updateOne').resolves({ matchedCount: 1 });
    const update = sinon.stub(Appointment, 'updateOne').resolves({ matchedCount: 1 });
    const res = { json: sinon.spy(), status: sinon.stub().returnsThis() };
    await releaseUnpaidAppointmentSlot({ user: { _id: 'patient', role: 'user' }, params: { appointmentId: 'draft' } }, res);
    expect(update.called).to.equal(accessible);
    if (accessible) expect(res.json.firstCall.args[0].released).to.equal(true);
    else expect(res.status.firstCall.args[0]).to.equal(503);
  });
});
