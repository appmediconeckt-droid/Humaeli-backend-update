import { expect } from "chai";
import sinon from "sinon";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import authRoutes from "../src/routes/authRoutes.js";
import messageRoutes from "../src/routes/messageRoutes.js";
import appointmentRoutes from "../src/routes/appointmentRoutes.js";
import availabilityRoutes from "../src/routes/availabilityRoutes.js";
import User from "../src/models/userModel.js";
import Session from "../src/models/sessionModel.js";
import Chat from "../src/models/Chat.js";
import Appointment from "../src/models/appointmentModel.js";
import DateRange from "../src/models/dateRangeModel.js";
import UnavailableDate from "../src/models/unavailableDateModel.js";
import { expandConsultationNotes } from "../src/controllers/appointmentController.js";

// Mount actual routers without app.js startup jobs or writes to the real DB.
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth", authRoutes);
app.use("/api/chat", messageRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/availability", availabilityRoutes);

describe("Doctor frontend API contracts", () => {
  let sandbox, doctor, session, token;
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    doctor = { _id: "doctor-test-1234", role: "doctor", fullName: "Test Doctor", isActive: true, isOnline: true, qualification: "MBBS", specialization: ["General"], languages: ["Hindi"] };
    session = { _id: "session-test-1234", userId: doctor._id, isActive: true, save: sandbox.stub().resolves() };
    token = jwt.sign({ userId: doctor._id, sessionId: session._id, role: "doctor" }, process.env.ACCESS_SECRET);
    sandbox.stub(Session, "findOne").resolves(session);
    sandbox.stub(Session, "findById").resolves(session);
    sandbox.stub(Session, "updateOne").resolves({});
    const userQuery = { then: (resolve) => Promise.resolve(doctor).then(resolve), select: () => Promise.resolve(doctor) };
    sandbox.stub(User, "findById").returns(userQuery);
    sandbox.stub(User, "updateOne").resolves({});
    sandbox.stub(User, "findByIdAndUpdate").resolves(doctor);
  });
  afterEach(() => sandbox.restore());

  it("allows doctor /auth/me and includes professional profile fields", async () => {
    const res = await request(app).get("/api/auth/me").auth(token, { type: "bearer" });
    expect(res.status).to.equal(200);
    expect(res.body.user.qualification).to.equal("MBBS");
    expect(res.body.user.specialization).to.deep.equal(["General"]);
  });

  it("allows doctor chats and scopes them to the authenticated doctor", async () => {
    const chain = { populate() { return this; }, sort: sandbox.stub().resolves([]) };
    const find = sandbox.stub(Chat, "find").returns(chain);
    const res = await request(app).get("/api/chat/chats").auth(token, { type: "bearer" });
    expect(res.status).to.equal(200);
    expect(find.firstCall.args[0].counselorId).to.equal(doctor._id);
  });

  it("saves doctor professional fields and returns them to the profile editor", async () => {
    User.findByIdAndUpdate.returns({ select: async () => ({ ...doctor, qualification: "MD", experience: 5, location: "Delhi" }) });
    const res = await request(app).patch(`/api/auth/update/${doctor._id}`).auth(token, { type: "bearer" }).send({ qualification: "MD", experience: 5, location: "Delhi", specialization: ["General"] });
    expect(res.status).to.equal(200);
    expect(res.body.user.qualification).to.equal("MD");
    expect(User.findByIdAndUpdate.firstCall.args[1].$set.qualification).to.equal("MD");
  });

  it("preserves doctor role through refresh and accepts the refreshed token for chats", async () => {
    session.refreshToken = jwt.sign({ userId: doctor._id, sessionId: session._id, role: "doctor" }, process.env.REFRESH_SECRET);
    const res = await request(app).post("/api/auth/refresh-token").send({ refreshToken: session.refreshToken });
    expect(res.status).to.equal(200);
    expect(jwt.verify(res.body.accessToken, process.env.ACCESS_SECRET).role).to.equal("doctor");
    expect(jwt.verify(res.body.refreshToken, process.env.REFRESH_SECRET).role).to.equal("doctor");
    sandbox.stub(Chat, "find").returns({ populate() { return this; }, sort: async () => [] });
    const chats = await request(app).get("/api/chat/chats").auth(res.body.accessToken, { type: "bearer" });
    expect(chats.status).to.equal(200);
  });

  it("filters numeric clinic IDs instead of returning every clinic's ranges", async () => {
    const find = sandbox.stub(DateRange, "find").returns({ sort: async () => [] });
    sandbox.stub(UnavailableDate, "find").resolves([]);
    const res = await request(app).get("/api/availability/ranges?doctor_id=doctor-test-1234&clinic_id=1");
    expect(res.status).to.equal(200);
    expect(find.firstCall.args[0]).to.deep.equal({ doctor_id: doctor._id, clinic_id: "1" });
  });

  it("silent middleware refresh also preserves the doctor role", async () => {
    session.refreshToken = jwt.sign({ userId: doctor._id, sessionId: session._id, role: "doctor" }, process.env.REFRESH_SECRET);
    const expired = jwt.sign({ userId: doctor._id, sessionId: session._id, role: "doctor" }, process.env.ACCESS_SECRET, { expiresIn: -1 });
    const res = await request(app).get("/api/auth/me").auth(expired, { type: "bearer" }).set("Cookie", `refreshToken=${session.refreshToken}`);
    expect(res.status).to.equal(200);
    expect(jwt.verify(res.headers["x-new-access-token"], process.env.ACCESS_SECRET).role).to.equal("doctor");
  });

  it("clears only the selected clinic and preserves global unavailable dates", async () => {
    const clear = sandbox.stub(DateRange, "deleteMany").resolves({});
    const unavailable = sandbox.stub(UnavailableDate, "deleteMany").resolves({});
    const res = await request(app).delete("/api/availability/clear-all").auth(token, { type: "bearer" }).send({ doctor_id: doctor._id, clinic_id: "1" });
    expect(res.status).to.equal(200);
    expect(clear.firstCall.args[0]).to.deep.equal({ doctor_id: doctor._id, clinic_id: "1" });
    expect(unavailable.called).to.equal(false);
  });

  it("rejects attempts to clear another doctor's calendar", async () => {
    const clear = sandbox.stub(DateRange, "deleteMany");
    const res = await request(app).delete("/api/availability/clear-all").auth(token, { type: "bearer" }).send({ doctor_id: "someone-else" });
    expect(res.status).to.equal(403);
    expect(clear.called).to.equal(false);
  });

  it("updates an owned appointment and round-trips consultation details", async () => {
    const appointment = { _id: "appointment-1", counselor: doctor._id, notes: "Patient notes", save: sandbox.stub().resolves(), toJSON() { return { ...this }; } };
    sandbox.stub(Appointment, "findById").resolves(appointment);
    const res = await request(app).patch("/api/appointments/appointment-1").auth(token, { type: "bearer" }).send({ appointment_status: "completed", diagnosis: "Test", medicine: "Test medicine", follow_up_required: false });
    expect(res.status).to.equal(200);
    expect(appointment.status).to.equal("completed");
    expect(expandConsultationNotes({ notes: appointment.notes })).to.include({ notes: "Patient notes", medicine: "Test medicine", follow_up_required: false });
    expect(res.body.appointment.medicine).to.equal("Test medicine");
  });

  for (const method of ["patch", "delete"]) {
    it(`rejects ${method} for another doctor's appointment`, async () => {
      sandbox.stub(Appointment, "findById").resolves({ counselor: "someone-else" });
      const res = await request(app)[method]("/api/appointments/appointment-1").auth(token, { type: "bearer" }).send({ status: "completed" });
      expect(res.status).to.equal(403);
    });
  }

  it("deletes an owned appointment using the frontend URL", async () => {
    sandbox.stub(Appointment, "findById").resolves({ counselor: doctor._id });
    const remove = sandbox.stub(Appointment, "findByIdAndDelete").resolves({});
    const res = await request(app).delete("/api/appointments/appointment-1").auth(token, { type: "bearer" });
    expect(res.status).to.equal(200);
    expect(remove.calledOnceWith("appointment-1")).to.equal(true);
  });
});
