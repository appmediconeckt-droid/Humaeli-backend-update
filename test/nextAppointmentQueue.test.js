import { expect } from "chai";
import sinon from "sinon";
import Appointment from "../src/models/appointmentModel.js";
import Walkin from "../src/models/walkinAppointmentModel.js";
import { updateDoctorAppointment, markExpiredAppointmentsNoShow } from "../src/controllers/appointmentController.js";
import { updateWalkinAppointment } from "../src/controllers/walkinController.js";
import { slotRepository } from "../src/services/appointmentSlotService.js";

const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
describe("Doctor Next appointment queue", () => {
  afterEach(() => sinon.restore());
  it("persists an unstarted online appointment in the skipped queue", async () => {
    const record = { counselor: "doctor-1", status: "pending", save: sinon.stub().resolves(), toJSON() { return { status: this.status, queue_status: this.queue_status }; } };
    sinon.stub(Appointment, "findById").resolves(record);
    const res = response();
    await updateDoctorAppointment({ user: { _id: "doctor-1" }, params: { id: "appt-1" }, body: { queue_status: "skipped" } }, res);
    expect(res.statusCode).to.equal(200);
    expect(record.save.calledOnce).to.equal(true);
    expect(res.body.appointment).to.include({ status: "pending", queue_status: "skipped" });
    expect(record.consultation_started_at).to.equal(undefined);
  });
  it("rejects moving a started online consultation to Next", async () => {
    const record = { counselor: "doctor-1", status: "confirmed", consultation_started_at: new Date(), save: sinon.spy() };
    sinon.stub(Appointment, "findById").resolves(record);
    const res = response();
    await updateDoctorAppointment({ user: { _id: "doctor-1" }, params: { id: "appt-1" }, body: { queue_status: "skipped" } }, res);
    expect(res.statusCode).to.equal(409);
    expect(record.save.called).to.equal(false);
  });
  it("does not automatically cancel skipped appointments when the original slot expires", async () => {
    sinon.stub(Appointment, "find").returns({ lean: async () => [{ status: "pending", queue_status: "skipped", date: new Date("2020-01-01"), counselor: "doctor-1" }] });
    const update = sinon.stub(Appointment, "updateOne");
    const ranges = sinon.stub(slotRepository, "ranges");
    expect(await markExpiredAppointmentsNoShow()).to.equal(0);
    expect(update.called).to.equal(false);
    expect(ranges.called).to.equal(false);
  });
  it("persists a walk-in in Next without changing its time or token", async () => {
    sinon.stub(Walkin, "findById").resolves({ doctor_id: "doctor-1", appointment_status: "booked" });
    const update = sinon.stub(Walkin, "findByIdAndUpdate").resolves({ appointment_status: "skipped" });
    const res = response();
    await updateWalkinAppointment({ user: { _id: "doctor-1" }, params: { id: "walkin-1" }, body: { appointment_status: "skipped" } }, res);
    expect(res.statusCode).to.equal(200);
    expect(update.firstCall.args[1]).to.deep.equal({ $set: { appointment_status: "skipped" } });
  });
});
