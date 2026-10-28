import { expect } from 'chai';
import sinon from 'sinon';
import User from '../src/models/userModel.js';
import Transaction from '../src/models/transactionModel.js';
import CounselorEarning from '../src/models/CounselorEarning.js';
import Notification from '../src/models/Notification.js';
import { chargeCallByDuration } from '../src/services/paidSessionService.js';

describe('Call wallet billing provider rules', () => {
  let previousEnvironment;
  const settings = { PAID_COUNSELOR_SESSIONS_ENABLED: 'true', COUNSELOR_VIDEO_FEE: '300', COUNSELOR_VOICE_FEE: '200', COUNSELOR_SESSION_DURATION_MINUTES: '30', PLATFORM_COMMISSION_PERCENT: '20' };
  const args = { callId: 'call-test', userId: 'patient', counselorId: 'provider', sessionType: 'video', durationSeconds: 120 };
  beforeEach(() => {
    previousEnvironment = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
    Object.assign(process.env, settings);
  });
  afterEach(() => {
    sinon.restore();
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  for (const provider of [{ role: 'doctor' }, { role: 'counsellor', accountType: 'doctor' }, { role: 'user' }, null]) {
    it(`never charges a non-counselor provider (${JSON.stringify(provider)}), including legacy doctor labels`, async () => {
      const userLookup = sinon.stub(User, 'findById').returns({ select: sinon.stub().resolves(provider) });
      const transactionLookup = sinon.stub(Transaction, 'findOne');
      const debit = sinon.stub(Transaction, 'create');
      const credit = sinon.stub(User, 'findByIdAndUpdate');
      const earning = sinon.stub(CounselorEarning, 'findOneAndUpdate');
      expect(await chargeCallByDuration(args)).to.equal(null);
      expect(userLookup.calledOnceWithExactly('provider')).to.equal(true);
      expect(transactionLookup.called || debit.called || credit.called || earning.called).to.equal(false);
    });
  }
  for (const role of ['counsellor', 'counselor']) {
    for (const sessionType of ['video', 'voice']) {
      it(`still bills ${sessionType} usage for a stored ${role} account and credits counselor earnings`, async () => {
        const user = { walletBalance: 100, save: sinon.stub().resolves() };
        const provider = { fullName: 'Counselor', role };
        sinon.stub(User, 'findById').callsFake(id => id === 'provider' ? { select: sinon.stub().resolves(provider) } : Promise.resolve(user));
        sinon.stub(Transaction, 'findOne').resolves(null);
        const debit = sinon.stub(Transaction, 'create').callsFake(async record => ({ _id: 'transaction', ...record }));
        const earning = sinon.stub(CounselorEarning, 'findOneAndUpdate').resolves({});
        const credit = sinon.stub(User, 'findByIdAndUpdate').resolves({});
        // Notification side effects stay local; no database or device is contacted.
        sinon.stub(Notification, 'create').rejects(new Error('Notifications disabled in billing test'));
        sinon.stub(console, 'error');
        const result = await chargeCallByDuration({ ...args, sessionType, durationSeconds: 180 });
        const expected = sessionType === 'video' ? 30 : 20;
        expect(result.amount).to.equal(expected);
        expect(user.walletBalance).to.equal(100 - expected);
        expect(user.save.calledOnce).to.equal(true);
        expect(debit.firstCall.args[0]).to.include({ amount: expected, type: 'debit', status: 'completed' });
        expect(earning.firstCall.args[1].$setOnInsert.earningAmount).to.equal(expected * 0.8);
        expect(credit.firstCall.args).to.deep.equal(['provider', { $inc: { walletBalance: expected * 0.8, totalSessions: 1 } }]);
      });
    }
  }
  it('does not debit a counselor call twice on a repeated settlement request', async () => {
    const transaction = { _id: 'existing', amount: 30 };
    sinon.stub(User, 'findById').callsFake(id => ({ select: sinon.stub().resolves(id === 'provider' ? { role: 'counsellor' } : { walletBalance: 70 }) }));
    sinon.stub(Transaction, 'findOne').resolves(transaction);
    const debit = sinon.stub(Transaction, 'create');
    const result = await chargeCallByDuration(args);
    expect(result).to.deep.equal({ transaction, amount: 30, walletBalance: 70 });
    expect(debit.called).to.equal(false);
  });
});
