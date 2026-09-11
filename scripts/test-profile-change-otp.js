import connectDB from "../src/config/db.js";
// scripts/test-profile-change-otp.js
//
// End-to-end test for the new profile-change OTP flow:
//   1. Create / find a throwaway test user via verifiedUsersStore + signup
//      isn't easy from outside, so we INSERT a user directly via mongoose,
//      mint a JWT, and call the endpoints with it.
//   2. POST /profile-change/send-otp { field: "email", newValue }
//      -> server returns devOtp in non-production
//   3. POST /profile-change/verify-otp { field, newValue, otp }
//      -> server moves entry into verifiedProfileChanges
//   4. PATCH /update/:userId { email: newValue }
//      -> server consumes the verified entry and updates the user
//   5. Re-fetch the user and assert the email is the new one
//   6. Negative path: try to PATCH /update with a NEW email that was
//      never verified -> server must reject with 403
//
// Run: node scripts/test-profile-change-otp.js
// Exits 0 on pass, 1 on any failure.

import "dotenv/config";
import dns from "node:dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);

import mongoose from "../src/persistence/mongoose.js";
import jwt from "jsonwebtoken";
import http from "http";
import User from "../src/models/userModel.js";
import Session from "../src/models/sessionModel.js";

const PORT = process.env.PORT || 5000;
const BASE = `http://localhost:${PORT}/api/auth`;
const ACCESS_SECRET = process.env.ACCESS_SECRET;


if (!ACCESS_SECRET) {
  console.error("ACCESS_SECRET missing in .env");
  process.exit(1);
}

const log = (ok, msg) => {
  const tag = ok ? "✅ PASS" : "❌ FAIL";
  console.log(`${tag}  ${msg}`);
  return ok;
};

const request = (method, path, body, token) =>
  new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${path}`);
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode,
              body: chunks ? JSON.parse(chunks) : null,
            });
          } catch (e) {
            resolve({ status: res.statusCode, body: chunks });
          }
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });

let allOk = true;
let userId;
let sessionId;

await connectDB();
console.log("Connected to MongoDB\n");

const stamp = Date.now();
const ORIG_EMAIL = `otp-test-${stamp}@example.com`;
const ORIG_PHONE = String(stamp).slice(-10);
const NEW_EMAIL = `otp-test-${stamp}-new@example.com`;
const NEW_PHONE = String(stamp + 1).slice(-10);

try {
  // Create a throwaway user directly so we don't need the OTP signup flow.
  const created = await User.create({
    fullName: "OTP Test User",
    email: ORIG_EMAIL,
    phoneNumber: ORIG_PHONE,
    password: "placeholderHashedPasswordForTestOnly",
    age: 30,
    gender: "male",
    role: "user",
    profileCompleted: true,
    isEmailVerified: true,
    isPhoneVerified: true,
    isActive: true,
    // Required to satisfy the 2dsphere index on locationData.current.
    locationData: {
      current: {
        type: "Point",
        coordinates: [77.2090, 28.6139], // Delhi — arbitrary, just valid
        address: "Test",
        city: "Test",
        state: "Test",
        country: "IN",
        ipAddress: "127.0.0.1",
      },
      isVerified: false,
      history: [],
    },
  });
  userId = created._id.toString();
  console.log(`Created test user ${userId} (${ORIG_EMAIL})\n`);

  // authMiddleware verifies that the JWT's sessionId still exists in the
  // Session collection and is active, so we have to create one too.
  const session = await Session.create({
    userId,
    refreshToken: `test-refresh-${stamp}-${Math.random().toString(36).slice(2)}`,
    isActive: true,
  });
  sessionId = session._id.toString();

  const token = jwt.sign(
    { userId, sessionId, role: "user" },
    ACCESS_SECRET,
    { expiresIn: "1h" },
  );

  // ─── HAPPY PATH: email change ─────────────────────────────────────────
  console.log("--- Email change happy path ---");
  let r = await request(
    "POST",
    "/profile-change/send-otp",
    { field: "email", newValue: NEW_EMAIL },
    token,
  );
  allOk &= log(r.status === 200, `send-otp(email) status 200 (got ${r.status})`);
  allOk &= log(!!r.body?.success, "send-otp(email) returns success");
  const emailOtp = r.body?.devOtp;
  allOk &= log(!!emailOtp, "send-otp(email) returns devOtp in dev mode");

  r = await request(
    "POST",
    "/profile-change/verify-otp",
    { field: "email", newValue: NEW_EMAIL, otp: emailOtp },
    token,
  );
  allOk &= log(
    r.status === 200,
    `verify-otp(email) status 200 (got ${r.status}) — ${r.body?.message || ""}`,
  );

  r = await request(
    "PATCH",
    `/update/${userId}`,
    { email: NEW_EMAIL },
    token,
  );
  allOk &= log(
    r.status === 200,
    `PATCH /update with verified email -> 200 (got ${r.status}) — ${r.body?.message || ""}`,
  );

  const fresh = await User.findById(userId).lean();
  allOk &= log(
    fresh.email === NEW_EMAIL,
    `DB email is now NEW_EMAIL (got "${fresh.email}")`,
  );

  // ─── NEGATIVE: try changing email again without re-verifying ──────────
  console.log("\n--- Negative: unverified email change must be rejected ---");
  const UNVERIFIED_EMAIL = `otp-test-${stamp}-hacker@example.com`;
  r = await request(
    "PATCH",
    `/update/${userId}`,
    { email: UNVERIFIED_EMAIL },
    token,
  );
  allOk &= log(
    r.status === 403,
    `PATCH /update with unverified email -> 403 (got ${r.status})`,
  );
  allOk &= log(
    typeof r.body?.message === "string" && /verify/i.test(r.body.message),
    `rejection message mentions verification (got "${r.body?.message || ""}")`,
  );
  const afterReject = await User.findById(userId).lean();
  allOk &= log(
    afterReject.email === NEW_EMAIL,
    `DB email unchanged after reject (still "${afterReject.email}")`,
  );

  // ─── NEGATIVE: wrong OTP ──────────────────────────────────────────────
  console.log("\n--- Negative: wrong OTP rejected ---");
  r = await request(
    "POST",
    "/profile-change/send-otp",
    { field: "email", newValue: UNVERIFIED_EMAIL },
    token,
  );
  allOk &= log(r.status === 200, "send-otp for second attempt OK");

  r = await request(
    "POST",
    "/profile-change/verify-otp",
    { field: "email", newValue: UNVERIFIED_EMAIL, otp: "000000" },
    token,
  );
  allOk &= log(r.status === 400, `wrong OTP -> 400 (got ${r.status})`);

  // Even after wrong-OTP attempt, save without verify should still fail.
  r = await request(
    "PATCH",
    `/update/${userId}`,
    { email: UNVERIFIED_EMAIL },
    token,
  );
  allOk &= log(
    r.status === 403,
    `PATCH still 403 after wrong-OTP attempt (got ${r.status})`,
  );

  // ─── HAPPY PATH: phone change (skip if Twilio not configured) ─────────
  console.log("\n--- Phone change happy path ---");
  r = await request(
    "POST",
    "/profile-change/send-otp",
    { field: "phone", newValue: NEW_PHONE },
    token,
  );
  if (r.status === 503) {
    console.log("⚠️  SKIP — Twilio not configured for SMS, phone test skipped");
  } else {
    allOk &= log(
      r.status === 200,
      `send-otp(phone) status 200 (got ${r.status})`,
    );
    const phoneOtp = r.body?.devOtp;
    if (!phoneOtp) {
      console.log(
        "⚠️  No devOtp returned (Twilio actually sent the SMS). Skipping verify step in automated test.",
      );
    } else {
      r = await request(
        "POST",
        "/profile-change/verify-otp",
        { field: "phone", newValue: NEW_PHONE, otp: phoneOtp },
        token,
      );
      allOk &= log(r.status === 200, "verify-otp(phone) status 200");

      r = await request(
        "PATCH",
        `/update/${userId}`,
        { phoneNumber: NEW_PHONE },
        token,
      );
      allOk &= log(
        r.status === 200,
        `PATCH /update with verified phone -> 200 (got ${r.status})`,
      );

      const afterPhone = await User.findById(userId).lean();
      allOk &= log(
        afterPhone.phoneNumber === NEW_PHONE,
        `DB phone is now NEW_PHONE (got "${afterPhone.phoneNumber}")`,
      );
    }
  }

  // ─── NEUTRAL: fields other than email/phone update freely ────────────
  console.log("\n--- Other fields update without OTP (control test) ---");
  r = await request(
    "PATCH",
    `/update/${userId}`,
    { fullName: "OTP Test User Renamed" },
    token,
  );
  allOk &= log(
    r.status === 200,
    `PATCH /update with non-protected field -> 200 (got ${r.status})`,
  );
  const renamed = await User.findById(userId).lean();
  allOk &= log(
    renamed.fullName === "OTP Test User Renamed",
    `fullName updated (got "${renamed.fullName}")`,
  );
} catch (err) {
  log(false, `Test threw: ${err.message}`);
  allOk = false;
} finally {
  // Cleanup — delete the throwaway user + session.
  if (sessionId) {
    try {
      await Session.findByIdAndDelete(sessionId);
    } catch {}
  }
  if (userId) {
    try {
      await User.findByIdAndDelete(userId);
      console.log(`\nCleaned up test user ${userId}`);
    } catch (e) {
      console.warn(`Cleanup failed: ${e.message}`);
    }
  }
  await mongoose.disconnect();
}

console.log("");
if (allOk) {
  console.log("🎉 Profile-change OTP flow works end-to-end.");
  process.exit(0);
} else {
  console.log("💥 Some assertions failed. See log above.");
  process.exit(1);
}
