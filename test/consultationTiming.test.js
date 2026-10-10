import { expect } from "chai";
import sinon from "sinon";
import { consultationTransition, emitQueueUpdated, getConsultationTiming } from "../src/services/consultationTimingService.js";
import { DoctorBreak } from "../src/models/clinicModels.js";
import { formatTokenStatus } from "../src/controllers/tokenStatusController.js";
import { markExpiredAppointmentsNoShow, updateDoctorAppointment } from "../src/controllers/appointmentController.js";
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
  it("reuses an existing top-level start timestamp on legacy start/end requests", async () => {
    const record = { consultation_started_at: at("10:08:00") };
    const started = await getConsultationTiming(record, { status: "in-progress" });
    expect(new Date(started.startedAt).getTime()).to.equal(at("10:08:00").getTime());
    const ended = await getConsultationTiming(record, { status: "completed" });
    expect(new Date(ended.startedAt).getTime()).to.equal(at("10:08:00").getTime());
    expect(ended.endedAt).to.be.a("string");
  });
  it("does not expire a waiting patient whose effective slot is delayed by the running consultation", async () => {
    const waiting = { _id: "waiting", counselor: "doctor", status: "pending", queue_status: "booked", date: at("10:15:00"), appointment_date: "2026-09-22", appointment_time: "10:15:00" };
    const running = { ...waiting, _id: "current", status: "confirmed", queue_status: "in_progress", appointment_time: "10:00:00", consultation_timing: { startedAt: at("10:20:00").toISOString(), durationMinutes: 15 } };
    sandbox.stub(Appointment, "find").callsFake((filter) => ({ lean: async () => filter.consultation_started_at === null ? [waiting] : [running, waiting] }));
    sandbox.stub(Walkin, "find").returns({ lean: async () => [] });
    sandbox.stub(DoctorBreak, "find").returns({ lean: async () => [] });
    sandbox.stub(slotRepository, "ranges").resolves([{ availability_date: "2026-09-22", start_time: "10:00", end_time: "12:00", slot_duration: 15 }]);
    const update = sandbox.stub(Appointment, "updateOne");
    expect(await markExpiredAppointmentsNoShow(at("10:30:00"))).to.equal(0);
    expect(update.called).to.equal(false);
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
  it("marks the estimate uncertain instead of auto-advancing when the current token overruns", () => {
    const result = formatTokenStatus(second, [current, second, mine], {}, [], [], at("10:20:00").getTime());
    expect(result.current).to.include({ currentToken: 1, elapsedSeconds: 1200 });
    expect(result.queue).to.include({ patientsAhead: 1, estimatedWaitMinutes: 1, estimateUncertain: true });
    expect(result.queue.notice).to.equal("Your number may be called anytime. Please stay near the clinic.");
  });
  it("keeps scheduled online slot floors after an early completion", () => {
    const result = formatTokenStatus(mine, [second, mine], {}, [], [], at("10:05:00").getTime());
    expect(result.current).to.include({ currentToken: null, doctorStatus: "waiting" });
    expect(result.queue).to.include({ patientsAhead: 1, estimatedWaitMinutes: 25, estimatedTurnTime: at("10:30:00").toISOString() });
  });
  it("delays expected turn when the doctor starts late", () => {
    const late = { ...current, timing: { ...current.timing, startedAt: at("10:10:00").toISOString() } };
    expect(formatTokenStatus(mine, [late, second, mine], {}, [], [], at("10:15:00").getTime()).queue.estimatedTurnTime).to.equal(at("10:40:00").toISOString());
  });
  it("does not pull scheduled online slots earlier after an early checkup start", () => {
    const early = { ...current, timing: { ...current.timing, startedAt: at("09:00:00").toISOString() } };
    const result = formatTokenStatus(mine, [early, second, mine], {}, [], [], at("09:05:00").getTime());
    expect(result.queue).to.include({ estimatedWaitMinutes: 85, estimatedTurnTime: at("10:30:00").toISOString() });
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
  it("deletes an absent appointment only after its complete doctor availability session", async () => {
    const appointment = {
      _id: "missed",
      counselor: "doctor",
      status: "pending",
      queue_status: "booked",
      date: at("10:00:00"),
      appointment_date: "2026-09-22",
      appointment_time: "10:00:00",
    };
    const find = sandbox.stub(Appointment, "find").returns({
      lean: async () => [appointment],
    });
    const updateOne = sandbox.stub(Appointment, "deleteOne").resolves({ deletedCount: 1 });
    sandbox.stub(slotRepository, "ranges").resolves([{
      availability_date: "2026-09-22",
      start_time: "10:00",
      end_time: "11:00",
      slot_duration: 15,
    }]);

    expect(await markExpiredAppointmentsNoShow(at("10:59:59"))).to.equal(0);
    expect(updateOne.called).to.equal(false);
    expect(await markExpiredAppointmentsNoShow(at("11:00:00"))).to.equal(1);
    expect(updateOne.calledOnce).to.equal(true);
    expect(updateOne.firstCall.args[0]).to.include({
      consultation_started_at: null,
    });
    expect(updateOne.firstCall.args[0].checked_in_at).to.equal(null);
    expect(find.firstCall.args[0].status).to.deep.equal({
      $in: ["pending", "confirmed"],
    });
  });
  it("never marks a started or cancelled appointment as no-show", async () => {
    sandbox.stub(Appointment, "find").returns({
      lean: async () => [
        {
          _id: "started",
          counselor: "doctor",
          status: "confirmed",
          queue_status: "booked",
          consultation_started_at: at("10:05:00"),
          date: at("10:00:00"),
          appointment_date: "2026-09-22",
          appointment_time: "10:00:00",
        },
        {
          _id: "cancelled",
          counselor: "doctor",
          status: "canceled",
          queue_status: "canceled",
          date: at("10:00:00"),
          appointment_date: "2026-09-22",
          appointment_time: "10:00:00",
        },
      ],
    });
    const updateOne = sandbox.stub(Appointment, "updateOne");

    expect(await markExpiredAppointmentsNoShow(at("10:30:00"))).to.equal(0);
    expect(updateOne.called).to.equal(false);
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
