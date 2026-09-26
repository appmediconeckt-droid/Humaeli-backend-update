import { expect } from "chai";
import sinon from "sinon";
import express from "express";
import request from "supertest";
import routes from "../src/routes/availabilityRoutes.js";
import { setUnavailableDate, removeUnavailableDate, getAvailableRanges } from "../src/controllers/availabilityController.js";
import DateRange from "../src/models/dateRangeModel.js";
import UnavailableDate from "../src/models/unavailableDateModel.js";
import Clinic from "../src/models/clinicModel.js";

const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const req = () => ({ userId: "doctor", body: { doctor_id: "doctor", clinic_id: "clinic-a", date: "2099-01-01" } });
describe("Clinic unavailability exceptions", () => {
  beforeEach(() => {
    sinon.stub(Clinic, "findOne").resolves({ id: "clinic-a" });
    sinon.stub(DateRange, "findOne").resolves(null);
    sinon.stub(DateRange, "create").resolves({});
    sinon.stub(DateRange, "deleteMany").resolves({});
    sinon.stub(UnavailableDate, "findOne").resolves(null);
    sinon.stub(UnavailableDate, "deleteMany").resolves({});
  });
  afterEach(() => sinon.restore());
  it("persists a clinic/date override without deleting the schedule", async () => {
    const res = response();
    await setUnavailableDate(req(), res);
    expect(res.body.blocked).to.equal(true);
    expect(DateRange.create.firstCall.args[0]).to.include({ doctor_id: "doctor", clinic_id: "clinic-a", availability_date: "2099-01-01", is_unavailable: true });
    expect(DateRange.deleteMany.called).to.equal(false);
  });
  it("repeated block requests do not create duplicate exceptions", async () => {
    DateRange.findOne.resolves({ id: "existing" });
    await setUnavailableDate(req(), response());
    expect(DateRange.create.called).to.equal(false);
  });
  it("restoring removes only the exception, preserving saved timing ranges", async () => {
    const res = response();
    await removeUnavailableDate(req(), res);
    expect(res.body.blocked).to.equal(false);
    expect(DateRange.deleteMany.firstCall.args[0]).to.deep.equal({ doctor_id: "doctor", clinic_id: "clinic-a", availability_date: "2099-01-01", is_unavailable: true });
    expect(UnavailableDate.deleteMany.called).to.equal(false);
  });
  it("requires explicit all-clinic scope to restore a legacy global exception", async () => {
    UnavailableDate.findOne.resolves({ id: "global" });
    const res = response();
    await removeUnavailableDate(req(), res);
    expect(res.statusCode).to.equal(409);
    expect(DateRange.deleteMany.called).to.equal(false);
    const all = req(); all.body.scope = "all";
    await removeUnavailableDate(all, response());
    expect(UnavailableDate.deleteMany.calledOnce).to.equal(true);
  });
  it("rejects another doctor's account or clinic", async () => {
    const other = req(); other.body.doctor_id = "other";
    const res = response(); await setUnavailableDate(other, res);
    expect(res.statusCode).to.equal(403);
    Clinic.findOne.resolves(null);
    const clinicRes = response(); await setUnavailableDate(req(), clinicRes);
    expect(clinicRes.statusCode).to.equal(403);
    expect(DateRange.create.called).to.equal(false);
  });
  it("rejects invalid and past dates before saving", async () => {
    for (const date of ["2099-02-30", "invalid", "2020-01-01"]) {
      const input = req(); input.body.date = date;
      const res = response(); await setUnavailableDate(input, res);
      expect(res.statusCode).to.equal(400);
    }
    expect(DateRange.create.called).to.equal(false);
  });
  it("returns a failure when the exception cannot be persisted", async () => {
    DateRange.create.rejects(new Error("DB offline"));
    const res = response(); await setUnavailableDate(req(), res);
    expect(res.statusCode).to.equal(500);
    expect(res.body.success).to.equal(false);
  });
  it("publishes clinic-scoped blocked dates alongside global exceptions", async () => {
    sinon.stub(DateRange, "find").callsFake(async filter => filter.is_unavailable === true
      ? [{ availability_date: "2099-01-01", clinic_id: "clinic-a" }] : []);
    sinon.stub(UnavailableDate, "find").resolves([{ unavailable_date: "2099-01-02" }]);
    const res = response(); await getAvailableRanges({ query: { doctor_id: "doctor" } }, res);
    expect(res.body.unavailableDates).to.deep.equal([{ date: "2099-01-02", scope: "all" }, { date: "2099-01-01", clinic_id: "clinic-a" }]);
  });
  it("requires authentication for both block and restore routes", async () => {
    const app = express(); app.use(express.json()); app.use(routes);
    expect((await request(app).post("/unavailable").send(req().body)).status).to.equal(401);
    expect((await request(app).delete("/unavailable").send(req().body)).status).to.equal(401);
  });
});
