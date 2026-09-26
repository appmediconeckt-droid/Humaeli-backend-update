import { expect } from "chai";
import sinon from "sinon";
import { buildDaySlots, timeMinutes, indiaDateTime, withAppointmentSlot, slotRepository } from "../src/services/appointmentSlotService.js";
import { book } from "../src/controllers/appointmentController.js";
import { createWalkinAppointment, updateWalkinAppointment } from "../src/controllers/walkinController.js";
import User from "../src/models/userModel.js";
import Appointment from "../src/models/appointmentModel.js";
import Walkin from "../src/models/walkinAppointmentModel.js";
import Notification from "../src/models/Notification.js";
import { clinicStaffRepository } from "../src/services/clinicStaffService.js";

const date = "2026-09-22";
const range = { clinic_id: "clinic-1", availability_date: date, start_time: "10:00:00", end_time: "14:00:00", slot_duration: 15 };
const res = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

describe("Availability-based appointment tokens", () => {
  let sandbox, connection;
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(clinicStaffRepository, "query").resolves([[{ Field: "clinic_id" }]]);
    connection = { query: sandbox.stub().resolves([[{ acquired: 1 }]]), release: sandbox.spy() };
    sandbox.stub(slotRepository, "connection").resolves(connection);
    sandbox.stub(slotRepository, "ranges").resolves([range]);
    sandbox.stub(slotRepository, "unavailable").resolves(null);
    sandbox.stub(slotRepository, "online").resolves([]);
    sandbox.stub(slotRepository, "walkins").resolves([]);
  });
  afterEach(() => sandbox.restore());
  const reserve = (time, options = {}) => withAppointmentSlot({ doctorId: "doctor-1", date, time, ...options }, async (slot) => slot);

  it("blocks new bookings only at the unavailable clinic and keeps other tokens stable", async () => {
    slotRepository.ranges.resolves([range,
      { ...range, clinic_id: "clinic-2", start_time: "14:00:00", end_time: "15:00:00" },
      { ...range, is_unavailable: true },
    ]);
    try { await reserve("10:00", { clinicId: "clinic-1" }); throw new Error("Should reject"); }
    catch (error) { expect(error.message).to.include("unavailable at this clinic"); }
    expect((await reserve("14:00", { clinicId: "clinic-2" })).token).to.equal(17);
    expect((await reserve(null)).clinicId).to.equal("clinic-2");
  });

  it("10 AM to 2 PM at 15 minutes creates exactly 16 numbered slots", () => {
    const slots = buildDaySlots([range], date);
    expect(slots).to.have.length(16);
    expect(slots[0]).to.include({ token: 1, time: "10:00:00" });
    expect(slots[1]).to.include({ token: 2, time: "10:15:00" });
    expect(slots[2]).to.include({ token: 3, time: "10:30:00" });
    expect(slots[15]).to.include({ token: 16, time: "13:45:00" });
  });
  it("booking later slots first does not change earlier tokens", async () => {
    expect((await reserve("13:45")).token).to.equal(16);
    expect((await reserve("10:15")).token).to.equal(2);
    expect((await reserve("10:00")).token).to.equal(1);
  });
  it("sorts split shifts and deduplicates overlapping ranges", () => {
    const slots = buildDaySlots([{ ...range, start_time: "15:00", end_time: "16:00" }, range, range], date);
    expect(slots).to.have.length(20);
    expect(slots[16]).to.include({ token: 17, time: "15:00:00" });
  });
  it("supports weekday recurrence without treating null as Sunday", () => {
    expect(buildDaySlots([{ ...range, availability_date: null, weekday: 2 }], date)).to.have.length(16);
    expect(buildDaySlots([{ ...range, availability_date: null, weekday: null }], "2026-09-27")).to.have.length(0);
    expect(buildDaySlots([{ ...range, weekday: 2 }], "2026-09-29")).to.have.length(0);
  });
  it("excludes incomplete end slots and validates dates/time formats", () => {
    expect(buildDaySlots([{ ...range, end_time: "10:40" }], date)).to.have.length(2);
    expect(timeMinutes("4:00 PM")).to.equal(960);
    expect(timeMinutes("25:00")).to.equal(null);
    expect(() => buildDaySlots([], "2026-02-30")).to.throw("Invalid appointment date");
    expect(indiaDateTime("2026-09-21T20:00:00Z")).to.deep.equal({ date, time: "01:30:00" });
  });
  for (const invalid of ["10:07", "14:00", "09:45"]) {
    it(`rejects times outside slot boundaries: ${invalid}`, async () => {
      try { await reserve(invalid); throw new Error("Should reject"); }
      catch (error) { expect(error.status).to.equal(422); }
    });
  }
  it("rejects unavailable days and releases the database lock", async () => {
    slotRepository.unavailable.resolves({});
    try { await reserve("10:00"); throw new Error("Should reject"); }
    catch (error) { expect(error.status).to.equal(422); }
    expect(connection.query.lastCall.args[0]).to.include("RELEASE_LOCK");
    expect(connection.release.calledOnce).to.equal(true);
  });
  it("rejects a slot already occupied by an online or walk-in appointment", async () => {
    for (const repository of [slotRepository.online, slotRepository.walkins]) {
      repository.resolves([{ appointment_time: "10:15:00", status: "pending" }]);
      try { await reserve("10:15"); throw new Error("Should reject"); }
      catch (error) { expect(error.status).to.equal(409); }
      repository.resolves([]);
    }
  });
  it("reuses cancelled slots with their original slot number", async () => {
    slotRepository.online.resolves([{ appointment_time: "10:15:00", status: "cancelled" }]);
    expect((await reserve("10:15")).token).to.equal(2);
  });
  it("an unscheduled emergency request does not occupy a regular slot at its request timestamp", async () => {
    slotRepository.online.resolves([{ priority: "emergency", appointment_time: null, date: `${date}T10:15:00+05:30`, status: "pending" }]);
    expect((await reserve("10:15")).token).to.equal(2);
  });
  it("walk-ins without a selected time get the next free availability slot", async () => {
    slotRepository.online.resolves([{ appointment_time: "10:15:00", status: "pending" }]);
    expect(await reserve(undefined, { earliestTime: 610 })).to.include({ token: 3, time: "10:30:00" });
  });
  it("rejects a slot belonging to a different clinic", async () => {
    try { await reserve("10:15", { clinicId: "other-clinic" }); throw new Error("Should reject"); }
    catch (error) { expect(error.status).to.equal(422); }
  });
  it("cannot create a booking when another request holds the lock", async () => {
    connection.query.resolves([[{ acquired: 0 }]]);
    try { await reserve("10:15"); throw new Error("Should reject"); }
    catch (error) { expect(error.status).to.equal(409); }
    expect(slotRepository.ranges.called).to.equal(false);
    expect(connection.release.calledOnce).to.equal(true);
  });
  it("online booking persists the server token and ignores a client-supplied token", async () => {
    sandbox.stub(User, "findOne").returns({ select: async () => ({ _id: "doctor-1", role: "doctor" }) });
    sandbox.stub(User, "findById").returns({ select() { return this; }, lean: async () => ({}) });
    sandbox.stub(Notification, "create").resolves({ toObject: () => ({}) });
    const create = sandbox.stub(Appointment, "create").callsFake(async (data) => data);
    const response = res();
    await book({ user: { _id: "patient-1" }, body: { counselorId: "doctor-1", date: `${date}T10:30:00+05:30`, clinic_id: "clinic-1", token: 99, patient_location: "12 Main Road" } }, response);
    expect(response.statusCode).to.equal(201);
    expect(create.firstCall.args[0]).to.include({ token_number: 3, appointment_time: "10:30:00", appointment_date: date });
    expect(response.body.token_number).to.equal(3);
    expect(create.firstCall.args[0].patient_location).to.equal("12 Main Road");
  });
  it("walk-in booking persists the same time-based token", async () => {
    sandbox.stub(Walkin, "create").callsFake(async (data) => data);
    const response = res();
    await createWalkinAppointment({ body: { doctor_id: "doctor-1", patient_name: "Test", appointment_date: date, appointment_time: "13:45" } }, response);
    expect(response.statusCode).to.equal(201);
    expect(response.body.token_number).to.equal(16);
    expect(Walkin.create.firstCall.args[0].clinic_id).to.equal("clinic-1");
  });
  it("rescheduling a walk-in recalculates its token", async () => {
    sandbox.stub(Walkin, "findById").resolves({ _id: "walkin-1", doctor_id: "doctor-1", appointment_date: date, appointment_time: "13:45:00", token_number: 16 });
    const update = sandbox.stub(Walkin, "findByIdAndUpdate").callsFake(async (_id, data) => data.$set);
    const response = res();
    await updateWalkinAppointment({ params: { id: "walkin-1" }, body: { appointment_time: "10:15", token_number: 99 } }, response);
    expect(response.statusCode).to.equal(200);
    expect(update.firstCall.args[1].$set.token_number).to.equal(2);
  });
});
