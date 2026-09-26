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
import Prescription from "../src/models/mysql/PrescriptionModel.js";
import prescriptionRoutes from "../src/routes/prescriptionRoutes.js";
import { getAllCounsellors, getCounsellorById } from "../src/controllers/authController.js";
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

  it("directory admits completed doctors and counsellors while retaining completion filters", async () => {
    const find = sandbox.stub(User, "find").returns({ select() { return this; }, sort() { return this; }, lean: async () => [{ _id: "doctor-test", role: "doctor" }, { _id: "counsellor-test", role: "counsellor" }] });
    sandbox.stub(Message, "aggregate").resolves([]);
    const res = response();
    await getAllCounsellors({ query: {} }, res);
    expect(res.statusCode).to.equal(200);
    expect(find.firstCall.args[0].role).to.deep.equal({ $in: ["counsellor", "doctor"] });
    expect(find.firstCall.args[0]).to.include({ isActive: true, profileCompleted: true });
    expect(res.body.counsellors.map((p) => p.role)).to.deep.equal(["doctor", "counsellor"]);
  });

  it("doctor detail lookup uses the same supported roles as the directory", async () => {
    const find = sandbox.stub(User, "findOne").resolves({ toJSON: () => ({ role: "doctor" }) });
    const res = response();
    await getCounsellorById({ params: { counsellorId: "doctor-test" } }, res);
    expect(res.statusCode).to.equal(200);
    expect(find.firstCall.args[0].role.$in).to.include("doctor");
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
    const find = sandbox.stub(Prescription, "find").returns({ sort: async () => [{ id: "rx-1", patientId: "patient-test-123", patientSnapshot: { name: "Patient" }, psychiatristSnapshot: { name: "Doctor" }, medicines: [{ name: "Example" }], patientPhoto: { data: "private-photo" }, pdf: { url: "/uploads/private.pdf" }, identityVerification: { status: "verified" } }] });
    const res = await request(app).get("/api/prescriptions/my").auth(token, { type: "bearer" });
    expect(res.status).to.equal(200);
    expect(find.firstCall.args[0]).to.deep.equal({ patientId: "patient-test-123" });
    expect(res.body.prescriptions[0]).to.include({ id: "rx-1", verificationStatus: "verified", hasPatientPhoto: true });
    expect(res.body.prescriptions[0]).not.to.have.property("patientPhoto");
    expect(res.body.prescriptions[0]).not.to.have.property("pdf");
  });

  it("requires authentication for prescription lists", async () => {
    expect((await request(app).get("/api/prescriptions/my")).status).to.equal(401);
  });

  it("does not expose another patient's prescription photo", async () => {
    sandbox.stub(Prescription, "findById").resolves({ patientId: "someone-else", psychiatristId: "doctor-test" });
    expect((await request(app).get("/api/prescriptions/rx-1/photo").auth(token, { type: "bearer" })).status).to.equal(404);
  });

  it("reads migrated prescription photo data", async () => {
    sandbox.stub(Prescription, "findById").resolves({ patientId: "patient-test-123", patientPhoto: { mimeType: "image/png", data: { $binary: { base64: Buffer.from("test-image").toString("base64") } } } });
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
