import { expect } from "chai";
import sinon from "sinon";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import routes from "../src/routes/appointmentRoutes.js";
import Appointment from "../src/models/appointmentModel.js";
import Walkin from "../src/models/walkinAppointmentModel.js";
import User from "../src/models/userModel.js";
import Session from "../src/models/sessionModel.js";
import { slotRepository, indiaDateTime } from "../src/services/appointmentSlotService.js";
import { tokenTimingRepository } from "../src/controllers/tokenStatusController.js";
import { getAppointments } from "../src/controllers/appointmentController.js";

const app = express();
app.use("/api/appointments", routes);
describe("User token status route", () => {
  let sandbox, token, today, own;
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    today = indiaDateTime().date;
    own = { id: "my-booking", patient: "patient-1", counselor: "doctor-1", appointment_date: today, appointment_time: "11:00:00", token_number: 5, status: "pending" };
    token = jwt.sign({ userId: "patient-1", sessionId: "session-test-123", role: "user" }, process.env.ACCESS_SECRET);
    sandbox.stub(Session, "findOne").resolves({ isActive: true });
    sandbox.stub(Appointment, "find").resolves([own]);
    sandbox.stub(Walkin, "find").resolves([]);
    sandbox.stub(slotRepository, "online").resolves([own]);
    sandbox.stub(slotRepository, "walkins").resolves([]);
    sandbox.stub(slotRepository, "ranges").resolves([]);
    sandbox.stub(tokenTimingRepository, "breaks").resolves([]);
    sandbox.stub(User, "findById").returns({ select() { return this; }, lean: async () => ({ fullName: "Test Doctor" }) });
  });
  afterEach(() => sandbox.restore());
  const get = () => request(app).get("/api/appointments/my-token-status?patient_id=someone-else").auth(token, { type: "bearer" });

  it("returns the Token tab contract and scopes records to the authenticated user", async () => {
    const res = await get();
    expect(res.status).to.equal(200);
    expect(Appointment.find.firstCall.args[0].patient).to.equal("patient-1");
    expect(Walkin.find.firstCall.args[0].patient_id).to.equal("patient-1");
    expect(res.body.appointments[0].token.myToken).to.equal(5);
    expect(res.body.appointments[0].appointment.doctor.fullName).to.equal("Test Doctor");
    expect(res.body.appointments[0].queue.patientsAhead).to.equal(0);
    expect(res.headers["cache-control"]).to.equal("private, no-store");
  });
  it("counts real bookings ahead rather than gaps in token numbers", async () => {
    slotRepository.online.resolves([{ ...own, id: "serving", token_number: 1, appointment_time: "10:00:00", status: "in-progress" }, { ...own, id: "cancelled", token_number: 2, status: "cancelled" }, own]);
    const res = await get();
    const item = res.body.appointments[0];
    expect(item.current).to.include({ currentToken: 1, doctorStatus: "consulting" });
    expect(item.queue).to.include({ patientsAhead: 1, queuePosition: 2, totalWaiting: 1 });
    expect(JSON.stringify(item)).not.to.include('"serving"');
  });
  it("includes walk-ins and emergency priority without exposing other patients", async () => {
    slotRepository.walkins.resolves([{ id: "other-patient", doctor_id: "doctor-1", appointment_date: today, appointment_time: "11:15:00", token_number: 6, appointment_status: "booked", priority: "Emergency", patient_name: "PRIVATE NAME" }]);
    const res = await get();
    expect(res.body.appointments[0].emergency).to.include({ active: true, totalEmergencyPatients: 1, emergencyPatientsAhead: 1 });
    expect(JSON.stringify(res.body)).not.to.include("PRIVATE NAME");
  });
  it("retains completed appointments without live queue timing", async () => {
    Appointment.find.resolves([{ ...own, status: "completed" }]);
    const res = await get();
    expect(res.status).to.equal(200);
    expect(res.body.appointments[0].appointment.status).to.equal("completed");
    expect(res.body.appointments[0].queue.estimatedTurnTime).to.equal(null);
    expect(res.body.appointments[0].current.consultationStartedAt).to.equal(null);
  });
  it("prioritizes an online emergency appointment without exposing its reason to other patients", async () => {
    slotRepository.online.resolves([own, { ...own, id: "emergency-booking", patient: "patient-2", priority: "emergency", emergency_reason: "PRIVATE MEDICAL REASON", appointment_time: "11:15:00" }]);
    const res = await get();
    expect(res.status).to.equal(200);
    expect(res.body.appointments[0].emergency).to.include({ active: true, totalEmergencyPatients: 1, emergencyPatientsAhead: 1 });
    expect(JSON.stringify(res.body)).not.to.include("PRIVATE MEDICAL REASON");
  });
  it("does not present an unscheduled emergency request timestamp as a booked time", async () => {
    const urgent = { ...own, priority: "emergency", appointment_time: null, token_number: null, date: new Date().toISOString() };
    Appointment.find.resolves([urgent]);
    slotRepository.online.resolves([urgent]);
    const res = await get();
    expect(res.status).to.equal(200);
    expect(res.body.appointments[0].appointment.appointmentTime).to.equal("");
    expect(res.body.appointments[0].token.myToken).to.equal(null);
    expect(res.body.appointments[0].emergency.active).to.equal(true);
  });
  it("includes historical and cancelled appointments with newest bookings first", async () => {
    Appointment.find.resolves([
      { ...own, id: "old", appointment_date: "2020-01-01", status: "completed", createdAt: "2020-01-01T00:00:00Z" },
      { ...own, id: "new", status: "cancelled", createdAt: "2026-09-23T00:00:00Z" },
      { ...own, id: "middle", createdAt: "2026-09-22T00:00:00Z" },
    ]);
    const res = await get();
    expect(res.status).to.equal(200);
    expect(Appointment.find.firstCall.args[0]).to.deep.equal({ patient: "patient-1" });
    expect(res.body.appointments.map(item => item.appointment._id)).to.deep.equal(["new", "middle", "old"]);
  });
  it("does not mix queues from different dates or doctors", async () => {
    slotRepository.online.resolves([own, { ...own, id: "wrong-day", appointment_date: "2099-01-01" }, { ...own, id: "wrong-doctor", counselor: "doctor-2" }]);
    const res = await get();
    expect(res.body.appointments[0].queue.totalWaiting).to.equal(1);
  });
  it("reading appointment history never deletes expired pending or cancelled records", async () => {
    const history = [{ ...own, status: "cancelled", date: "2020-01-01" }];
    Appointment.find.returns({ populate() { return this; }, sort() { return this; }, lean: async () => history });
    const remove = sandbox.stub(Appointment, "deleteMany");
    const res = { json: sandbox.spy(), status() { return this; } };
    await getAppointments({ user: { _id: "patient-1" }, query: {} }, res);
    expect(remove.called).to.equal(false);
    expect(res.json.firstCall.args[0][0].status).to.equal("cancelled");
  });
  it("returns 401 without a session rather than a missing-route 404", async () => {
    expect((await request(app).get("/api/appointments/my-token-status")).status).to.equal(401);
  });
});
