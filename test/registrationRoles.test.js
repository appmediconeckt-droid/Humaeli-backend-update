import { expect } from "chai";
import sinon from "sinon";
import jwt from "jsonwebtoken";
import { completeRegistration } from "../src/controllers/authController.js";
import User from "../src/models/userModel.js";

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

describe("Form registration selected roles", () => {
  let body;
  beforeEach(() => {
    body = {
      fullName: "Registration Test", email: "registration-role@example.com",
      phoneNumber: "+919876543210", password: "test-password-123",
      qualification: "MBBS", specialization: "Psychiatry", experience: "0",
      location: "Delhi", consultationMode: "online", languages: "Hindi,English",
      emailVerificationToken: jwt.sign({
        email: "registration-role@example.com", purpose: "registration_email_verified",
      }, process.env.ACCESS_SECRET, { expiresIn: "5m" }),
    };
    sinon.stub(User, "findOne").resolves(null);
    sinon.stub(User, "create").callsFake(async data => new User({ ...data, id: "registration-test" }));
  });
  afterEach(() => sinon.restore());

  for (const [selected, expected] of [
    ["doctor", "doctor"], ["user", "user"], ["counselor", "counsellor"],
    ["counsellor", "counsellor"], [" Doctor ", "doctor"],
  ]) {
    it(`saves selected ${selected} as ${expected}, regardless of professional fields`, async () => {
      const res = response();
      await completeRegistration({ body: { ...body, role: selected, accountRole: selected } }, res);
      expect(res.statusCode).to.equal(201);
      expect(User.create.firstCall.args[0].role).to.equal(expected);
      expect(res.body.role).to.equal(expected);
      expect(res.body.user.role).to.equal(expected);
      if (expected !== "user") {
        expect(User.create.firstCall.args[0]).to.include({ qualification: "MBBS", experience: 0 });
        expect(User.create.firstCall.args[0].specialization).to.deep.equal(["Psychiatry"]);
      }
    });
  }

  for (const role of [undefined, "", "admin", "auto", "doctro"]) {
    it(`rejects missing/invalid role ${role} without creating an account`, async () => {
      const res = response();
      await completeRegistration({ body: { ...body, role } }, res);
      expect(res.statusCode).to.equal(400);
      expect(res.body.code).to.equal("INVALID_ROLE");
      expect(User.create.called).to.equal(false);
    });
  }

  it("rejects conflicting role fields", async () => {
    const res = response();
    await completeRegistration({ body: { ...body, role: "doctor", accountRole: "counselor" } }, res);
    expect(res.statusCode).to.equal(400);
    expect(User.create.called).to.equal(false);
  });

  it("accepts an explicit accountRole from clients using that field", async () => {
    const res = response();
    await completeRegistration({ body: { ...body, accountRole: "doctor" } }, res);
    expect(res.statusCode).to.equal(201);
    expect(res.body.role).to.equal("doctor");
  });
});
