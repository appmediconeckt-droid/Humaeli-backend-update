import { expect } from "chai";
import sinon from "sinon";
import express from "express";
import request from "supertest";
import { book } from "../src/controllers/appointmentController.js";
import routes from "../src/routes/appointmentRoutes.js";
import { validateAppointmentPriority, emergencyAppointmentRepository } from "../src/services/emergencyAppointmentService.js";
import { slotRepository } from "../src/services/appointmentSlotService.js";
import User from "../src/models/userModel.js";
import Appointment from "../src/models/appointmentModel.js";
import Notification from "../src/models/Notification.js";
import Clinic from "../src/models/clinicModel.js";
import { clinicStaffRepository } from "../src/services/clinicStaffService.js";

const now = new Date("2026-09-24T04:00:00Z"); // 09:30 India
const body = { counselorId: "doctor-1", clinic_id: "clinic-1", priority: "emergency",
  emergency_reason: "Urgent symptoms need review" };
const response = () => ({ statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } });

describe("Emergency appointment validation", () => {
  it("leaves regular bookings as normal and removes an unrelated emergency reason", () => {
    expect(validateAppointmentPriority({ emergency_reason: "not applicable" }, now)).to.deep.equal({ priority: "normal", emergency_reason: null });
  });
  it("accepts and trims an emergency reason without a date or time", () => {
    expect(validateAppointmentPriority({ ...body, emergency_reason: `  ${body.emergency_reason}  ` }, now)).to.deep.equal({ priority: "emergency", emergency_reason: body.emergency_reason });
  });
  for (const [label, changes] of [
    ["invalid priority", { priority: "VIP" }],
    ["empty reason", { emergency_reason: "   " }],
    ["short reason", { emergency_reason: "urgent" }],
    ["overlong reason", { emergency_reason: "a".repeat(1001) }],
    ["non-text reason", { emergency_reason: {} }],
    ["missing clinic", { clinic_id: "" }],
  ]) it(`rejects ${label}`, () => {
    expect(() => validateAppointmentPriority({ ...body, ...changes }, now)).to.throw().with.property("status", 400);
  });
});

describe("Emergency appointment booking", () => {
  let connection, oldIo;
  beforeEach(() => {
    sinon.useFakeTimers({ now, toFake: ["Date"] });
    oldIo = global.io;
    global.io = undefined;
    sinon.stub(emergencyAppointmentRepository, "query").resolves([[{ Field: "priority", Type: "varchar(64)" }]]);
    sinon.stub(clinicStaffRepository, "query").resolves([[{ Field: "clinic_id" }]]);
    sinon.stub(Clinic, "findOne").resolves({ id: "clinic-1", doctor_id: "doctor-1" });
    sinon.stub(Appointment, "findOne").resolves(null);
    sinon.stub(User, "find").returns({ select: async () => [{ _id: "nurse-1" }, { _id: "reception-1" }] });
    sinon.stub(User, "findOne").returns({ select: async () => ({ _id: "doctor-1", role: "doctor" }) });
    sinon.stub(User, "findById").returns({ select() { return this; }, lean: async () => ({}) });
    sinon.stub(Notification, "create").resolves({ toObject: () => ({}) });
    sinon.stub(Appointment, "create").callsFake(async data => ({ ...data, _id: "new-appointment" }));
    connection = { query: sinon.stub().resolves([[{ acquired: 1 }]]), release: sinon.spy() };
    sinon.stub(clinicStaffRepository, "connection").resolves(connection);
    sinon.stub(slotRepository, "connection").resolves(connection);
    sinon.stub(slotRepository, "ranges").resolves([{ clinic_id: "clinic-1", availability_date: "2026-09-24", start_time: "09:00", end_time: "12:00", slot_duration: 15 }]);
    sinon.stub(slotRepository, "unavailable").resolves(null);
    sinon.stub(slotRepository, "online").resolves([]);
    sinon.stub(slotRepository, "walkins").resolves([]);
  });
  afterEach(() => { sinon.restore(); global.io = oldIo; });
  const run = async (changes = {}) => {
    const res = response();
    await book({ user: { _id: "patient-1", fullName: "Patient" }, body: { ...body, ...changes } }, res);
    return res;
  };
  it("books without a slot and notifies doctor plus clinic staff without sensitive reason in notification", async () => {
    const emit = sinon.spy(); global.io = { to: () => ({ emit }) };
    const res = await run({ patient_id: "someone-else" });
    expect(res.statusCode).to.equal(201);
    expect(res.body).to.include({ priority: "emergency", emergency_reason: body.emergency_reason, patient: "patient-1", status: "pending", token_number: null, appointment_time: null, slot_key: null, clinic_id: "clinic-1", appointment_date: "2026-09-24" });
    expect(res.body.date.getTime()).to.equal(now.getTime());
    expect(slotRepository.connection.called).to.equal(false);
    expect(Notification.create.getCalls().map(call => call.args[0].recipientId).sort()).to.deep.equal(["doctor-1", "nurse-1", "reception-1"]);
    expect(User.find.firstCall.args[0]).to.deep.equal({ assignedDoctor: "doctor-1", clinic_id: "clinic-1", isActive: true, role: { $in: ["nurse", "receptionist", "assistant", "manager", "supervisor"] } });
    expect(Notification.create.firstCall.args[0].title).to.equal("Emergency appointment request");
    expect(Notification.create.firstCall.args[0].message).not.to.include(body.emergency_reason);
    expect(emit.calledWith("queueUpdated")).to.equal(true);
  });
  it("allows emergency requests even when ordinary slots are occupied", async () => {
    slotRepository.online.resolves([{ appointment_time: "10:00:00", status: "pending" }]);
    expect((await run()).statusCode).to.equal(201);
    expect(slotRepository.connection.called).to.equal(false);
  });
  it("allows direct requests without configured availability", async () => {
    slotRepository.unavailable.resolves({});
    slotRepository.ranges.resolves([]);
    expect((await run()).statusCode).to.equal(201);
    expect(slotRepository.unavailable.called).to.equal(false);
  });
  it("ignores client time and token values and uses server request time", async () => {
    const res = await run({ appointment_time: "09:00:00", date: "2030-01-01", appointment_date: "2030-01-01", token_number: 999 });
    expect(res.statusCode).to.equal(201);
    expect(res.body).to.include({ appointment_time: null, appointment_date: "2026-09-24", token_number: null });
    expect(connection.release.calledOnce).to.equal(true);
  });
  it("rejects a clinic owned by a different doctor", async () => {
    Clinic.findOne.resolves(null);
    expect((await run()).statusCode).to.equal(404);
    expect(Clinic.findOne.firstCall.args[0]).to.deep.equal({ _id: "clinic-1", doctor_id: "doctor-1" });
    expect(Appointment.create.called).to.equal(false);
    expect(Notification.create.called).to.equal(false);
  });
  it("prevents repeated active requests and duplicate notifications", async () => {
    Appointment.findOne.resolves({ id: "existing-emergency" });
    expect((await run()).statusCode).to.equal(409);
    expect(Appointment.create.called).to.equal(false);
    expect(Notification.create.called).to.equal(false);
  });
  it("still notifies the doctor when a clinic has no assigned staff", async () => {
    User.find.returns({ select: async () => [] });
    expect((await run()).statusCode).to.equal(201);
    expect(Notification.create.calledOnce).to.equal(true);
    expect(Notification.create.firstCall.args[0].recipientId).to.equal("doctor-1");
  });
  it("one failed notification does not discard the booking or block other recipients", async () => {
    Notification.create.onFirstCall().rejects(new Error("Notification service unavailable"));
    expect((await run()).statusCode).to.equal(201);
    expect(Notification.create.callCount).to.equal(3);
    expect(Appointment.create.calledOnce).to.equal(true);
  });
  it("does not create an emergency appointment with a counsellor", async () => {
    User.findOne.returns({ select: async () => ({ role: "counsellor" }) });
    expect((await run()).statusCode).to.equal(400);
    expect(Appointment.create.called).to.equal(false);
  });
  it("requires login on the booking endpoint", async () => {
    const app = express(); app.use(express.json()); app.use("/appointments", routes);
    expect((await request(app).post("/appointments").send(body)).status).to.equal(401);
    expect(Appointment.create.called).to.equal(false);
  });
});
