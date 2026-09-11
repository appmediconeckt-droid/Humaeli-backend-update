import { expect } from "chai";
import sinon from "sinon";
import mongoose from "mongoose";
import ChatSession from "../src/models/ChatSession.js";
import User from "../src/models/userModel.js";
import {
  activatePaidSession,
  startTimedChatUsage,
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
});
