import { expect } from "chai";
import sinon from "sinon";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import staffRoutes from "../src/routes/staffRoutes.js";
import clinicRoutes from "../src/routes/clinicRoutes.js";
import User from "../src/models/userModel.js";
import Session from "../src/models/sessionModel.js";
import Clinic from "../src/models/clinicModel.js";
import DateRange from "../src/models/dateRangeModel.js";
import Appointment from "../src/models/appointmentModel.js";
import Walkin from "../src/models/walkinAppointmentModel.js";
import { clinicStaffRepository } from "../src/services/clinicStaffService.js";

const app = express();
app.use(express.json());
app.use("/staff", staffRoutes);
app.use("/clinics", clinicRoutes);
const doctor = { _id: "doctor-a", role: "doctor", isActive: true, isOnline: true };
const staff = { id: "staff-a", fullName: "Staff A", email: "staff@example.test", role: "nurse", assignedDoctor: doctor._id, clinic_id: "clinic-a", isActive: 1 };
const clinic = { id: "clinic-a", doctor_id: doctor._id, clinic_name: "Clinic A" };

describe("Clinic-specific staff and clinic deletion", () => {
  let token, db, connection;
  beforeEach(() => {
    token = jwt.sign({ userId: doctor._id, sessionId: "clinic-staff-session", role: "doctor" }, process.env.ACCESS_SECRET);
    sinon.stub(Session, "findOne").resolves({ _id: "clinic-staff-session", isActive: true });
    sinon.stub(User, "findById").resolves({ ...doctor });
    sinon.stub(User, "findOne").resolves(null);
    sinon.stub(User, "create").callsFake(async data => ({ ...data, id: "staff-new" }));
    sinon.stub(User, "findByIdAndUpdate").callsFake(async (id, update) => ({ ...staff, id, ...update.$set }));
    sinon.stub(User, "deleteOne").resolves({ deletedCount: 1 });
    sinon.stub(User, "countDocuments").resolves(0);
    sinon.stub(Clinic, "findOne").callsFake(async filter => filter.doctor_id === doctor._id && ["clinic-a", "clinic-b"].includes(filter._id) ? { ...clinic, id: filter._id } : null);
    sinon.stub(Clinic, "create").callsFake(async data => ({ ...data, id: "new-clinic" }));
    sinon.stub(Clinic, "deleteOne").resolves({ deletedCount: 1 });
    sinon.stub(DateRange, "countDocuments").resolves(0);
    sinon.stub(Appointment, "countDocuments").resolves(0);
    sinon.stub(Walkin, "countDocuments").resolves(0);
    db = sinon.stub(clinicStaffRepository, "query").callsFake(async sql => sql.startsWith("SHOW COLUMNS") ? [[{ Field: "clinic_id" }]] : [[{ ...staff, clinic_name: "Clinic A" }]]);
    connection = { query: sinon.stub().resolves([[{ acquired: 1 }]]), release: sinon.spy() };
    sinon.stub(clinicStaffRepository, "connection").resolves(connection);
  });
  afterEach(() => sinon.restore());
  const create = (body = {}) => request(app).post("/staff").auth(token, { type: "bearer" }).send({ full_name: "New Staff", email: "new@example.test", role: "nurse", clinic_id: "clinic-a", ...body });

  it("requires authentication for staff and clinic deletion", async () => {
    expect((await request(app).get("/staff")).status).to.equal(401);
    expect((await request(app).delete("/clinics/clinic-a")).status).to.equal(401);
  });
  it("does not allow a patient to manage staff", async () => {
    User.findById.resolves({ ...doctor, role: "user" });
    expect((await create()).status).to.equal(403);
    expect(User.create.called).to.equal(false);
  });
  it("lists only the authenticated doctor's staff and honors clinic filters", async () => {
    const res = await request(app).get("/staff?doctor_id=other-doctor&clinic_id=clinic-a").auth(token, { type: "bearer" });
    expect(res.status).to.equal(200);
    const call = db.getCalls().find(call => call.args[0].startsWith("SELECT u.id"));
    expect(call.args[0]).to.include("WHERE u.assignedDoctor = ? AND u.role IN");
    expect(call.args[0]).to.include("AND u.clinic_id = ?");
    expect(call.args[1][0]).to.equal(doctor._id);
    expect(call.args[1]).not.to.include("other-doctor");
    expect(res.body.data[0]).to.include({ clinic_id: "clinic-a", clinic_name: "Clinic A" });
  });
  it("keeps legacy unassigned staff available for reassignment", async () => {
    const res = await request(app).get("/staff?clinic_id=unassigned").auth(token, { type: "bearer" });
    expect(res.status).to.equal(200);
    expect(db.lastCall.args[0]).to.include("u.clinic_id IS NULL OR u.clinic_id = ''");
  });
  it("requires a clinic when creating staff", async () => {
    const res = await create({ clinic_id: "" });
    expect(res.status).to.equal(400);
    expect(User.create.called).to.equal(false);
  });
  it("rejects another doctor's clinic", async () => {
    expect((await create({ clinic_id: "foreign-clinic" })).status).to.equal(404);
    expect(User.create.called).to.equal(false);
    expect(connection.release.calledOnce).to.equal(true);
  });
  it("persists clinic and authenticated ownership, without exposing a password", async () => {
    const res = await create({ doctor_id: "other-doctor" });
    expect(res.status).to.equal(201);
    expect(User.create.firstCall.args[0]).to.include({ clinic_id: "clinic-a", assignedDoctor: doctor._id });
    expect(res.body.data).to.include({ clinic_id: "clinic-a", clinic_name: "Clinic A" });
    expect(res.body.data).not.to.have.property("password");
    expect(connection.release.calledOnce).to.equal(true);
  });
  it("rejects non-staff roles", async () => {
    expect((await create({ role: "doctor" })).status).to.equal(400);
    expect(User.create.called).to.equal(false);
  });
  it("moves staff to another owned clinic and ignores ownership overrides", async () => {
    User.findOne.resolves(staff);
    const res = await request(app).put("/staff/staff-a").auth(token, { type: "bearer" }).send({ clinic_id: "clinic-b", assignedDoctor: "other-doctor", role: "Medical Assistant" });
    expect(res.status).to.equal(200);
    expect(User.findByIdAndUpdate.firstCall.args[1].$set).to.deep.equal({ clinic_id: "clinic-b", role: "assistant" });
    expect(res.body.data.clinic_id).to.equal("clinic-b");
  });
  it("rejects editing or deleting another doctor's staff", async () => {
    expect((await request(app).put("/staff/foreign").auth(token, { type: "bearer" }).send({ clinic_id: "clinic-a" })).status).to.equal(404);
    expect((await request(app).delete("/staff/foreign").auth(token, { type: "bearer" })).status).to.equal(404);
    expect(User.deleteOne.called).to.equal(false);
    expect(User.findByIdAndUpdate.called).to.equal(false);
  });
  it("requires ownership when deleting a clinic", async () => {
    const res = await request(app).delete("/clinics/foreign-clinic").auth(token, { type: "bearer" });
    expect(res.status).to.equal(404);
    expect(Clinic.deleteOne.called).to.equal(false);
  });
  for (const [label, Model] of [["staff", User], ["timings", DateRange], ["appointments", Appointment], ["walk-ins", Walkin]]) {
    it(`preserves clinics linked to ${label}`, async () => {
      Model.countDocuments.resolves(1);
      const res = await request(app).delete("/clinics/clinic-a").auth(token, { type: "bearer" });
      expect(res.status).to.equal(409);
      expect(Clinic.deleteOne.called).to.equal(false);
      expect(connection.release.calledOnce).to.equal(true);
    });
  }
  it("deletes an owned empty clinic", async () => {
    const res = await request(app).delete("/clinics/clinic-a").auth(token, { type: "bearer" });
    expect(res.status).to.equal(200);
    expect(Clinic.deleteOne.firstCall.args[0]).to.deep.equal({ _id: "clinic-a", doctor_id: doctor._id });
  });
  it("creates clinics under authenticated doctor ownership", async () => {
    const res = await request(app).post("/clinics").auth(token, { type: "bearer" }).send({ doctor_id: "other-doctor", clinic_name: "New Clinic" });
    expect(res.status).to.equal(201);
    expect(Clinic.create.firstCall.args[0].doctor_id).to.equal(doctor._id);
  });
});
