import { expect } from 'chai';
import sinon from 'sinon';
import { videoCallController } from '../src/controllers/videoCallController.js';
import User from '../src/models/userModel.js';
import Call from '../src/models/Call.js';
import Notification from '../src/models/Notification.js';
import NotificationToken from '../src/models/NotificationToken.js';
import Transaction from '../src/models/transactionModel.js';
import CounselorEarning from '../src/models/CounselorEarning.js';

// Socket delivery and notifications are captured locally; no real patient is called.
describe('Doctor appointment call delivery', () => {
  let oldIo, oldHandler, events;
  const doctor = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  let patient, sequence = 1;
  const response = () => ({ code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
  beforeEach(() => {
    patient = (sequence++).toString(16).padStart(24, 'b');
    oldIo = global.io; oldHandler = global.socketHandler; events = [];
    global.io = { to: room => ({ emit: (event, payload) => events.push({ room, event, payload }) }) };
    global.socketHandler = { isUserOnline: () => true };
    sinon.stub(videoCallController, 'getUserDetails').callsFake(async id => ({ fullName: id === doctor ? 'Doctor' : 'Patient', isActive: true }));
    // Run the actual schema validation: mocking it previously hid the missing
    // doctor enum and let request tests pass while real calls failed to save.
    sinon.stub(Call, 'create').callsFake(async data => {
      const record = new Call(data);
      await record.validate();
      return record;
    });
    sinon.stub(Call, 'findOneAndUpdate').resolves({});
    sinon.stub(Notification, 'create').callsFake(async data => ({ _id: 'notification', toObject: () => data }));
    sinon.stub(NotificationToken, 'find').returns({ select() { return this; }, lean: async () => [] });
    sinon.stub(User, 'findById').returns({ select() { return this; }, lean: async () => ({}) });
  });
  afterEach(() => { sinon.restore(); global.io = oldIo; global.socketHandler = oldHandler; });
  for (const callType of ['video', 'voice', 'audio']) {
    for (const endedByPatient of [false, true]) {
      it(`${callType}: ends a doctor appointment without wallet billing when ${endedByPatient ? 'patient' : 'doctor'} hangs up`, async () => {
        const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
        const transactionLookup = sinon.stub(Transaction, 'findOne').rejects(new Error('Doctor calls must not query wallet transactions'));
        const debit = sinon.stub(Transaction, 'create').rejects(new Error('Doctor calls must not debit the wallet'));
        const earning = sinon.stub(CounselorEarning, 'findOneAndUpdate').rejects(new Error('Doctor calls must not create counselor earnings'));
        const initiated = response();
        await videoCallController.initiateCall({ user: { _id: doctor, role: 'doctor' }, body: { receiverId: patient, receiverType: 'user', callType } }, initiated);
        expect(initiated.code).to.equal(201);
        const callId = initiated.body.callId;
        const accepted = response();
        await videoCallController.acceptCall({ user: { _id: patient, role: 'user' }, params: { callId }, body: { acceptorType: 'user' } }, accepted);
        expect(accepted.body.status).to.equal('active');
        clock.setSystemTime(Date.now() + 120000);
        const ended = response();
        await videoCallController.endCall({ user: { _id: endedByPatient ? patient : doctor }, params: { callId }, body: {} }, ended);
        expect(ended.code).to.equal(200);
        expect(ended.body.callSummary).to.include({ duration: 120, billedAmount: 0, billingError: null });
        expect(transactionLookup.called).to.equal(false);
        expect(debit.called).to.equal(false);
        expect(earning.called).to.equal(false);
        expect(Call.findOneAndUpdate.lastCall.args[1]).to.include({ paymentTransactionId: null, paymentAmount: 0 });
        const repeated = response();
        await videoCallController.endCall({ user: { _id: patient }, params: { callId }, body: {} }, repeated);
        expect(repeated.body.message).to.equal('Call already ended');
        expect(debit.called).to.equal(false);
      });
    }
  }
  for (const initiatedByUser of [true, false]) {
    it(`still deducts wallet usage for counselor video calls initiated by the ${initiatedByUser ? 'user' : 'counselor'}`, async () => {
      const settingKeys = ['PAID_COUNSELOR_SESSIONS_ENABLED', 'COUNSELOR_VIDEO_FEE', 'COUNSELOR_SESSION_DURATION_MINUTES', 'PLATFORM_COMMISSION_PERCENT'];
      const savedSettings = settingKeys.map(key => process.env[key]);
      Object.assign(process.env, { PAID_COUNSELOR_SESSIONS_ENABLED: 'true', COUNSELOR_VIDEO_FEE: '300', COUNSELOR_SESSION_DURATION_MINUTES: '30', PLATFORM_COMMISSION_PERCENT: '20' });
      try {
        const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
        const wallet = { walletBalance: 100, role: 'user', save: sinon.stub().resolves() };
        const provider = { role: 'counsellor', fullName: 'Counselor' };
        User.findById.callsFake(id => {
          const record = String(id) === doctor ? provider : wallet;
          const query = Promise.resolve(record);
          query.select = () => query;
          query.lean = async () => record;
          return query;
        });
        videoCallController.getUserDetails.callsFake(async id => ({ fullName: id === doctor ? 'Counselor' : 'Patient', type: id === doctor ? 'counsellor' : 'user', isActive: true }));
        sinon.stub(User, 'findByIdAndUpdate').resolves({});
        sinon.stub(Transaction, 'findOne').resolves(null);
        const debit = sinon.stub(Transaction, 'create').callsFake(async data => ({ _id: 'payment', ...data }));
        sinon.stub(CounselorEarning, 'findOneAndUpdate').resolves({});
        const initiator = initiatedByUser ? patient : doctor;
        const receiver = initiatedByUser ? doctor : patient;
        const receiverType = initiatedByUser ? 'counsellor' : 'user';
        const initiated = response();
        await videoCallController.initiateCall({ user: { _id: initiator, role: initiatedByUser ? 'user' : 'counsellor' }, body: { receiverId: receiver, receiverType, callType: 'video' } }, initiated);
        expect(initiated.code).to.equal(201);
        const callId = initiated.body.callId;
        const accepted = response();
        await videoCallController.acceptCall({ user: { _id: receiver }, params: { callId }, body: { acceptorType: receiverType } }, accepted);
        expect(accepted.body.status).to.equal('active');
        clock.setSystemTime(Date.now() + 180000);
        const ended = response();
        await videoCallController.endCall({ user: { _id: patient }, params: { callId }, body: {} }, ended);
        expect(ended.body.callSummary).to.include({ billedAmount: 30, walletBalance: 70, billingError: null });
        expect(debit.calledOnce).to.equal(true);
        expect(debit.firstCall.args[0]).to.include({ userId: patient, counselorId: doctor, amount: 30 });
        expect(Call.findOneAndUpdate.lastCall.args[1]).to.include({ paymentAmount: 30, paymentStatus: 'paid' });
      } finally {
        settingKeys.forEach((key, index) => { if (savedSettings[index] === undefined) delete process.env[key]; else process.env[key] = savedSettings[index]; });
      }
    });
  }
  it('delivers a video incoming event to the patient and exposes the pending request', async () => {
    const res = response();
    await videoCallController.initiateCall({ user: { _id: doctor, role: 'doctor' }, body: { receiverId: patient, receiverType: 'user', callType: 'video' } }, res);
    expect(res.code).to.equal(201);
    const incoming = events.find(event => event.room === `user_${patient}` && event.event === 'incoming_call_request');
    expect(incoming.payload.callType).to.equal('video');
    expect(incoming.payload.callId).to.equal(res.body.callId);
    const pending = response();
    await videoCallController.getPendingRequests({ params: { userId: patient }, query: { userType: 'user' } }, pending);
    expect(pending.body.pendingRequests.some(call => call.callId === res.body.callId)).to.equal(true);
  });
  it('keeps a doctor request pending while the patient reconnects and allows acceptance', async () => {
    global.socketHandler = { isUserOnline: id => id === doctor };
    const res = response();
    await videoCallController.initiateCall({ user: { _id: doctor, role: 'doctor' }, body: { receiverId: patient, receiverType: 'user', callType: 'video' } }, res);
    expect(res.code).to.equal(201);
    expect(res.body.notificationOnly).not.to.equal(true);
    expect(res.body.receiverOffline).to.equal(true);
    expect(res.body.status).to.equal('pending');
    const pending = response();
    await videoCallController.getPendingRequests({ params: { userId: patient }, query: { userType: 'user' } }, pending);
    expect(pending.body.pendingRequests.some(call => call.callId === res.body.callId)).to.equal(true);
    global.socketHandler = { isUserOnline: () => true };
    const accepted = response();
    await videoCallController.acceptCall({ user: { _id: patient, role: 'user' }, params: { callId: res.body.callId }, body: { acceptorType: 'user' } }, accepted);
    expect(accepted.body.success).to.equal(true);
    expect(accepted.body.status).to.equal('active');
  });
  it('still requires the initiating doctor to have a live connection', async () => {
    global.socketHandler = { isUserOnline: () => false };
    const res = response();
    await videoCallController.initiateCall({ user: { _id: doctor, role: 'doctor' }, body: { receiverId: patient, receiverType: 'user', callType: 'video' } }, res);
    expect(res.body.notificationOnly).to.equal(true);
    expect(res.body.initiatorOffline).to.equal(true);
  });
  it('rejects a socket owned by another account before creating a call', async () => {
    global.io.sockets = { sockets: new Map([['other-socket', { userId: patient }]]) };
    const res = response();
    await videoCallController.initiateCall({ user: { _id: doctor, role: 'doctor' }, body: { receiverId: patient, receiverType: 'user', callType: 'video', socketId: 'other-socket' } }, res);
    expect(res.code).to.equal(409);
    expect(res.body.code).to.equal('CALL_CONNECTION_NOT_READY');
    expect(Call.create.called).to.equal(false);
  });
  it('does not ring the patient if call persistence fails', async () => {
    Call.create.rejects(new Error('Call persistence failed'));
    sinon.stub(console, 'error');
    const res = response();
    await videoCallController.initiateCall({ user: { _id: doctor, role: 'doctor' }, body: { receiverId: patient, receiverType: 'user', callType: 'video' } }, res);
    expect(res.code).to.equal(500);
    expect(events.some(event => event.event === 'incoming_call_request')).to.equal(false);
  });
});
