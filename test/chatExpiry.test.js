// MySQL integration tests for current free-chat request and cancellation behavior.
//
// These tests call the controller functions directly (no Express HTTP layer)
// and use an explicitly selected test database. Every doc created here
// is tagged with TEST_TAG in fullName so afterEach can clean up safely
// without touching real user/chat data.

import { expect } from "chai";
import mongoose from "mongoose";
import dotenv from "dotenv";
import dns from "dns";

// Force Google DNS for SRV lookups — the default Windows resolver
// intermittently refuses _mongodb._tcp SRV queries on this machine.
dns.setServers(["8.8.8.8", "1.1.1.1"]);

dotenv.config();

import connectDB from "../src/config/db.js";
import User from "../src/models/userModel.js";
import Chat from "../src/models/Chat.js";
import Message from "../src/models/Message.js";
import {
  startChat,
  acceptChat,
} from "../src/controllers/messageController.js";

const TEST_TAG = "__chatExpiryTest__";

function makeRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.status = function (code) {
    this.statusCode = code;
    return this;
  };
  res.json = function (payload) {
    this.body = payload;
    return this;
  };
  return res;
}

(process.env.MYSQL_TEST_DATABASE ? describe : describe.skip)("Free chat requests and cancellation", function () {
  this.timeout(20000);

  let user;
  let counselor;
  let previousPaidSetting;

  before(async () => {
    previousPaidSetting = process.env.PAID_COUNSELOR_SESSIONS_ENABLED;
    process.env.PAID_COUNSELOR_SESSIONS_ENABLED = "false";
    await connectDB();
  });

  beforeEach(async () => {
    // Unique emails so a hung previous run doesn't collide
    const uniq = Date.now() + "-" + Math.random().toString(36).slice(2, 8);

    // locationData.current is a GeoJSON Point with a 2dsphere index. The
    // schema default gives it { type: "Point" } with no coordinates which
    // the index rejects. Provide valid [lng, lat] coordinates.
    const coords = [77.5946, 12.9716]; // Bangalore — any valid point works

    user = await User.create({
      fullName: `${TEST_TAG} user ${uniq}`,
      email: `test-user-${uniq}@chatexpiry.test`,
      phoneNumber: `9${uniq.slice(-9).replace(/\D/g, "0").padStart(9, "0")}`,
      password: "testpass123",
      role: "user",
      isActive: true,
      locationData: { current: { type: "Point", coordinates: coords } },
    });

    // Counsellor-role local accounts require qualification/experience/etc.
    // We tag this user as a Google-signup so those fields aren't required —
    // the chat flow we're testing doesn't depend on them.
    counselor = await User.create({
      fullName: `${TEST_TAG} counselor ${uniq}`,
      email: `test-counselor-${uniq}@chatexpiry.test`,
      googleId: `gid-${uniq}`,
      authProvider: "google",
      role: "counsellor",
      profileCompleted: true, qualification: "MSc Psychology", experience: 2, specialization: ["Stress"],
      isActive: true,
      locationData: { current: { type: "Point", coordinates: coords } },
    });
  });

  afterEach(async () => {
    const userIds = [user?._id, counselor?._id].filter(Boolean);
    if (userIds.length) {
      const chats = await Chat.find({
        $or: [{ userId: { $in: userIds } }, { counselorId: { $in: userIds } }],
      });
      const chatIds = chats.map((c) => c._id);
      if (chatIds.length) await Message.deleteMany({ chatId: { $in: chatIds } });
      await Chat.deleteMany({ _id: { $in: chatIds } });
      await User.deleteMany({ _id: { $in: userIds } });
    }
  });

  after(async () => {
    // Belt-and-braces sweep in case a test crashed before afterEach
    const taggedUsers = await User.find({
      fullName: { $regex: TEST_TAG },
    }).select("_id");
    const ids = taggedUsers.map((u) => u._id);
    if (ids.length) {
      const chats = await Chat.find({
        $or: [{ userId: { $in: ids } }, { counselorId: { $in: ids } }],
      }).select("_id");
      const chatIds = chats.map((c) => c._id);
      if (chatIds.length) await Message.deleteMany({ chatId: { $in: chatIds } });
      await Chat.deleteMany({ _id: { $in: chatIds } });
      await User.deleteMany({ _id: { $in: ids } });
    }
    await mongoose.disconnect();
    if (previousPaidSetting === undefined) delete process.env.PAID_COUNSELOR_SESSIONS_ENABLED;
    else process.env.PAID_COUNSELOR_SESSIONS_ENABLED = previousPaidSetting;
  });

  it("startChat keeps free chat requests open without an expiry", async () => {
    const before = Date.now();
    const req = {
      user: { _id: user._id, role: "user" },
      body: { counselorId: counselor._id },
    };
    const res = makeRes();

    await startChat(req, res);

    expect(res.statusCode).to.equal(200);
    expect(res.body).to.have.property("success", true);
    expect(res.body.chat).to.have.property("expiresAt");

    expect(res.body.chat.expiresAt).to.equal(null);
  });

  it("counselor can accept a pending chat created moments ago (no 400 expired)", async () => {
    // Create a fresh request via the real startChat flow
    const startReq = {
      user: { _id: user._id, role: "user" },
      body: { counselorId: counselor._id },
    };
    const startRes = makeRes();
    await startChat(startReq, startRes);
    expect(startRes.statusCode).to.equal(200);

    const chatId = startRes.body.chat.id;

    // Counselor accepts immediately
    const acceptReq = {
      user: { _id: counselor._id, role: "counsellor" },
      params: { chatId: String(chatId) },
    };
    const acceptRes = makeRes();
    await acceptChat(acceptReq, acceptRes);

    expect(acceptRes.statusCode).to.equal(200);
    expect(acceptRes.body).to.have.property("success", true);
    expect(acceptRes.body.chat).to.have.property("status", "accepted");
  });

  it("counselor can accept a chat that is 20 seconds old (would have failed with old 10s logic)", async () => {
    // Manually create a chat with expiresAt = now + 10s (i.e. simulating a
    // request that was sent 20 seconds ago under the new 30s window).
    const expiresAt = new Date(Date.now() + 10 * 1000);
    const chat = await Chat.create({
      userId: user._id,
      counselorId: counselor._id,
      status: "pending",
      isActive: true,
      expiresAt,
      startedAt: new Date(Date.now() - 20 * 1000),
    });

    const acceptReq = {
      user: { _id: counselor._id, role: "counsellor" },
      params: { chatId: String(chat._id) },
    };
    const acceptRes = makeRes();
    await acceptChat(acceptReq, acceptRes);

    expect(acceptRes.statusCode).to.equal(200);
    expect(acceptRes.body.chat).to.have.property("status", "accepted");
  });

  it("counselor cannot accept an explicitly cancelled request", async () => {
    // Cancellation is persisted explicitly; free chats do not expire by time alone.
    const chat = await Chat.create({
      userId: user._id,
      counselorId: counselor._id,
      status: "cancelled",
      isActive: true,
      expiresAt: new Date(Date.now() - 1000),
      startedAt: new Date(Date.now() - 31 * 1000),
    });

    const acceptReq = {
      user: { _id: counselor._id, role: "counsellor" },
      params: { chatId: String(chat._id) },
    };
    const acceptRes = makeRes();
    await acceptChat(acceptReq, acceptRes);

    expect(acceptRes.statusCode).to.equal(400);
    expect(acceptRes.body).to.have.property("status", "expired");
    expect(acceptRes.body).to.have.property("canResend", true);

    const reloaded = await Chat.findById(chat._id);
    expect(reloaded.status).to.equal("cancelled");
  });

  it("new free-chat requests persist their greeting message", async () => {
    const req = {
      user: { _id: user._id, role: "user" },
      body: { counselorId: counselor._id },
    };
    const res = makeRes();
    await startChat(req, res);
    expect(res.statusCode).to.equal(200);

    const chatId = res.body.chat.id;
    const msgs = await Message.find({ chatId }).sort({ createdAt: 1 });
    expect(msgs.length).to.be.greaterThan(0);
    expect(msgs.some(message => /start a conversation/i.test(message.content))).to.equal(true);
    expect(msgs.some(message => /expire/i.test(message.content))).to.equal(false);
  });
});
