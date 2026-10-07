import { expect } from "chai";
import sinon from "sinon";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import User from "../src/models/userModel.js";
import Message from "../src/models/Message.js";
import Call from "../src/models/Call.js";
import Session from "../src/models/sessionModel.js";
import Transaction from "../src/models/transactionModel.js";
import Prescription from "../src/models/Prescription.js";
import AppointmentModel from "../src/models/appointmentModel.js";
import { FollowUp } from "../src/models/clinicModels.js";
import prescriptionRoutes from "../src/routes/prescriptionRoutes.js";
import { getAllCounsellors, getCounsellorById } from "../src/controllers/authController.js";
import { appointmentProviderFilter } from "../src/controllers/appointmentController.js";
import { videoCallController } from "../src/controllers/videoCallController.js";
import { reconcileWalletPayment, walletGateway } from "../src/controllers/walletController.js";

const app = express();
app.use(express.json());
app.use("/api/prescriptions", prescriptionRoutes);
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

describe("User API repairs", () => {
  let sandbox, token;
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    token = jwt.sign({ userId: "patient-test-123", sessionId: "session-test-123", role: "user" }, process.env.ACCESS_SECRET);
    sandbox.stub(Session, "findOne").resolves({ isActive: true });
  });
  afterEach(() => sandbox.restore());

  it("directory admits active doctors and consultants without requiring stale completion flags", async () => {
    const find = sandbox.stub(User, "find").returns({ select() { return this; }, sort() { return this; }, lean: async () => [{ _id: "doctor-test", role: "doctor" }, { _id: "consultant-test", role: "consultant" }, { _id: "counsellor-test", role: "counsellor" }] });
    sandbox.stub(Message, "aggregate").resolves([]);
    const res = response();
    await getAllCounsellors({ query: {} }, res);
    expect(res.statusCode).to.equal(200);
    expect(find.firstCall.args[0].$or[0].role.$in).to.include.members(["consultant", "counsellor", "doctor"]);
    expect(find.firstCall.args[0].$or[1].accountType.$in).to.include.members(["consultant", "doctor"]);
    expect(find.firstCall.args[0]).to.include({ isActive: true });
    expect(find.firstCall.args[0]).not.to.have.property("profileCompleted");
    expect(res.body.counsellors.map((p) => p.role)).to.deep.equal(["doctor", "consultant", "counsellor"]);
  });

  it("doctor detail lookup uses the same supported roles as the directory", async () => {
    const find = sandbox.stub(User, "findOne").resolves({ toJSON: () => ({ role: "doctor" }) });
    const res = response();
    await getCounsellorById({ params: { counsellorId: "doctor-test" } }, res);
    expect(res.statusCode).to.equal(200);
    expect(find.firstCall.args[0].$or[0].role.$in).to.include("doctor");
  });

  it("appointment booking accepts active doctors without the stale counselor completion flag", () => {
    const filter = appointmentProviderFilter("doctor-test");
    expect(filter).to.include({ _id: "doctor-test", isActive: true });
    expect(filter).not.to.have.property("profileCompleted");
    expect(filter.$or).to.deep.include({ role: "doctor" });
    expect(filter.$or).to.deep.include({ accountType: "doctor" });
    expect(filter.$or).to.deep.include({
      role: { $in: ["consultant", "counsellor", "counselor", "counsellour"] },
      profileCompleted: true,
    });
  });

  it("call history works with MySQL promises and resolves participant names", async () => {
    sandbox.stub(Call, "countDocuments").resolves(1);
    const chain = { sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => [{ callId: "call-1", callerId: "patient-test-123", receiverId: "doctor-test-123", status: "ended", callType: "video" }] };
    sandbox.stub(Call, "find").returns(chain);
    sandbox.stub(User, "find").returns({ select() { return this; }, lean: async () => [{ _id: "doctor-test-123", fullName: "Test Doctor", role: "doctor" }] });
    const res = response();
    await videoCallController.getCallHistory({ params: { userId: "patient-test-123" }, query: { page: 1, limit: 100 } }, res);
    expect(res.statusCode).to.equal(200);
    expect(res.body.total).to.equal(1);
    expect(res.body.history[0].with).to.equal("Test Doctor");
  });

  it("returns only the logged-in patient's prescriptions without binary/private storage fields", async () => {
    const find = sandbox.stub(Prescription, "find").returns({ sort() { return this; }, lean: async () => [{ _id: "rx-1", patientId: "patient-test-123", patientSnapshot: { name: "Patient" }, psychiatristSnapshot: { name: "Doctor" }, medicines: [{ name: "Example" }], patientPhoto: { mimeType: "image/png", data: "private-photo" }, pdf: { url: "/uploads/private.pdf" }, identityVerification: { status: "verified" } }] });
    const res = await request(app).get("/api/prescriptions/my").auth(token, { type: "bearer" });
    expect(res.status).to.equal(200);
    expect(find.firstCall.args[0]).to.deep.equal({ patientId: "patient-test-123" });
    expect(res.body.prescriptions[0]).to.include({ id: "rx-1", verificationStatus: "verified", hasPatientPhoto: true });
    expect(res.body.prescriptions[0]).not.to.have.property("patientPhoto");
    expect(res.body.prescriptions[0]).not.to.have.property("pdf");
  });

  it("groups user prescriptions by doctor with appointment, follow-up, and medicine duration details", async () => {
    sandbox.stub(Prescription, "find").returns({
      sort() { return this; },
      lean: async () => [],
    });
    sandbox.stub(AppointmentModel, "find").returns({
      sort() { return this; },
      lean: async () => [{
        _id: "appointment-1",
        patient: "patient-test-123",
        counselor: "doctor-test-123",
        status: "completed",
        appointment_date: "2026-10-10",
        appointment_time: "10:30",
        consultation_ended_at: new Date("2026-10-10T05:15:00.000Z"),
        diagnosis: "Fever",
        medicines: [{ name: "Paracetamol", dosage: "500mg", timing: "After food", duration: "5 days", timeOfDay: ["Morning", "Night"] }],
        follow_up_required: true,
        follow_up_date: new Date("2026-10-15T04:30:00.000Z"),
      }],
    });
    sandbox.stub(User, "find").returns({
      lean: async () => [{ _id: "doctor-test-123", fullName: "Dr Test", qualification: "MBBS", specialization: "Physician" }],
    });
    sandbox.stub(FollowUp, "find").returns({
      sort() { return this; },
      lean: async () => [{
        _id: "follow-up-1",
        doctor_id: "doctor-test-123",
        patient_id: "patient-test-123",
        appointment_id: "appointment-1",
        follow_up_date: new Date("2026-10-15T04:30:00.000Z"),
        follow_up_type: "review",
        reason: "Check fever",
        notes: "Bring reports",
        status: "pending",
      }],
    });

    const res = await request(app).get("/api/prescriptions/my").auth(token, { type: "bearer" });

    expect(res.status).to.equal(200);
    expect(res.body.doctorCards).to.have.length(1);
    expect(res.body.doctorCards[0].doctor).to.include({ id: "doctor-test-123", name: "Dr Test" });
    expect(res.body.doctorCards[0].appointments[0].when).to.include({ date: "2026-10-10", time: "10:30" });
    expect(res.body.doctorCards[0].appointments[0].medicines[0]).to.include({ name: "Paracetamol", duration: "5 days" });
    expect(res.body.doctorCards[0].appointments[0].followUps[0]).to.include({ id: "follow-up-1", type: "review", reason: "Check fever" });
  });

  it("requires authentication for prescription lists", async () => {
    expect((await request(app).get("/api/prescriptions/my")).status).to.equal(401);
  });

  it("does not expose another patient's prescription photo", async () => {
    sandbox.stub(Prescription, "findById").returns({ select() { return this; }, lean: async () => ({ patientId: "someone-else", psychiatristId: "doctor-test" }) });
    expect([403, 404]).to.include((await request(app).get("/api/prescriptions/rx-1/photo").auth(token, { type: "bearer" })).status);
  });

  it("reads migrated prescription photo data", async () => {
    sandbox.stub(Prescription, "findById").returns({ select() { return this; }, lean: async () => ({ patientId: "patient-test-123", patientPhoto: { mimeType: "image/png", data: { $binary: { base64: Buffer.from("test-image").toString("base64") } } } }) });
    const res = await request(app).get("/api/prescriptions/rx-1/photo").auth(token, { type: "bearer" });
    expect(res.status).to.equal(200);
    expect(res.body.toString()).to.equal("test-image");
  });

  it("uncaptured payments return pending without changing the balance", async () => {
    sandbox.stub(Transaction, "findOne").resolves({ razorpayOrderId: "order-test", userId: "patient-test-123" });
    sandbox.stub(walletGateway.orders, "fetchPayments").resolves({ items: [{ status: "authorized", captured: false }] });
    const credit = sandbox.stub(User, "updateOne");
    const res = response();
    await reconcileWalletPayment({ user: { _id: "patient-test-123" }, body: { orderId: "order-test" } }, res);
    expect(res.statusCode).to.equal(202);
    expect(res.body).to.include({ success: false, pending: true, code: "PAYMENT_NOT_CAPTURED" });
    expect(credit.called).to.equal(false);
  });

  it("rejects reconciliation for an order not owned by the user", async () => {
    const find = sandbox.stub(Transaction, "findOne").resolves(null);
    const fetch = sandbox.stub(walletGateway.orders, "fetchPayments");
    const res = response();
    await reconcileWalletPayment({ user: { _id: "patient-test-123" }, body: { orderId: "order-test" } }, res);
    expect(res.statusCode).to.equal(404);
    expect(find.firstCall.args[0].userId).to.equal("patient-test-123");
    expect(fetch.called).to.equal(false);
  });
});
