import { expect } from "chai";
import sinon from "sinon";
import {
  sendEmailOTP,
  verifyEmailOTP,
} from "../src/controllers/authController.js";
import User from "../src/models/userModel.js";
import RegistrationOTP from "../src/models/registrationOtpModel.js";
import otpService from "../src/services/otpService.js";

describe("Registration email OTP controller", function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    process.env.ACCESS_SECRET = process.env.ACCESS_SECRET || "test-access-secret";
    sandbox.stub(RegistrationOTP, "create").resolves({});
    sandbox.stub(RegistrationOTP, "deleteMany").resolves({});
    sandbox.stub(RegistrationOTP, "exists").resolves(null);
    sandbox.stub(RegistrationOTP, "findOne").returns({
      sort: sinon.stub().returns({
        lean: sinon.stub().resolves(null),
      }),
    });
  });

  afterEach(function () {
    sandbox.restore();
  });

  const createRes = () => ({
    status: sinon.stub().returnsThis(),
    json: sinon.spy(),
  });

  const sendOtpFor = async (email, otp = "123456") => {
    sandbox.stub(User, "findOne").returns({
      select: sinon.stub().returns({
        lean: sinon.stub().resolves(null),
      }),
    });
    sandbox.stub(otpService, "generateOTP").returns(otp);
    sandbox.stub(otpService, "sendEmailOTP").resolves({ messageId: "test" });

    const req = { body: { email } };
    const res = createRes();

    await sendEmailOTP(req, res);

    expect(res.status.calledWith(200)).to.equal(true);
  };

  it("rejects an incorrect registration email OTP", async function () {
    const email = `wrong-${Date.now()}@example.com`;
    await sendOtpFor(email, "123456");

    const req = { body: { email, otp: "654321" } };
    const res = createRes();

    await verifyEmailOTP(req, res);

    expect(res.status.calledWith(400)).to.equal(true);
    expect(res.json.calledWithMatch({ success: false, message: "Invalid OTP" })).to.equal(true);
  });

  it("verifies only the issued registration email OTP", async function () {
    const email = `right-${Date.now()}@example.com`;
    await sendOtpFor(email, "234567");

    const req = { body: { email: ` ${email.toUpperCase()} `, otp: " 234567 " } };
    const res = createRes();

    await verifyEmailOTP(req, res);

    expect(res.status.calledWith(200)).to.equal(true);
    expect(res.json.calledWithMatch({ success: true, email })).to.equal(true);
    const payload = res.json.firstCall.args[0];
    expect(payload.emailVerificationToken).to.be.a("string").and.not.empty;
  });

  it("verifies a persisted registration email OTP after memory is unavailable", async function () {
    const email = `persisted-${Date.now()}@example.com`;
    RegistrationOTP.findOne.restore();
    sandbox.stub(RegistrationOTP, "findOne").returns({
      sort: sinon.stub().returns({
        lean: sinon.stub().resolves({
          email,
          otp: "345678",
          purpose: "registration_email",
          expiresAt: new Date(Date.now() + 60_000),
        }),
      }),
    });

    const req = { body: { email, otp: "345678" } };
    const res = createRes();

    await verifyEmailOTP(req, res);

    expect(res.status.calledWith(200)).to.equal(true);
    expect(res.json.calledWithMatch({ success: true, email })).to.equal(true);
  });
});
