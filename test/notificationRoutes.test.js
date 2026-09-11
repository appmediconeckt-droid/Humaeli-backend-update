import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import routes from '../src/routes/notificationRoutes.js';
import User from '../src/models/userModel.js';
import Session from '../src/models/sessionModel.js';
import Subscription from '../src/models/CounselorOnlineSubscription.js';
import NotificationToken from '../src/models/NotificationToken.js';

describe('notification subscription HTTP contract', () => {
  const counselorId = '507f1f77bcf86cd799439011';
  const userId = '507f1f77bcf86cd799439012';
  const sessionId = '507f1f77bcf86cd799439013';
  const paths = [
    `/api/notifications/counselors/${counselorId}/online-subscription`,
    `/api/notifications/availability-subscriptions/${counselorId}`,
  ];
  let app, sandbox;
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    app = express();
    app.use(express.json());
    app.use('/api/notifications', routes);
    sandbox.stub(jwt, 'verify').returns({ userId, sessionId });
    sandbox.stub(Session, 'findOne').resolves({ _id: sessionId });
    sandbox.stub(Session, 'updateOne').resolves({});
    sandbox.stub(User, 'findById').resolves({ _id: userId, role: 'user', isActive: true, isOnline: true });
  });
  afterEach(() => sandbox.restore());

  for (const path of paths) {
  describe(path, () => {
  for (const key of ['subscribed', 'enabled']) {
    it(`POST ${key}: false removes only this consultant bell`, async () => {
      const remove = sandbox.stub(Subscription, 'deleteOne').resolves({});
      const save = sandbox.stub(Subscription, 'findOneAndUpdate').resolves({});
      const response = await request(app).post(path).set('Authorization', 'Bearer test')
        .send({ [key]: false });
      expect(response.status).to.equal(200);
      expect(response.body.subscribed).to.equal(false);
      expect(remove.firstCall.args[0]).to.deep.equal({ userId, counselorId });
      expect(save.called).to.equal(false);
    });
  }
  it('rejects ambiguous or invalid bell states without saving a subscription', async () => {
    const save = sandbox.stub(Subscription, 'findOneAndUpdate').resolves({});
    for (const body of [{ subscribed: 'false' }, { enabled: 0 }, { subscribed: true, enabled: false }]) {
      await request(app).post(path).set('Authorization', 'Bearer test').send(body).expect(400);
    }
    expect(save.called).to.equal(false);
  });
  for (const method of ['get', 'post', 'delete']) {
    it(`${method.toUpperCase()} exists and requires authentication`, async () => {
      const response = await request(app)[method](path);
      expect(response.status).to.equal(401);
      expect(response.body.code).to.equal('NO_TOKEN');
    });
    it(`${method.toUpperCase()} rejects an undefined counselor ID with 400`, async () => {
      const response = await request(app)[method](path.replace(counselorId, 'undefined'))
        .set('Authorization', 'Bearer test');
      expect(response.status).to.equal(400);
      expect(response.body.code).to.equal('INVALID_COUNSELOR_ID');
    });
  }

  it('saves, reads and deletes the bell at the documented URL using authenticated identity', async () => {
    sandbox.stub(User, 'findOne').returns({ select: () => ({ lean: async () => ({ _id: counselorId }) }) });
    const save = sandbox.stub(Subscription, 'findOneAndUpdate').resolves({});
    sandbox.stub(Subscription, 'exists').resolves({ _id: 'subscription' });
    const remove = sandbox.stub(Subscription, 'deleteOne').resolves({});
    for (const method of ['post', 'get', 'delete']) {
      const response = await request(app)[method](path).set('Authorization', 'Bearer test')
        .send({ userId: 'must-not-be-used' });
      expect(response.status).to.equal(200);
      expect(response.body).to.deep.equal({ success: true, subscribed: method !== 'delete', counselorId });
    }
    expect(save.firstCall.args[0]).to.deep.equal({ userId, counselorId });
    expect(remove.firstCall.args[0]).to.deep.equal({ userId, counselorId });
  });
  });
  }

  it('shares saved bell state across both URL variants', async () => {
    sandbox.stub(User, 'findOne').returns({ select: () => ({ lean: async () => ({ _id: counselorId }) }) });
    const saved = new Set();
    const key = ({ userId, counselorId }) => `${userId}:${counselorId}`;
    sandbox.stub(Subscription, 'findOneAndUpdate').callsFake(async (filter) => {
      saved.add(key(filter));
      return {};
    });
    sandbox.stub(Subscription, 'exists').callsFake(async (filter) => saved.has(key(filter)) ? {} : null);
    sandbox.stub(Subscription, 'deleteOne').callsFake(async (filter) => {
      saved.delete(key(filter));
      return {};
    });
    await request(app).post(paths[1]).set('Authorization', 'Bearer test').expect(200);
    const enabled = await request(app).get(paths[0]).set('Authorization', 'Bearer test').expect(200);
    expect(enabled.body.subscribed).to.equal(true);
    await request(app).delete(paths[0]).set('Authorization', 'Bearer test').expect(200);
    const disabled = await request(app).get(paths[1]).set('Authorization', 'Bearer test').expect(200);
    expect(disabled.body.subscribed).to.equal(false);
  });

  it('clears another account legacy token when the device registers for the current user', async () => {
    sandbox.stub(User, 'findByIdAndUpdate').resolves({ _id: userId });
    const clear = sandbox.stub(User, 'updateMany').resolves({});
    const register = sandbox.stub(NotificationToken, 'findOneAndUpdate').resolves({});
    await request(app).post('/api/notifications/register-token')
      .set('Authorization', 'Bearer test')
      .send({ fcmToken: 'device-token', platform: 'android' }).expect(200);
    expect(clear.firstCall.args[0]).to.deep.equal({ _id: { $ne: userId }, fcmToken: 'device-token' });
    expect(register.firstCall.args[1].userId).to.equal(userId);
  });
});
