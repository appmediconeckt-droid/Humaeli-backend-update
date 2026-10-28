import { expect } from 'chai';
import sinon from 'sinon';
import { videoCallController } from '../src/controllers/videoCallController.js';
import User from '../src/models/userModel.js';
import Call from '../src/models/Call.js';
import Notification from '../src/models/Notification.js';
import NotificationToken from '../src/models/NotificationToken.js';

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
