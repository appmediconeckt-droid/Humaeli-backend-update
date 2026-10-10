import { expect } from "chai";
import sinon from "sinon";
import { calculateDoctorDelays, enrichAppointmentsWithDelay } from "../src/services/appointmentDelayService.js";
import { slotRepository } from "../src/services/appointmentSlotService.js";
import DoctorBreak from "../src/models/doctorBreakModel.js";
import Appointment from "../src/models/appointmentModel.js";
import WalkinAppointment from "../src/models/walkinAppointmentModel.js";

describe("Appointment Delay Service (Doctor Break & Emergency Shifts)", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.useFakeTimers({ now: new Date("2026-09-26T13:00:00+05:30"), toFake: ["Date"] });
    sandbox.stub(slotRepository, "ranges").resolves([]);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("does not add a completed emergency block that ends at the scheduled start", async () => {
    const today = "2026-09-26";
    const doctorId = "doctor-123";

    // Emergency appointment completed taking 30 minutes (13:30 to 14:00)
    const emergencyAppt = {
      id: "em-1",
      counselor: doctorId,
      priority: "emergency",
      appointment_status: "completed",
      consultation_timing: {
        startedAt: "2026-09-26T13:30:00+05:30",
        endedAt: "2026-09-26T14:00:00+05:30",
        durationMinutes: 30,
      },
      consultation_started_at: new Date("2026-09-26T13:30:00+05:30"),
      consultation_ended_at: new Date("2026-09-26T14:00:00+05:30"),
      emergency_reason: "Severe chest pain",
    };

    sandbox.stub(DoctorBreak, "find").resolves([]);
    sandbox.stub(Appointment, "find").resolves([emergencyAppt]);
    sandbox.stub(WalkinAppointment, "find").resolves([]);

    const patientAppt = {
      id: "pt-1",
      counselor: doctorId,
      patient: "patient-1",
      appointment_date: today,
      appointment_time: "14:00:00",
      status: "pending",
      priority: "regular",
    };

    const enriched = await enrichAppointmentsWithDelay([patientAppt], doctorId, today);

    expect(enriched).to.have.lengthOf(1);
    expect(enriched[0].delay_minutes).to.equal(0);
    expect(enriched[0].original_appointment_time).to.equal("14:00:00");
    expect(enriched[0].estimated_appointment_time).to.equal("14:00:00");
    expect(enriched[0].delay_reason).to.equal(null);
  });

  it("does not add a completed break that ends at the scheduled start", async () => {
    const today = "2026-09-26";
    const doctorId = "doctor-123";

    // Break ended taking 15 minutes
    const doctorBreak = {
      id: "break-1",
      doctor_id: doctorId,
      status: "ended",
      started_at: new Date("2026-09-26T13:45:00+05:30"),
      ended_at: new Date("2026-09-26T14:00:00+05:30"),
      planned_minutes: 15,
      reason: "Lunch break",
    };

    sandbox.stub(DoctorBreak, "find").resolves([doctorBreak]);
    sandbox.stub(Appointment, "find").resolves([]);
    sandbox.stub(WalkinAppointment, "find").resolves([]);

    const patientAppt = {
      id: "pt-1",
      counselor: doctorId,
      patient: "patient-1",
      appointment_date: today,
      appointment_time: "14:00:00",
      status: "pending",
      priority: "regular",
    };

    const enriched = await enrichAppointmentsWithDelay([patientAppt], doctorId, today);

    expect(enriched).to.have.lengthOf(1);
    expect(enriched[0].delay_minutes).to.equal(0);
    expect(enriched[0].original_appointment_time).to.equal("14:00:00");
    expect(enriched[0].estimated_appointment_time).to.equal("14:00:00");
    expect(enriched[0].delay_reason).to.equal(null);
  });

  it("does not double count previous emergency and break durations", async () => {
    const today = "2026-09-26";
    const doctorId = "doctor-123";

    const doctorBreak = {
      id: "break-1",
      doctor_id: doctorId,
      status: "ended",
      started_at: new Date("2026-09-26T13:15:00+05:30"),
      ended_at: new Date("2026-09-26T13:30:00+05:30"),
      planned_minutes: 15,
      reason: "Tea break",
    };

    const emergencyAppt = {
      id: "em-1",
      counselor: doctorId,
      priority: "emergency",
      appointment_status: "completed",
      consultation_timing: {
        startedAt: "2026-09-26T13:30:00+05:30",
        endedAt: "2026-09-26T14:00:00+05:30",
        durationMinutes: 30,
      },
      consultation_started_at: new Date("2026-09-26T13:30:00+05:30"),
      consultation_ended_at: new Date("2026-09-26T14:00:00+05:30"),
      emergency_reason: "Acute trauma",
    };

    sandbox.stub(DoctorBreak, "find").resolves([doctorBreak]);
    sandbox.stub(Appointment, "find").resolves([emergencyAppt]);
    sandbox.stub(WalkinAppointment, "find").resolves([]);

    const patientAppt = {
      id: "pt-1",
      counselor: doctorId,
      patient: "patient-1",
      appointment_date: today,
      appointment_time: "14:00:00",
      status: "pending",
      priority: "regular",
    };

    const enriched = await enrichAppointmentsWithDelay([patientAppt], doctorId, today);

    expect(enriched).to.have.lengthOf(1);
    expect(enriched[0].delay_minutes).to.equal(0);
    expect(enriched[0].original_appointment_time).to.equal("14:00:00");
    expect(enriched[0].estimated_appointment_time).to.equal("14:00:00");
    expect(enriched[0].delay_reason).to.equal(null);
    expect(enriched[0].delay_reason).to.equal(null);
  });
});
