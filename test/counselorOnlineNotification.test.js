import { expect } from 'chai';
import sinon from 'sinon';

// Initialize messaging without sending anything; every send is stubbed below.
process.env.GOOGLE_CLOUD_PROJECT ||= 'notification-unit-tests';
const { messaging } = await import('../src/config/firebaseAdmin.js');
const { default: User } = await import('../src/models/userModel.js');
const { default: Subscription } = await import('../src/models/CounselorOnlineSubscription.js');
const { default: Notification } = await import('../src/models/Notification.js');
const { default: NotificationToken } = await import('../src/models/NotificationToken.js');
const { markUserOnlineAndNotify } = await import('../src/services/onlinePresenceService.js');
const { notifyCounselorSubscribersOnline } = await import('../src/services/counselorOnlineNotificationService.js');
const { subscribeToCounselorOnline, unsubscribeFromCounselorOnline, getNotifications } = await import('../src/controllers/notificationController.js');

describe('counselor online bell notifications', () => {
  let sandbox, send, subscriptions, created;
  const query = (value) => ({ select: () => ({ lean: async () => value }) });
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    send = sandbox.stub(messaging, 'send').resolves('mock-message-id');
    sandbox.stub(User, 'findById').callsFake((id) => query(
      id === 'counselor' ? { fullName: 'Consultant', role: 'counsellor' } : { fcmToken: 'legacy-token' },
    ));
    subscriptions = sandbox.stub(Subscription, 'find').returns(query([{ userId: 'new-user' }, { userId: 'connected-user' }]));
    sandbox.stub(Subscription, 'exists').resolves({ _id: 'subscription' });
    sandbox.stub(NotificationToken, 'find').returns(query([{ token: 'phone-1' }, { token: 'phone-2' }, { token: 'phone-1' }]));
    sandbox.stub(NotificationToken, 'findOne').returns(query(null));
    created = sandbox.stub(Notification, 'create').callsFake(async (value) => ({ _id: 'notification-id', toObject: () => value }));
  });
  afterEach(() => sandbox.restore());

  it('notifies every subscriber without requiring an existing chat and preserves push event type', async () => {
    await notifyCounselorSubscribersOnline('counselor');
    expect(subscriptions.firstCall.args[0]).to.deep.equal({ counselorId: 'counselor' });
    expect(created.getCalls().map((call) => call.args[0].recipientId)).to.deep.equal(['new-user', 'connected-user']);
    expect(send.callCount).to.equal(4);
    expect(send.firstCall.args[0].data.type).to.equal('COUNSELOR_ONLINE');
    expect(send.firstCall.args[0].notification.title).to.equal('Consultant is online');
  });

  it('continues delivery to another device when one token fails', async () => {
    send.onFirstCall().rejects(Object.assign(new Error('expired'), { code: 'messaging/registration-token-not-registered' }));
    const deactivate = sandbox.stub(NotificationToken, 'updateOne').resolves({});
    sandbox.stub(User, 'updateOne').resolves({});
    await notifyCounselorSubscribersOnline('counselor');
    expect(send.callCount).to.equal(4);
    expect(deactivate.calledOnce).to.equal(true);
  });

  it('uses the legacy user token if the secondary token store fails', async () => {
    NotificationToken.find.throws(new Error('secondary store unavailable'));
    await notifyCounselorSubscribersOnline('counselor');
    expect(send.callCount).to.equal(2);
    expect(send.firstCall.args[0].token).to.equal('legacy-token');
  });

  it('sends once for login followed by HTTP and socket presence updates', async () => {
    const update = sandbox.stub(User, 'findByIdAndUpdate');
    update.onFirstCall().resolves({ isOnline: false, role: 'counsellor' });
    update.onSecondCall().resolves({ isOnline: true, role: 'counsellor' });
    update.onThirdCall().resolves({ isOnline: true, role: 'counsellor' });
    await Promise.all([1, 2, 3].map(() => markUserOnlineAndNotify('counselor')));
    expect(subscriptions.calledOnce).to.equal(true);
    expect(update.firstCall.args[2]).to.deep.equal({ returnDocument: 'before' });
  });

  it('does not send after bell is switched off', async () => {
    subscriptions.returns(query([]));
    await notifyCounselorSubscribersOnline('counselor');
    expect(send.called).to.equal(false);
  });

  it('only sends for the exact user and counselor pair whose bell is on', async () => {
    User.findById.callsFake(() => query({ fullName: 'Consultant', role: 'counsellor' }));
    // Include a stale/unsubscribed candidate to exercise the final delivery guard.
    Subscription.exists.callsFake(async ({ userId, counselorId }) =>
      userId === 'new-user' && counselorId === 'counselor-A' ? {} : null);
    await notifyCounselorSubscribersOnline('counselor-B');
    expect(created.called).to.equal(false);
    expect(send.called).to.equal(false);
    await notifyCounselorSubscribersOnline('counselor-A');
    expect(created.callCount).to.equal(1);
    expect(created.firstCall.args[0].recipientId).to.equal('new-user');
    expect(send.callCount).to.equal(2);
    expect(send.getCalls().every((call) => call.args[0].data.counselorId === 'counselor-A')).to.equal(true);
  });

  it('suppresses a queued push when bell is disabled during token lookup', async () => {
    NotificationToken.find.callsFake(() => {
      Subscription.exists.resolves(null);
      return query([{ token: 'phone-1' }]);
    });
    await notifyCounselorSubscribersOnline('counselor');
    expect(send.called).to.equal(false);
  });

  it('does not deliver an old account subscription to a device now owned by another account', async () => {
    NotificationToken.find.returns(query([]));
    NotificationToken.findOne.returns(query({ userId: 'different-account', active: true }));
    await notifyCounselorSubscribersOnline('counselor');
    expect(send.called).to.equal(false);
  });

  it('does not reuse an inactive device token through the legacy fallback', async () => {
    NotificationToken.find.returns(query([]));
    NotificationToken.findOne.returns(query({ userId: 'new-user', active: false }));
    await notifyCounselorSubscribersOnline('counselor');
    expect(send.called).to.equal(false);
  });

  it('notifies again when the counselor returns after going offline', async () => {
    sandbox.stub(User, 'findByIdAndUpdate').resolves({ isOnline: false, role: 'counselor' });
    await markUserOnlineAndNotify('counselor');
    await markUserOnlineAndNotify('counselor');
    expect(subscriptions.callCount).to.equal(2);
  });

  it('does not query counselor subscriptions when a regular user comes online', async () => {
    sandbox.stub(User, 'findByIdAndUpdate').resolves({ isOnline: false, role: 'user' });
    await markUserOnlineAndNotify('new-user');
    expect(subscriptions.called).to.equal(false);
  });

  it('allows subscribing without a prior connection and removes only that user subscription', async () => {
    sandbox.stub(User, 'findOne').returns(query({ _id: 'counselor' }));
    const upsert = sandbox.stub(Subscription, 'findOneAndUpdate').resolves({});
    const remove = sandbox.stub(Subscription, 'deleteOne').resolves({});
    const req = { userId: 'new-user', params: { counselorId: 'counselor' } };
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
    await subscribeToCounselorOnline(req, res);
    expect(upsert.firstCall.args[0]).to.deep.equal({ userId: 'new-user', counselorId: 'counselor' });
    expect(res.json.firstCall.args[0].subscribed).to.equal(true);
    await unsubscribeFromCounselorOnline(req, res);
    expect(remove.firstCall.args[0]).to.deep.equal(upsert.firstCall.args[0]);
  });

  it('loads the authenticated user notification list with bounded pagination', async () => {
    const find = sandbox.stub(Notification, 'find').returns({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }) });
    sandbox.stub(Notification, 'countDocuments').resolves(0);
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
    await getNotifications({ userId: 'new-user', query: { limit: '1000' } }, res);
    expect(find.firstCall.args[0].recipientId).to.equal('new-user');
    expect(res.json.firstCall.args[0].pagination.limit).to.equal(100);
  });
});
