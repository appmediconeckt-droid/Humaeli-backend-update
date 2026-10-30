import { expect } from 'chai';
import sinon from 'sinon';
import Appointment from '../src/models/appointmentModel.js';
import User from '../src/models/userModel.js';
import Notification from '../src/models/Notification.js';
import { book } from '../src/controllers/appointmentController.js';
import { confirmPaidAppointment } from '../src/services/appointmentPaymentBookingService.js';
import { slotRepository } from '../src/services/appointmentSlotService.js';

describe('Payment is required before appointment booking', () => {
  afterEach(() => sinon.restore());

  for (const method of ['upi', 'credit_card', 'debit_card', 'wallet']) {
    it(`creates only an unannounced payment draft for ${method}`, async () => {
      sinon.stub(User, 'findOne').returns({ select: async () => ({ _id: 'provider', role: 'doctor' }) });
      sinon.stub(slotRepository, 'connection').resolves({ query: sinon.stub().resolves([[{ acquired: 1 }]]), release() {} });
      sinon.stub(slotRepository, 'ranges').resolves([{ clinic_id: 'clinic', availability_date: '2099-09-22', start_time: '10:00:00', end_time: '11:00:00', slot_duration: 15 }]);
      sinon.stub(slotRepository, 'unavailable').resolves(null);
      sinon.stub(slotRepository, 'online').resolves([]);
      sinon.stub(slotRepository, 'walkins').resolves([]);
      const create = sinon.stub(Appointment, 'create').callsFake(async data => ({ ...data, _id: 'draft' }));
      const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
      await book({ user: { _id: 'patient', role: 'user' }, body: {
        counselorId: 'provider', date: '2099-09-22T10:00:00+05:30', payment_method: method,
        status: 'confirmed', payment_status: 'paid',
      } }, res);
      expect(res.status.firstCall.args[0]).to.equal(201);
      expect(create.firstCall.args[0]).to.include({
        status: 'awaiting_payment', queue_status: 'awaiting_payment', payment_status: 'pending', payment_method: method,
      });
    });
  }

  for (const method of [undefined, 'wallet', 'upi', 'credit_card']) {
    it(`books consultant sessions without upfront payment even with legacy method ${method}`, async () => {
      sinon.stub(User, 'findOne').returns({ select: async () => ({ _id: 'provider', role: 'counsellor', acceptedPaymentMethods: [] }) });
      sinon.stub(User, 'findById').returns({ select() { return this; }, lean: async () => ({}) });
      sinon.stub(Notification, 'create').resolves({ toObject: () => ({}) });
      const create = sinon.stub(Appointment, 'create').callsFake(async data => ({ ...data, _id: 'appointment' }));
      const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
      await book({ user: { _id: 'patient', role: 'user' }, body: {
        counselorId: 'provider', date: new Date(Date.now() + 86400000).toISOString(), payment_method: method,
      } }, res);
      expect(res.status.firstCall.args[0]).to.equal(201);
      expect(create.firstCall.args[0]).to.include({ status: 'pending', queue_status: 'booked', payment_method: '', payment_status: 'pending' });
      expect(Notification.create.calledOnce).to.equal(true);
    });
  }

  it('persists paid status and booking visibility together', async () => {
    const update = sinon.stub(Appointment, 'updateOne').resolves({ modifiedCount: 0 });
    await confirmPaidAppointment({ appointmentId: 'draft', userId: 'patient', providerId: 'provider', amount: 120000, method: 'upi', paymentId: 'pay_verified' });
    expect(update.firstCall.args).to.deep.equal([
      { _id: 'draft', patient: 'patient', status: 'awaiting_payment' },
      { $set: { status: 'pending', queue_status: 'booked', payment_status: 'paid', payment_amount: 1200, payment_method: 'upi', payment_reference: 'pay_verified' } },
    ]);
  });

  it('books cash immediately without waiting for online payment', async () => {
    sinon.stub(User, 'findOne').returns({ select: async () => ({ _id: 'provider', role: 'counsellor' }) });
    sinon.stub(User, 'findById').returns({ select() { return this; }, lean: async () => ({}) });
    sinon.stub(Notification, 'create').resolves({ toObject: () => ({}) });
    const create = sinon.stub(Appointment, 'create').callsFake(async data => ({ ...data, _id: 'appointment' }));
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
    await book({ user: { _id: 'patient', role: 'user' }, body: {
      counselorId: 'provider', date: new Date(Date.now() + 86400000).toISOString(), payment_method: 'cash',
    } }, res);
    expect(res.status.firstCall.args[0]).to.equal(201);
    expect(create.firstCall.args[0]).to.include({ status: 'pending', queue_status: 'booked', payment_status: 'pending' });
    expect(Notification.create.calledOnce).to.equal(true);
  });

  it('announces a paid draft once and does not announce payment retries', async () => {
    sinon.stub(User, 'findById').returns({ select() { return this; }, lean: async () => ({}) });
    const notify = sinon.stub(Notification, 'create').resolves({ toObject: () => ({}) });
    const update = sinon.stub(Appointment, 'updateOne');
    update.onFirstCall().resolves({ modifiedCount: 1 });
    update.onSecondCall().resolves({ modifiedCount: 0 });
    const record = { appointmentId: 'draft', userId: 'patient', providerId: 'provider' };
    await confirmPaidAppointment(record);
    await confirmPaidAppointment(record);
    expect(notify.calledOnce).to.equal(true);
  });

  it('hides payment drafts from normal reads and allows explicit payment lookups', async () => {
    for (const includePaymentDrafts of [false, true]) {
      const query = Appointment.find({}, null, { includePaymentDrafts });
      query._find = async function () { return this.getFilter(); };
      const filter = await query.exec();
      if (includePaymentDrafts) expect(filter).to.deep.equal({});
      else expect(filter.$and).to.deep.include({ status: { $ne: 'awaiting_payment' } });
    }
  });
});
