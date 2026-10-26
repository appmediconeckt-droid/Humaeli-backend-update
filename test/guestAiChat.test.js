import { expect } from 'chai';
import sinon from 'sinon';
import Chat from '../src/models/chatModel.js';
import User from '../src/models/userModel.js';
import { aiChatRuntime, chatWithAI } from '../src/controllers/chatController.js';

const response = () => ({ status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
describe('Landing guest AI conversation', () => {
  let turns, generate;
  beforeEach(() => {
    turns = [];
    sinon.stub(console, 'log');
    sinon.stub(aiChatRuntime, 'translatePlainText').callsFake(async ({ text }) => ({ translatedText: text }));
    generate = sinon.stub(aiChatRuntime, 'generateAIResponse').callsFake(async message => `Answer to: ${message}`);
    sinon.stub(User, 'find').returns({ select: async () => [] });
    sinon.stub(User, 'findById').returns({ select() { return this; }, lean: async () => ({ anonymous: 'Friend-Owl', age: 30, gender: 'male' }) });
    sinon.stub(Chat, 'find').callsFake(filter => ({ sort() { return this; }, limit() { return this; }, lean: async () => turns.filter(turn => turn.sessionId === filter.sessionId).slice().reverse() }));
    sinon.stub(Chat, 'findOne').returns({ sort() { return this; }, select() { return this; }, lean: async () => turns[0] || null });
    sinon.stub(Chat, 'create').callsFake(async data => { const turn = { ...data, _id: `turn-${turns.length}`, createdAt: new Date() }; turns.push(turn); return turn; });
  });
  afterEach(() => sinon.restore());
  const send = async (body, user) => {
    const res = response();
    await chatWithAI({ body: { language: 'en', ...body }, user }, res);
    expect(res.statusCode).to.equal(200);
    return res.body.data;
  };
  it('answers different guest questions after the fifth message and keeps their conversation context', async () => {
    const opening = await send({ kind: 'opening' });
    expect(generate.called).to.equal(false);
    expect(turns[0].userMessage).to.equal('');
    const questions = ['How can I unwind?', 'How do I focus?', 'How do I plan my day?', 'How can I relax?', 'How do I journal?', 'How do I stay motivated?'];
    for (const message of questions) {
      const result = await send({ sessionId: opening.sessionId, message });
      expect(result.aiResponse).to.equal(`Answer to: ${message}`);
      expect(result.chatLimitReached).to.equal(false);
      expect(result.messageLimit).to.equal(null);
      expect(result.type).to.equal('answer');
    }
    expect(generate.callCount).to.equal(6);
    expect(generate.lastCall.args[1]).to.deep.include({ role: 'user', content: questions[0] });
    expect(generate.lastCall.args[1]).to.deep.include({ role: 'assistant', content: `Answer to: ${questions[4]}` });
    expect(Chat.find.lastCall.args[0]).to.deep.equal({ sessionId: opening.sessionId, userId: null });
  });
  it('answers an initial guest question instead of returning the static onboarding greeting', async () => {
    const result = await send({ message: 'How do I focus?' });
    expect(result.aiResponse).to.equal('Answer to: How do I focus?');
    expect(generate.calledOnce).to.equal(true);
  });
  it('allows guest conversation after five minutes', async () => {
    const opening = await send({ kind: 'opening' });
    turns[0].createdAt = new Date(Date.now() - 301000);
    const result = await send({ sessionId: opening.sessionId, message: 'How do I focus?' });
    expect(result.aiResponse).to.equal('Answer to: How do I focus?');
  });
  it('enforces the ten-minute guest preview', async () => {
    const opening = await send({ kind: 'opening' });
    turns[0].createdAt = new Date(Date.now() - 600000);
    const res = response();
    await chatWithAI({ body: { sessionId: opening.sessionId, message: 'How do I focus?', language: 'en' } }, res);
    expect(res.statusCode).to.equal(403);
    expect(res.body.code).to.equal('GUEST_CHAT_LIMIT_REACHED');
    expect(res.body.message).to.equal('Your free chat has ended. Please sign up to continue.');
    expect(generate.called).to.equal(false);
  });
  it('retains the signed-in five-message recommendation rule', async () => {
    for (let index = 0; index < 4; index++) turns.push({ sessionId: 'signed-in', userId: 'user', userMessage: 'Earlier question', aiResponse: 'Earlier answer', createdAt: new Date() });
    const result = await send({ sessionId: 'signed-in', message: 'How do I focus?' }, { _id: 'user' });
    expect(result.chatLimitReached).to.equal(true);
    expect(result.messageLimit).to.equal(5);
    expect(result.type).to.equal('consultant_recommendation');
    expect(generate.called).to.equal(false);
  });
});
