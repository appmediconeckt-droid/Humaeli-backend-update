import { expect } from "chai";
import sinon from "sinon";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { googleAuth } from "../src/controllers/authController.js";
import User from "../src/models/userModel.js";
import Session from "../src/models/sessionModel.js";

const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, cookie: sinon.spy() });
const account = role => ({ _id: "account-test", role, email: "role-test@example.com", googleId: "google-sub-test", isActive: true, profileCompleted: true, save: sinon.stub().resolves(), toJSON() { return { _id: this._id, role: this.role }; } });
const request = role => ({ body: { idToken: "verified-by-test-stub", role }, headers: {} });

describe("Google authentication role boundaries", () => {
  beforeEach(() => {
    sinon.stub(OAuth2Client.prototype, "verifyIdToken").resolves({ getPayload: () => ({ sub: "google-sub-test", email: "role-test@example.com", email_verified: true, name: "Test account" }) });
    sinon.stub(User, "findOne").resolves(null);
    sinon.stub(User, "create").callsFake(async data => Object.assign(account(data.role), data));
    sinon.stub(User, "findByIdAndUpdate").resolves({});
    sinon.stub(Session, "updateMany").resolves({});
    sinon.stub(Session, "create").resolves({});
  });
  afterEach(() => sinon.restore());
  for (const actual of ["user", "doctor", "counsellor"]) {
    for (const selected of ["user", "doctor", "counsellor"]) {
      it(`${actual} account through ${selected} portal`, async () => {
        const user = account(actual); User.findOne.resolves(user);
        const res = response(); await googleAuth(request(selected), res);
        expect(res.statusCode).to.equal(actual === selected ? 200 : 403);
        expect(User.create.called).to.equal(false);
        expect(user.role).to.equal(actual);
        if (actual === selected) {
          expect(res.body.role).to.equal(actual);
          expect(jwt.decode(res.body.accessToken).role).to.equal(actual);
          expect(Session.create.calledOnce).to.equal(true);
        } else {
          expect(res.body).to.include({ code: "ROLE_MISMATCH", actualRole: actual, requestedRole: selected });
          expect(user.save.called).to.equal(false);
          expect(Session.updateMany.called).to.equal(false);
          expect(Session.create.called).to.equal(false);
          expect(res.cookie.called).to.equal(false);
        }
      });
    }
    it(`new Google signup preserves ${actual} role`, async () => {
      const res = response(); await googleAuth(request(actual), res);
      expect(res.statusCode).to.equal(200);
      expect(User.create.firstCall.args[0].role).to.equal(actual);
      expect(res.body.role).to.equal(actual);
    });
  }
  for (const selected of ["Doctor", " doctor ", "counselor", "consultant"]) {
    it(`normalizes ${selected}`, async () => {
      const role = selected.trim().toLowerCase() === "doctor" ? "doctor" : "counsellor";
      User.findOne.resolves(account(role));
      const res = response(); await googleAuth(request(selected), res);
      expect(res.statusCode).to.equal(200);
      expect(res.body.role).to.equal(role);
    });
  }
  it("rejects unknown roles instead of bypassing validation", async () => {
    const res = response(); await googleAuth(request("doctro"), res);
    expect(res.statusCode).to.equal(400);
    expect(res.body.code).to.equal("INVALID_ROLE");
    expect(User.findOne.called).to.equal(false);
    expect(Session.create.called).to.equal(false);
  });
  it("does not link Google to a local account with a different role", async () => {
    const user = account("counsellor"); user.googleId = null;
    User.findOne.onFirstCall().resolves(null); User.findOne.onSecondCall().resolves(user);
    const res = response(); await googleAuth(request("doctor"), res);
    expect(res.statusCode).to.equal(403);
    expect(user.googleId).to.equal(null);
    expect(user.save.called).to.equal(false);
  });
  for (const role of [undefined, null, "", "auto", "admin"]) {
    it(`rejects missing or non-portal role ${role} before lookup or session creation`, async () => {
      const res = response(); await googleAuth(request(role), res);
      expect(res.statusCode).to.equal(400);
      expect(User.findOne.called).to.equal(false);
      expect(User.create.called).to.equal(false);
      expect(Session.create.called).to.equal(false);
    });
  }
  for (const firstRole of ["user", "counsellor", "doctor"]) {
    it(`email registered as ${firstRole} cannot sign up again under either other role`, async () => {
      let saved;
      User.create.callsFake(async data => { saved = Object.assign(account(data.role), data); return saved; });
      User.findOne.callsFake(async () => saved || null);
      const signup = response(); await googleAuth(request(firstRole), signup);
      expect(signup.statusCode).to.equal(200);
      for (const otherRole of ["user", "counsellor", "doctor"].filter(role => role !== firstRole)) {
        const res = response(); await googleAuth(request(otherRole), res);
        expect(res.statusCode).to.equal(403);
        expect(res.body).to.include({ code: "ROLE_MISMATCH", actualRole: firstRole, requestedRole: otherRole });
        expect(res.cookie.called).to.equal(false);
      }
      expect(User.create.calledOnce).to.equal(true);
      expect(Session.create.calledOnce).to.equal(true);
      expect(Session.updateMany.calledOnce).to.equal(true);
      expect(saved.role).to.equal(firstRole);
      const login = response(); await googleAuth(request(firstRole), login);
      expect(login.statusCode).to.equal(200);
      expect(login.body.role).to.equal(firstRole);
    });
  }
});
