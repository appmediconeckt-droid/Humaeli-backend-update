import { expect } from 'chai';
import sinon from 'sinon';
import Chat from '../src/models/chatModel.js';
import User from '../src/models/userModel.js';
import { aiChatRuntime, chatWithAI } from '../src/controllers/chatController.js';

const response = () => ({ status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
describe('Landing guest AI conversation', () => {
  let turns, generate, counsellors;
  beforeEach(() => {
    turns = [];
    counsellors = [];
    sinon.stub(console, 'log');
    sinon.stub(aiChatRuntime, 'translatePlainText').callsFake(async ({ text }) => ({ translatedText: text }));
    generate = sinon.stub(aiChatRuntime, 'generateAIResponse').callsFake(async message => `Answer to: ${message}`);
    sinon.stub(User, 'find').callsFake(filter => ({ select: async () => counsellors.filter(c =>
      Object.entries(filter).every(([key, value]) => c[key] === value)
    ) }));
    sinon.stub(User, 'findById').returns({ select() { return this; }, lean: async () => ({ anonymous: 'Friend-Owl', age: 30, gender: 'male' }) });
    sinon.stub(Chat, 'countDocuments').callsFake(async filter => turns.filter(turn => turn.userId === filter.userId && String(turn.userMessage || '').trim()).length);
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
    expect(generate.calledOnce).to.equal(true);
    expect(result.aiResponse).to.include('Answer to: How do I focus?');
    expect(result.aiResponse).to.include('No Humaeli consultant is online and available right now');
    expect(result.aiResponse).to.not.include('best matches');
    expect(result.consultants).to.deep.equal([]);
  });

  it('does not recommend offline consultants when professional help is requested', async () => {
    counsellors = [{ _id: 'offline', fullName: 'Offline Consultant', role: 'counsellor', isActive: true, profileCompleted: true, isOnline: false }];
    const result = await send({ message: 'Please recommend a consultant' }, { _id: 'user' });
    expect(User.find.firstCall.args[0]).to.include({ isOnline: true });
    expect(result.consultants).to.deep.equal([]);
    expect(result.aiResponse).to.include('No Humaeli consultant is online and available right now');
    expect(result.aiResponse).to.not.include('best matches');
  });

  it('recommends only online active consultants with completed profiles', async () => {
    const eligible = { _id: 'online', fullName: 'Online Consultant', role: 'counsellor', isActive: true, profileCompleted: true, isOnline: true };
    counsellors = [eligible, { ...eligible, _id: 'offline', isOnline: false }, { ...eligible, _id: 'inactive', isActive: false }, { ...eligible, _id: 'incomplete', profileCompleted: false }];
    const result = await send({ message: 'Please recommend a consultant' }, { _id: 'user' });
    expect(result.consultants.map(c => c.id)).to.deep.equal(['online']);
    expect(result.aiResponse).to.include('best matches');
  });

  it('answers the first signed-in weakness question instead of onboarding, in either language', async () => {
    for (const language of ['hi-IN', 'en-IN']) {
      const question = 'mujhe aaj bht jada weekness lag rhi hai';
      const result = await send({ sessionId: `weakness-${language}`, message: question, language }, { _id: 'user' });
      expect(result.aiResponse).to.equal(`Answer to: ${question}`);
      expect(generate.lastCall.args[0]).to.equal(question);
      expect(generate.lastCall.args[2]).to.include('ANSWER THE CURRENT MESSAGE');
      expect(generate.lastCall.args[2]).to.not.include('Never give tips/advice on the first turn');
    }
  });

  it('retries a generic Hindi greeting before saving the reply to a specific question', async () => {
    generate.onFirstCall().resolves('नमस्ते! अगर आप किसी विशेष विषय पर बात करना चाहते हैं या कोई समस्या है जिसमें मदद चाहिए, तो कृपया बताएं। मैं आपकी सहायता करने की पूरी कोशिश करूंगा।');
    generate.onSecondCall().resolves('कमज़ोरी कब से महसूस हो रही है?');
    const result = await send({ message: 'mujhe aaj bht jada weekness lag rhi hai', language: 'hi-IN' }, { _id: 'user' });
    expect(generate.calledTwice).to.equal(true);
    expect(result.aiResponse).to.equal('कमज़ोरी कब से महसूस हो रही है?');
    expect(turns).to.have.length(1);
  });

  it('does not save or charge a turn when both attempts only return a generic greeting', async () => {
    sinon.stub(console, 'error');
    generate.resolves('Hello! How can I help you today?');
    const res = response();
    await chatWithAI({ user: { _id: 'user' }, body: {
      message: 'Hi, I feel very weak today', language: 'en-IN',
    } }, res);
    expect(res.statusCode).to.equal(500);
    expect(generate.calledTwice).to.equal(true);
    expect(turns).to.have.length(0);
  });

  it('counts mixed-language questions together and answers the fifth before the consultant handoff', async () => {
    const opening = await send({ kind: 'opening', language: 'hi-IN' }, { _id: 'user' });
    for (let index = 0; index < 5; index++) {
      const result = await send({ sessionId: opening.sessionId, language: index < 3 ? 'hi-IN' : 'en-IN', message: `How can I focus better today ${index}?` }, { _id: 'user' });
      expect(result.userMessageCount).to.equal(index + 1);
      expect(result.remainingMessages).to.equal(4 - index);
      expect(result.aiResponse).to.include(`Answer to: How can I focus better today ${index}?`);
    }
    const res = response();
    await chatWithAI({ user: { _id: 'user' }, body: { sessionId: 'different-language-session', language: 'ta-IN', message: 'How do I focus?' } }, res);
    expect(res.statusCode).to.equal(403);
    expect(res.body.code).to.equal('AI_CHAT_LIMIT_REACHED');
    expect(res.body.data.chatLimitReached).to.equal(true);
    expect(generate.callCount).to.equal(5);
    expect(turns.filter(turn => turn.userMessage)).to.have.length(5);
  });

  it('an opening request cannot clear the limit metadata after a language switch', async () => {
    for (let index = 0; index < 5; index++) turns.push({ sessionId: 'old', userId: 'user', userMessage: 'Earlier question', createdAt: new Date() });
    const result = await send({ kind: 'opening', language: 'hi-IN' }, { _id: 'user' });
    expect(result.chatLimitReached).to.equal(true);
    expect(result.remainingMessages).to.equal(0);
    expect(result.userMessageCount).to.equal(5);
    expect(generate.called).to.equal(false);
  });
});
