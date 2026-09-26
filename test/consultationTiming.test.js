import { expect } from "chai";
import sinon from "sinon";
import { consultationTransition, emitQueueUpdated } from "../src/services/consultationTimingService.js";
import { formatTokenStatus } from "../src/controllers/tokenStatusController.js";
import { updateDoctorAppointment } from "../src/controllers/appointmentController.js";
import { updateWalkinAppointment } from "../src/controllers/walkinController.js";
import Appointment from "../src/models/appointmentModel.js";
import Walkin from "../src/models/walkinAppointmentModel.js";
import { slotRepository } from "../src/services/appointmentSlotService.js";

const at = (time) => new Date(`2026-09-22T${time}+05:30`);
const current = { id: "one", source: "online", doctorId: "doctor", date: "2026-09-22", time: "10:00:00", status: "in-progress", queueStatus: "in-progress", token: 1,
  timing: { startedAt: at("10:00:00").toISOString(), durationMinutes: 15, state: "consulting", pauses: [] } };
const mine = { ...current, id: "three", time: "10:30:00", status: "pending", queueStatus: "pending", token: 3, timing: { durationMinutes: 15 } };
const second = { ...mine, id: "two", token: 2, time: "10:15:00" };
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } });

describe("Persisted consultation timing and live queue", () => {
  let sandbox;
  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); delete global.io; });
  it("starts once and keeps the original start timestamp on repeated requests", () => {
    const started = consultationTransition(null, "start", 15, at("10:00:00"));
    expect(consultationTransition(started, "start", 15, at("10:01:00"))).to.deep.equal(started);
  });
  it("persists pause/resume/end intervals without resetting start time", () => {
    let timing = consultationTransition(null, "start", 15, at("10:00:00"));
    timing = consultationTransition(timing, "pause", 15, at("10:03:00"));
    timing = consultationTransition(timing, "resume", 15, at("10:05:00"));
    timing = consultationTransition(timing, "end", 15, at("10:12:00"));
    expect(timing.startedAt).to.equal(at("10:00:00").toISOString());
    expect(timing.pauses).to.deep.equal([{ startedAt: at("10:03:00").toISOString(), endedAt: at("10:05:00").toISOString() }]);
    expect(timing.state).to.equal("completed");
  });
  it("computes elapsed time and remaining queue wait from real start plus slot duration", () => {
    const result = formatTokenStatus(mine, [mine, current, second], {}, [], [], at("10:05:00").getTime());
    expect(result.current.elapsedSeconds).to.equal(300);
    expect(result.queue).to.include({ patientsAhead: 2, estimatedWaitMinutes: 25, estimatedTurnTime: at("10:30:00").toISOString() });
  });
  it("delays expected turn when the doctor starts late", () => {
    const late = { ...current, timing: { ...current.timing, startedAt: at("10:10:00").toISOString() } };
    expect(formatTokenStatus(mine, [late, second, mine], {}, [], [], at("10:15:00").getTime()).queue.estimatedTurnTime).to.equal(at("10:40:00").toISOString());
  });
  it("bases waiting on actual checkup start even when scheduled slots are later", () => {
    const early = { ...current, timing: { ...current.timing, startedAt: at("09:00:00").toISOString() } };
    const result = formatTokenStatus(mine, [early, second, mine], {}, [], [], at("09:05:00").getTime());
    expect(result.queue).to.include({ estimatedWaitMinutes: 25, estimatedTurnTime: at("09:30:00").toISOString() });
  });
  it("does not start an elapsed timer merely because a patient was called", () => {
    const called = { ...current, status: "called", timing: {} };
    const result = formatTokenStatus(mine, [called, mine], {}, [], [], at("10:05:00").getTime());
    expect(result.current.elapsedSeconds).to.equal(null);
    expect(result.queue.estimatedWaitMinutes).to.equal(null);
  });
  it("freezes during a pause and does not promise an ETA until resumed", () => {
    const paused = { ...current, timing: { ...current.timing, state: "paused", pauses: [{ startedAt: at("10:03:00").toISOString(), endedAt: null }] } };
    const result = formatTokenStatus(mine, [paused, mine], {}, [], [], at("10:08:00").getTime());
    expect(result.current).to.include({ elapsedSeconds: 180, doctorStatus: "paused" });
    expect(result.queue.estimatedTurnTime).to.equal(null);
  });
  it("excludes doctor breaks from checkup elapsed time", () => {
    const breaks = [{ started_at: at("10:03:00"), planned_minutes: 5 }];
    const result = formatTokenStatus(mine, [current, mine], {}, [], breaks, at("10:06:00").getTime());
    expect(result.current).to.include({ elapsedSeconds: 180, doctorStatus: "break" });
    expect(result.queue.estimatedTurnTime).to.equal(null);
    expect(formatTokenStatus(mine, [current, mine], {}, [], breaks, at("10:10:00").getTime()).current.elapsedSeconds).to.equal(300);
  });
  for (const source of ["online", "walkin"]) {
    it(`doctor start persists real timing for ${source} appointments`, async () => {
      const record = { id: "one", counselor: "doctor", doctor_id: "doctor", appointment_date: "2026-09-22", appointment_time: "10:00:00", save: async () => {}, toJSON() { return { ...this }; } };
      sandbox.stub(slotRepository, "ranges").resolves([{ availability_date: "2026-09-22", start_time: "10:00", end_time: "14:00", slot_duration: 15 }]);
      sandbox.stub(Appointment, "findById").resolves(record);
      sandbox.stub(Walkin, "findById").resolves(record);
      sandbox.stub(Walkin, "findByIdAndUpdate").callsFake(async (_id, data) => ({ ...record, ...data.$set }));
      const res = response();
      const req = { params: { id: "one" }, user: { _id: "doctor" }, body: { status: "in-progress" } };
      await (source === "online" ? updateDoctorAppointment : updateWalkinAppointment)(req, res);
      expect(res.statusCode).to.equal(200);
      expect(res.body.appointment.consultation_timing).to.include({ state: "consulting", durationMinutes: 15 });
      expect(Date.parse(res.body.appointment.consultation_timing.startedAt)).to.be.greaterThan(0);
    });
  }
  it("emits a private queue update to affected patient rooms", async () => {
    const emit = sandbox.spy();
    const to = sandbox.stub().returns({ emit });
    global.io = { to };
    sandbox.stub(slotRepository, "online").resolves([{ patient: "patient-one" }, { patient: "patient-two" }]);
    sandbox.stub(slotRepository, "walkins").resolves([]);
    await emitQueueUpdated({ doctor_id: "doctor", appointment_date: "2026-09-22" });
    expect(to.calledWith("user_patient-two")).to.equal(true);
    expect(emit.firstCall.args).to.deep.equal(["queueUpdated", { doctorId: "doctor", date: "2026-09-22" }]);
  });
});
