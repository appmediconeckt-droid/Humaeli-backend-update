import { expect } from 'chai';
import sinon from 'sinon';
import Chat from '../src/models/Chat.js';
import { getChatBlockStatus, setUserChatBlock, sendMessage } from '../src/controllers/messageController.js';
describe('conversation blocking', () => {
  beforeEach(() => sinon.stub(Chat, 'updateMany').resolves({ modifiedCount: 1 }));
  afterEach(() => sinon.restore());
  const response = () => { const res = {}; res.status = sinon.stub().returns(res); res.json = sinon.stub().returns(res); return res; };
  const makeChat = () => ({ _id: 'chat', chatId: 'chat_public', userId: 'user1', counselorId: 'counselor1', status: 'active', blockedByUser: false, save: sinon.stub().resolves() });
  it('returns saved block status for either participant even for a closed chat', async () => {
    const chat = { ...makeChat(), status: 'closed', blockedByUser: true };
    sinon.stub(Chat, 'findOne').resolves(chat);
    for (const [role, id] of [['user', 'user1'], ['counsellor', 'counselor1']]) {
      const res = response(); res.setHeader = sinon.stub();
      await getChatBlockStatus({ params: { chatId: 'chat_public' }, user: { role, _id: id } }, res);
      expect(res.json.firstCall.args[0]).to.include({ blockedByUser: true, blockedByCounselor: false });
    }
    const res = response();
    await getChatBlockStatus({ params: { chatId: 'chat_public' }, user: { role: 'user', _id: 'other' } }, res);
    expect(res.status.calledWith(403)).to.equal(true);
  });
  it('lets only the account owner block and unblock', async () => {
    const chat = makeChat(); sinon.stub(Chat, 'findOne').resolves(chat); const res = response();
    const req = { params: { chatId: 'chat_public' }, user: { role: 'user', _id: 'user1' }, body: { blocked: true } };
    await setUserChatBlock(req, res); expect(chat.blockedByUser).to.equal(true);
    expect(Chat.updateMany.firstCall.args).to.deep.equal([{ userId: 'user1', counselorId: 'counselor1' }, { $set: { blockedByUser: true } }]);
    await setUserChatBlock({ ...req, user: { role: 'user', _id: 'other' }, body: { blocked: false } }, res);
    expect(res.status.calledWith(403)).to.equal(true); expect(chat.blockedByUser).to.equal(true);
    await setUserChatBlock({ ...req, body: { blocked: false } }, res); expect(chat.blockedByUser).to.equal(false);
    expect(Chat.updateMany.lastCall.args[1]).to.deep.equal({ $set: { blockedByUser: false } });
  });
  it('keeps each participant block independent', async () => {
    const chat = { ...makeChat(), blockedByUser: true }; sinon.stub(Chat, 'findOne').resolves(chat); const res = response();
    const req = { params: { chatId: 'chat_public' }, user: { role: 'counsellor', _id: 'counselor1' }, body: { blocked: true } };
    await setUserChatBlock(req, res); expect(chat.blockedByCounselor).to.equal(true);
    await setUserChatBlock({ ...req, body: { blocked: false } }, res);
    expect(chat.blockedByCounselor).to.equal(false); expect(chat.blockedByUser).to.equal(true);
  });
  it('accepts the counselor role spelling for the assigned professional', async () => {
    const chat = makeChat(); sinon.stub(Chat, 'findOne').resolves(chat); const res = response();
    await setUserChatBlock({ params: { chatId: 'chat_public' }, user: { role: 'counselor', _id: 'counselor1' }, body: { blocked: true } }, res);
    expect(chat.blockedByCounselor).to.equal(true);
    expect(res.status.calledWith(403)).to.equal(false);
  });
  it('prevents messaging when the counsellor has blocked the user', async () => {
    sinon.stub(Chat, 'findOne').resolves({ ...makeChat(), blockedByCounselor: true }); const res = response();
    await sendMessage({ params: { chatId: 'chat_public' }, user: { role: 'user', _id: 'user1' }, body: { content: 'hello' } }, res);
    expect(res.status.calledWith(403)).to.equal(true);
  });
  for (const [role, id] of [['user', 'user1'], ['counsellor', 'counselor1']]) {
    it(`prevents ${role} messages while blocked`, async () => {
      sinon.stub(Chat, 'findOne').resolves({ ...makeChat(), blockedByUser: true }); const res = response();
      await sendMessage({ params: { chatId: 'chat_public' }, user: { role, _id: id }, body: { content: 'hello' } }, res);
      expect(res.status.calledWith(403)).to.equal(true);
    });
  }
});
