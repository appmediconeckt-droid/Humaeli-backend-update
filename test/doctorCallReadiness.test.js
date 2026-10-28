import { expect } from 'chai';
import sinon from 'sinon';
import SocketHandler from '../src/socket/socketHandler.js';
import User from '../src/models/userModel.js';

describe('Doctor call delivery readiness', () => {
  afterEach(() => sinon.restore());
  it('joins the delivery room before advertising online presence and acknowledges readiness', async () => {
    let connect;
    const handler = new SocketHandler({ on(_event, callback) { connect = callback; } });
    const listeners = {};
    const socket = { userId: 'doctor', userRole: 'doctor', data: {}, on(event, callback) { listeners[event] = callback; }, join: sinon.stub().resolves() };
    sinon.stub(User, 'findById').resolves({ _id: 'doctor' });
    const mark = sinon.stub(handler, 'markUserOnline').resolves();
    sinon.stub(handler, 'joinExistingChats').resolves();
    handler.initialize();
    await connect(socket);
    expect(socket.join.calledWith('user_doctor')).to.equal(true);
    expect(socket.join.firstCall.calledBefore(mark.firstCall)).to.equal(true);
    const ack = sinon.spy();
    await listeners['call:ready'](ack);
    expect(ack.calledOnceWithExactly({ ready: true })).to.equal(true);
  });
  it('does not acknowledge readiness when presence initialization fails', async () => {
    let connect;
    const handler = new SocketHandler({ on(_event, callback) { connect = callback; } });
    const listeners = {};
    const socket = { userId: 'doctor', userRole: 'doctor', data: {}, on(event, callback) { listeners[event] = callback; }, join: sinon.stub().resolves() };
    sinon.stub(User, 'findById').resolves({ _id: 'doctor' });
    const mark = sinon.stub(handler, 'markUserOnline').resolves();
    sinon.stub(handler, 'joinExistingChats').resolves();
    handler.initialize(); await connect(socket);
    mark.rejects(new Error('presence unavailable'));
    const ack = sinon.spy(); await listeners['call:ready'](ack);
    expect(ack.calledOnceWithExactly({ ready: false })).to.equal(true);
  });
});
