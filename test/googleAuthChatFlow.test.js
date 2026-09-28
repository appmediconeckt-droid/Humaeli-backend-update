// Integration test: brand-new user signs up via Google → sends chat request
// → existing counsellor accepts within 30s. Verifies the full flow that the
// user originally reported as broken.
//
// We don't have a real Google idToken so we stub OAuth2Client.prototype
// .verifyIdToken to return a synthetic payload. Everything else (DB writes,
// session creation, controller behavior) runs for real against the .env DB.

import { expect } from "chai";
import mongoose from "mongoose";
import sinon from "sinon";
import dotenv from "dotenv";
import dns from "dns";
import { OAuth2Client } from "google-auth-library";
import otpService from "../src/services/otpService.js";

dns.setServers(["8.8.8.8", "1.1.1.1"]);
dotenv.config();

import connectDB from "../src/config/db.js";
import User from "../src/models/userModel.js";
import Chat from "../src/models/Chat.js";
import Message from "../src/models/Message.js";
import Session from "../src/models/sessionModel.js";
import { googleAuth, relinkGoogleAccount } from "../src/controllers/authController.js";
import { sendUnlinkGoogleOtp, unlinkGoogleAccount } from "../src/controllers/authController.js";
import {
  startChat,
  acceptChat,
} from "../src/controllers/messageController.js";

const TEST_TAG = "__googleAuthChatTest__";

function makeRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.cookies = {};
  res.status = function (code) {
    this.statusCode = code;
    return this;
  };
  res.json = function (payload) {
    this.body = payload;
    return this;
  };
  res.cookie = function (name, value, opts) {
    this.cookies[name] = { value, opts };
    return this;
  };
  return res;
}

(process.env.MYSQL_TEST_DATABASE ? describe : describe.skip)("Google auth → chat request → counsellor accept (free chat)", function () {
  this.timeout(30000);

  let verifyStub;
  let counsellor;
  let uniq;
  let previousPaidSetting;

  before(async () => {
    previousPaidSetting = process.env.PAID_COUNSELOR_SESSIONS_ENABLED;
    process.env.PAID_COUNSELOR_SESSIONS_ENABLED = "false";
    await connectDB();
  });

  beforeEach(async () => {
    uniq = Date.now() + "-" + Math.random().toString(36).slice(2, 8);

    // Pre-existing counsellor the new user will message. Marked as
    // google-signup so the counsellor-only required fields aren't enforced.
    counsellor = await User.create({
      fullName: `${TEST_TAG} counsellor ${uniq}`,
      email: `test-counsellor-${uniq}@gchatflow.test`,
      googleId: `gid-counsellor-${uniq}`,
      authProvider: "google",
      role: "counsellor",
      profileCompleted: true, qualification: "MSc Psychology", experience: 2, specialization: ["Stress"],
      isActive: true,
      locationData: {
        current: { type: "Point", coordinates: [77.5946, 12.9716] },
      },
    });

    // Stub Google's token verification so we don't need a real idToken.
    verifyStub = sinon.stub(OAuth2Client.prototype, "verifyIdToken");
  });

  afterEach(async () => {
    if (verifyStub) verifyStub.restore();

    // Clean up everything tagged by this test
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
      await Session.deleteMany({ userId: { $in: ids } });
      await User.deleteMany({ _id: { $in: ids } });
    }
  });

  after(async () => {
    await mongoose.disconnect();
    if (previousPaidSetting === undefined) delete process.env.PAID_COUNSELOR_SESSIONS_ENABLED;
    else process.env.PAID_COUNSELOR_SESSIONS_ENABLED = previousPaidSetting;
  });

  it("new Google user signs up, sends chat request, counsellor accepts — full flow works", async () => {
    const googleEmail = `gtest-${uniq}@gchatflow.test`;
    const googleSub = `gsub-${uniq}`;

    // Step 1: Google verifies the idToken and returns the user's profile.
    verifyStub.resolves({
      getPayload: () => ({
        email: googleEmail,
        email_verified: true,
        sub: googleSub,
        name: `${TEST_TAG} newuser ${uniq}`,
        picture: "https://example.test/avatar.png",
      }),
    });

    // Step 2: User hits POST /api/auth/google with role=user
    const authReq = {
      body: { idToken: "fake-google-id-token", role: "user" },
      headers: {},
    };
    const authRes = makeRes();
    await googleAuth(authReq, authRes);

    expect(authRes.statusCode, "google auth status").to.equal(200);
    expect(authRes.body).to.have.property("success", true);
    expect(authRes.body).to.have.property("isNewUser", true);
    expect(authRes.body).to.have.property("accessToken").that.is.a("string");
    expect(authRes.body.user).to.have.property("email", googleEmail);
    expect(authRes.body.user).to.have.property("role", "user");

    const newUserId = authRes.body.user._id || authRes.body.user.id;
    expect(newUserId, "new user id present").to.exist;

    // Verify the user actually exists in DB with googleId set
    const persistedUser = await User.findById(newUserId);
    expect(persistedUser).to.exist;
    expect(persistedUser.googleId).to.equal(googleSub);
    expect(persistedUser.authProvider).to.equal("google");

    // Step 3: New user sends chat request to the counsellor
    const startReq = {
      user: { _id: persistedUser._id, role: "user" },
      body: { counselorId: counsellor._id },
    };
    const startRes = makeRes();
    await startChat(startReq, startRes);

    expect(startRes.statusCode, "start chat status").to.equal(200);
    expect(startRes.body).to.have.property("success", true);
    expect(startRes.body.chat).to.have.property("expiresAt");

    expect(startRes.body.chat.expiresAt).to.equal(null);

    const chatId = startRes.body.chat.id;

    // Step 4: Counsellor accepts the request
    const acceptReq = {
      user: { _id: counsellor._id, role: "counsellor" },
      params: { chatId: String(chatId) },
    };
    const acceptRes = makeRes();
    await acceptChat(acceptReq, acceptRes);

    expect(acceptRes.statusCode, "accept status").to.equal(200);
    expect(acceptRes.body).to.have.property("success", true);
    expect(acceptRes.body.chat).to.have.property("status", "accepted");
    expect(acceptRes.body.chat.user.id.toString()).to.equal(
      persistedUser._id.toString(),
    );
  });

  it("returning Google user (second login) reuses existing account, not creates duplicate", async () => {
    const googleEmail = `greturning-${uniq}@gchatflow.test`;
    const googleSub = `gsub-returning-${uniq}`;

    verifyStub.resolves({
      getPayload: () => ({
        email: googleEmail,
        email_verified: true,
        sub: googleSub,
        name: `${TEST_TAG} returning ${uniq}`,
        picture: null,
      }),
    });

    // First call — creates user
    const firstReq = { body: { idToken: "tok1", role: "user" }, headers: {} };
    const firstRes = makeRes();
    await googleAuth(firstReq, firstRes);
    expect(firstRes.statusCode).to.equal(200);
    const firstUserId = firstRes.body.user._id || firstRes.body.user.id;

    // Clear the session created by the first call so the second call doesn't
    // hit the "Already login" guard (one-device policy).
    await Session.deleteMany({ userId: firstUserId });

    // Second call with same Google identity
    const secondReq = { body: { idToken: "tok2", role: "user" }, headers: {} };
    const secondRes = makeRes();
    await googleAuth(secondReq, secondRes);

    expect(secondRes.statusCode, "second login status").to.equal(200);
    expect(secondRes.body).to.have.property("success", true);
    const secondUserId = secondRes.body.user._id || secondRes.body.user.id;

    // Same user id — not a duplicate
    expect(secondUserId.toString()).to.equal(firstUserId.toString());

    const userCount = await User.countDocuments({ email: googleEmail });
    expect(userCount, "exactly one user for this email").to.equal(1);
  });

  it("Google-linked account keeps login working when Google email changes (sync googleEmail + optional profile email sync)", async () => {
    const googleSub = `gsub-sync-${uniq}`;
    const oldEmail = `old-email-${uniq}@gchatflow.test`;

    const user = await User.create({
      fullName: `${TEST_TAG} sync ${uniq}`,
      email: oldEmail,
      googleEmail: oldEmail,
      googleId: googleSub,
      authProvider: "google",
      role: "user",
      isActive: true,
      isEmailVerified: true,
      locationData: {
        current: { type: "Point", coordinates: [0, 0] },
        history: [],
      },
    });

    await Session.deleteMany({ userId: user._id });
    const newGoogleEmail = `new-email-${uniq}@gchatflow.test`;
    verifyStub.resolves({
      getPayload: () => ({
        email: newGoogleEmail,
        email_verified: true,
        sub: googleSub,
        name: `${TEST_TAG} sync ${uniq}`,
        picture: null,
      }),
    });

    const req = { body: { idToken: "tok-sync", role: "user" }, headers: {} };
    const res = makeRes();
    await googleAuth(req, res);

    expect(res.statusCode).to.equal(200);
    expect(res.body).to.have.property("success", true);
    const refreshed = await User.findById(user._id);
    expect(refreshed).to.exist;
    expect(refreshed.googleId).to.equal(googleSub);
    expect(refreshed.googleEmail).to.equal(newGoogleEmail);
    // Because profile email mirrored Google before, it should update too.
    expect(refreshed.email).to.equal(newGoogleEmail);
  });
  it("relink Google account updates googleId and blocks old Google from logging in", async () => {
    const oldGoogleSub = `gsub-old-${uniq}`;
    const newGoogleSub = `gsub-new-${uniq}`;
    const oldGoogleEmail = `old-google-${uniq}@gchatflow.test`;
    const newGoogleEmail = `new-google-${uniq}@gchatflow.test`;

    const user = await User.create({
      fullName: `${TEST_TAG} relink ${uniq}`,
      email: oldGoogleEmail,
      googleEmail: oldGoogleEmail,
      googleId: oldGoogleSub,
      authProvider: "google",
      role: "user",
      isActive: true,
      isEmailVerified: true,
      locationData: {
        current: { type: "Point", coordinates: [0, 0] },
        history: [],
      },
    });

    await Session.deleteMany({ userId: user._id });

    // Relink call uses verifyIdToken once.
    verifyStub.onCall(0).resolves({
      getPayload: () => ({
        email: newGoogleEmail,
        email_verified: true,
        sub: newGoogleSub,
        name: `${TEST_TAG} relink ${uniq}`,
        picture: null,
      }),
    });

    const relinkReq = {
      user,
      body: { idToken: "tok-relink" },
      headers: {},
    };
    const relinkRes = makeRes();
    await relinkGoogleAccount(relinkReq, relinkRes);

    expect(relinkRes.statusCode).to.equal(200);
    expect(relinkRes.body).to.have.property("success", true);

    const afterRelink = await User.findById(user._id);
    expect(afterRelink.googleId).to.equal(newGoogleSub);
    expect(afterRelink.googleEmail).to.equal(newGoogleEmail);

    await Session.deleteMany({ userId: user._id });
    verifyStub.onCall(1).resolves({
      getPayload: () => ({
        email: oldGoogleEmail,
        email_verified: true,
        sub: oldGoogleSub,
        name: `${TEST_TAG} relink ${uniq}`,
        picture: null,
      }),
    });

    const oldLoginReq = { body: { idToken: "tok-old", role: "user" }, headers: {} };
    const oldLoginRes = makeRes();
    await googleAuth(oldLoginReq, oldLoginRes);

    expect([200, 409]).to.include(oldLoginRes.statusCode);
    if (oldLoginRes.statusCode === 409) {
      expect(oldLoginRes.body).to.have.property("code", "GOOGLE_ID_MISMATCH");
    } else {
      const oldLoggedInId = oldLoginRes.body.user._id || oldLoginRes.body.user.id;
      expect(oldLoggedInId.toString()).to.not.equal(user._id.toString());
    }

    // And login with the NEW Google identity works and reuses the same user.
    await Session.deleteMany({ userId: user._id });
    verifyStub.onCall(2).resolves({
      getPayload: () => ({
        email: newGoogleEmail,
        email_verified: true,
        sub: newGoogleSub,
        name: `${TEST_TAG} relink ${uniq}`,
        picture: null,
      }),
    });

    const newLoginReq = { body: { idToken: "tok-new", role: "user" }, headers: {} };
    const newLoginRes = makeRes();
    await googleAuth(newLoginReq, newLoginRes);

    expect(newLoginRes.statusCode).to.equal(200);
    expect(newLoginRes.body).to.have.property("success", true);
    const loggedInId = newLoginRes.body.user._id || newLoginRes.body.user.id;
    expect(loggedInId.toString()).to.equal(user._id.toString());
  });

  it("unlink Google account requires OTP and clears googleId", async () => {
    const googleSub = `gsub-unlink-${uniq}`;
    const email = `unlink-${uniq}@gchatflow.test`;

    const user = await User.create({
      fullName: `${TEST_TAG} unlink ${uniq}`,
      email,
      googleEmail: email,
      googleId: googleSub,
      authProvider: "google",
      role: "user",
      isActive: true,
      isEmailVerified: true,
      // ensure unlink is allowed
      password: "hashed-placeholder",
      phoneNumber: "9999999999",
      locationData: {
        current: { type: "Point", coordinates: [0, 0] },
        history: [],
      },
    });

    // Stub OTP email send
    const otpStub = sinon.stub(otpService, "sendLoginOTP").resolves();
    const genStub = sinon.stub(otpService, "generateOTP").returns("123456");

    const sendReq = { user, body: {}, headers: {} };
    const sendRes = makeRes();
    await sendUnlinkGoogleOtp(sendReq, sendRes);
    expect(sendRes.statusCode).to.equal(200);

    const unlinkReq = { user, body: { otp: "123456" }, headers: {} };
    const unlinkRes = makeRes();
    await unlinkGoogleAccount(unlinkReq, unlinkRes);
    expect(unlinkRes.statusCode).to.equal(200);

    const refreshed = await User.findById(user._id);
    expect(refreshed.googleId).to.not.exist;
    expect(refreshed.googleEmail).to.equal(null);
    expect(refreshed.authProvider).to.equal("local");

    genStub.restore();
    otpStub.restore();
  });

  it("Google auth with role mismatch is rejected with 403", async () => {
    // Counsellor signs up first via Google
    const counsEmail = `gmismatch-${uniq}@gchatflow.test`;
    const counsSub = `gsub-mismatch-${uniq}`;

    verifyStub.resolves({
      getPayload: () => ({
        email: counsEmail,
        email_verified: true,
        sub: counsSub,
        name: `${TEST_TAG} mismatch ${uniq}`,
        picture: null,
      }),
    });

    const firstReq = {
      body: { idToken: "tok-c", role: "counsellor" },
      headers: {},
    };
    const firstRes = makeRes();
    await googleAuth(firstReq, firstRes);
    expect(firstRes.statusCode).to.equal(200);
    const firstUserId = firstRes.body.user._id || firstRes.body.user.id;
    await Session.deleteMany({ userId: firstUserId });

    // Same email tries to log in as "user" — should be refused
    const secondReq = {
      body: { idToken: "tok-c2", role: "user" },
      headers: {},
    };
    const secondRes = makeRes();
    await googleAuth(secondReq, secondRes);

    expect(secondRes.statusCode).to.equal(403);
    expect(secondRes.body).to.have.property("code", "ROLE_MISMATCH");
    expect(secondRes.body).to.have.property("actualRole", "counsellor");
  });

  it("invalid Google token returns 401", async () => {
    verifyStub.rejects(new Error("Invalid token"));

    const req = {
      body: { idToken: "bogus", role: "user" },
      headers: {},
    };
    const res = makeRes();
    await googleAuth(req, res);

    expect(res.statusCode).to.equal(401);
    expect(res.body).to.have.property("success", false);
    expect(res.body.message).to.match(/invalid google token/i);
  });
});
