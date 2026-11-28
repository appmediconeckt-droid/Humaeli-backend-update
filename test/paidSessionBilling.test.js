import { expect } from "chai";
import sinon from "sinon";
import mongoose from "../src/persistence/mongoose.js";
import ChatSession from "../src/models/ChatSession.js";
import User from "../src/models/userModel.js";
import CounselorEarning from "../src/models/CounselorEarning.js";
import Transaction from "../src/models/transactionModel.js";
import Notification from "../src/models/Notification.js";
import {
  activatePaidSession,
  startTimedChatUsage,
  stopTimedChatUsage,
  completePaidSession,
} from "../src/services/paidSessionService.js";

describe("paid counselor session billing gates", function () {
  let sandbox;
  let previousPaidSetting;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    previousPaidSetting = process.env.PAID_COUNSELOR_SESSIONS_ENABLED;
    process.env.PAID_COUNSELOR_SESSIONS_ENABLED = "true";
  });

  afterEach(function () {
    sandbox.restore();
    if (previousPaidSetting === undefined) {
      delete process.env.PAID_COUNSELOR_SESSIONS_ENABLED;
    } else {
      process.env.PAID_COUNSELOR_SESSIONS_ENABLED = previousPaidSetting;
    }
  });

  it("accepting a chat activates the session without marking payment paid", async function () {
    const session = {
      _id: new mongoose.Types.ObjectId(),
      sessionStatus: "pending",
      paymentStatus: "free",
      amount: 0,
      save: sandbox.stub().resolves(),
    };
    const chat = {
      paidSessionId: session._id,
      paymentStatus: "free",
      save: sandbox.stub().resolves(),
    };

    sandbox.stub(ChatSession, "findById").resolves(session);

    await activatePaidSession(chat);

    expect(session.sessionStatus).to.equal("active");
    expect(session.paymentStatus).to.equal("free");
    expect(chat.paymentStatus).to.equal("free");
    expect(session.save.calledOnce).to.equal(true);
    expect(chat.save.calledOnce).to.equal(true);
  });

  it("does not start timed chat billing from the public start path without a real message", async function () {
    const session = {
      _id: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(),
      sessionType: "chat",
      sessionStatus: "active",
      metadata: {},
    };
    const selectStub = sandbox.stub().resolves({ walletBalance: 250 });

    sandbox.stub(ChatSession, "findById").resolves(session);
    sandbox.stub(User, "findById").returns({ select: selectStub });

    const billing = await startTimedChatUsage({ paidSessionId: session._id });

    expect(billing).to.deep.equal({
      active: false,
      reason: "waiting_for_chat_activity",
      walletBalance: 250,
    });
    expect(session.activeSegmentStartedAt).to.equal(undefined);
  });

  it("records each charged chat segment separately without paying it again on completion", async function () {
    const now = Date.now();
    const userId = new mongoose.Types.ObjectId();
    const counselorId = new mongoose.Types.ObjectId();
    const session = {
      _id: new mongoose.Types.ObjectId(), userId, counselorId, chatId: new mongoose.Types.ObjectId(),
      sessionType: "chat", sessionStatus: "active", commissionRate: 20,
      ratePerMinute: 60, rateDurationMinutes: 30, amount: 0, billedSeconds: 0,
      activeSegmentStartedAt: new Date(now - 60000), lastBilledAt: new Date(now),
      metadata: { billingSegmentUserMessageCount: 2, billingSegmentCounselorMessageCount: 1 },
      markModified: sandbox.spy(), save: sandbox.stub().resolves(),
    };
    const chat = { paidSessionId: session._id, save: sandbox.stub().resolves() };
    const user = { walletBalance: 100, save: sandbox.stub().resolves() };
    user.select = () => {
      const result = Promise.resolve(user);
      result.lean = async () => ({});
      return result;
    };
    sandbox.stub(ChatSession, "findById").resolves(session);
    sandbox.stub(User, "findById").callsFake((id) => {
      if (String(id) === String(userId)) return user;
      return { select: () => {
        const result = Promise.resolve({ fullName: "Counselor" });
        result.lean = async () => ({});
        return result;
      } };
    });
    const credits = sandbox.stub(User, "findByIdAndUpdate").resolves();
    const transactions = sandbox.stub(Transaction, "create").callsFake(async () => ({ _id: new mongoose.Types.ObjectId() }));
    const earnings = [];
    sandbox.stub(CounselorEarning, "create").callsFake(async (entry) => { const row = { ...entry, _id: new mongoose.Types.ObjectId() }; earnings.push(row); return row; });
    sandbox.stub(CounselorEarning, "findOne").callsFake(async (query) => {
      expect(String(query.$or[1]["metadata.paidSessionId"])).to.equal(String(session._id));
      return earnings[0];
    });
    sandbox.stub(Notification, "create").resolves({ toObject: () => ({}) });

    await stopTimedChatUsage(chat, { endedAt: now });
    session.activeSegmentStartedAt = new Date(now - 120000);
    session.lastBilledAt = new Date(now);
    session.metadata = { billingSegmentUserMessageCount: 2, billingSegmentCounselorMessageCount: 1 };
    await stopTimedChatUsage(chat, { endedAt: now });
    expect(earnings.map(row => row.totalAmount)).to.deep.equal([2, 4]);
    expect(earnings.map(row => row.earningAmount)).to.deep.equal([1.6, 3.2]);
    expect(user.walletBalance).to.equal(94);
    expect(transactions.callCount).to.equal(2);
    expect(credits.callCount).to.equal(2);
    expect(String(earnings[0].transactionId)).not.to.equal(String(earnings[1].transactionId));
    expect(String(earnings[1].metadata.paidSessionId)).to.equal(String(session._id));
    await completePaidSession(chat);
    expect(earnings).to.have.length(2);
    expect(credits.callCount).to.equal(2);
  });
});
