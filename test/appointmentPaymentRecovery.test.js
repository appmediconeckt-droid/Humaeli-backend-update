import { expect } from 'chai';
import sinon from 'sinon';
import { Query } from 'mingo';
import mongoose from '../src/persistence/mongoose.js';
import Appointment from '../src/models/appointmentModel.js';
import AppointmentPayment from '../src/models/appointmentPaymentModel.js';
import { appointmentGateway, appointmentPaymentRepository, recoverPatientPaymentDrafts } from '../src/services/appointmentPaymentService.js';
import { confirmPaidAppointment } from '../src/services/appointmentPaymentBookingService.js';

describe('Recover appointment visibility after a lost payment callback', () => {
  let saved;
  beforeEach(() => {
    saved = [process.env.PAYMENTS_MODE, process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET];
    Object.assign(process.env, { PAYMENTS_MODE: 'test', RAZORPAY_KEY_ID: 'rzp_test_fixture', RAZORPAY_KEY_SECRET: 'fixture' });
  });
  afterEach(() => {
    sinon.restore();
    ['PAYMENTS_MODE', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'].forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i];
    });
  });
  it('a real model update makes a hidden draft readable through the normal list query', async () => {
    const patient = new mongoose.Types.ObjectId();
    const draft = { _id: new mongoose.Types.ObjectId(), patient, status: 'awaiting_payment', payment_status: 'pending' };
    sinon.stub(Appointment.collection, 'updateOne').callsFake(async (filter, update) => {
      expect(new Query(filter).test(draft)).to.equal(true);
      Object.assign(draft, update.$set);
      return { matchedCount: 1, modifiedCount: 0 };
    });
    sinon.stub(Appointment.collection, 'find').callsFake(filter => ({
      toArray: async () => new Query(filter).find([draft]).all(),
    }));
    expect(await Appointment.find({ patient }).lean()).to.deep.equal([]);
    await confirmPaidAppointment({ appointmentId: draft._id, userId: patient, amount: 120000, method: 'upi', paymentId: 'pay_verified' });
    const visible = await Appointment.find({ patient }).lean();
    expect(visible).to.have.length(1);
    expect(visible[0]).to.include({ status: 'pending', queue_status: 'booked', payment_status: 'paid', payment_reference: 'pay_verified' });
  });
  for (const status of ['captured', 'authorized', 'failed', 'no_payment']) {
    it(`${status}: only verified capture makes the draft visible`, async () => {
      const record = { _id: 'ledger', appointmentId: 'draft', userId: 'patient', providerId: 'doctor', method: 'upi',
        mode: 'test', gatewayKeyId: 'rzp_test_fixture', amount: 120000, currency: 'INR', orderId: 'order_test', status: 'pending' };
      const chain = { select() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => [{ _id: 'draft' }] };
      const find = sinon.stub(Appointment, 'find').returns(chain);
      sinon.stub(AppointmentPayment, 'find').returns({ lean: async () => [record] });
      sinon.stub(AppointmentPayment, 'findOne').resolves(record);
      sinon.stub(AppointmentPayment, 'findById').resolves(record);
      sinon.stub(appointmentPaymentRepository, 'connection').resolves({ query: async () => [[{ acquired: 1 }]], release() {} });
      sinon.stub(appointmentGateway.orders, 'fetchPayments').resolves({ items: status === 'no_payment' ? [] : [{
        id: 'pay_verified', order_id: record.orderId, amount: record.amount, currency: 'INR', method: 'upi', status,
      }] });
      const ledger = sinon.stub(AppointmentPayment, 'updateOne').resolves({ matchedCount: 1 });
      const booking = sinon.stub(Appointment, 'updateOne').resolves({ matchedCount: 1, modifiedCount: 0 });
      await recoverPatientPaymentDrafts('patient');
      expect(find.firstCall.args[0]).to.deep.equal({ patient: 'patient', status: 'awaiting_payment' });
      expect(booking.called).to.equal(status === 'captured');
      expect(ledger.called).to.equal(status === 'captured');
      if (status === 'captured') expect(booking.firstCall.args[1].$set).to.include({
        payment_status: 'paid', status: 'pending', queue_status: 'booked', payment_reference: 'pay_verified',
      });
    });
  }
});
