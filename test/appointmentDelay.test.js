import { expect } from "chai";
import sinon from "sinon";
import { calculateDoctorDelays, enrichAppointmentsWithDelay } from "../src/services/appointmentDelayService.js";
import DoctorBreak from "../src/models/doctorBreakModel.js";
import Appointment from "../src/models/appointmentModel.js";
import WalkinAppointment from "../src/models/walkinAppointmentModel.js";

describe("Appointment Delay Service (Doctor Break & Emergency Shifts)", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("calculates 30-minute delay for subsequent patient when an emergency takes 30 minutes", async () => {
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
    expect(enriched[0].delay_minutes).to.equal(30);
    expect(enriched[0].original_appointment_time).to.equal("14:00:00");
    expect(enriched[0].estimated_appointment_time).to.equal("14:30:00");
    expect(enriched[0].delay_reason).to.include("Emergency consultation (30 min)");
  });

  it("calculates 15-minute delay for subsequent patient when doctor takes a 15-minute break", async () => {
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
    expect(enriched[0].delay_minutes).to.equal(15);
    expect(enriched[0].original_appointment_time).to.equal("14:00:00");
    expect(enriched[0].estimated_appointment_time).to.equal("14:15:00");
    expect(enriched[0].delay_reason).to.include("Doctor break (15 min)");
  });

  it("accumulates both emergency time (30m) and break time (15m) to shift 2:00 PM appointment to 2:45 PM", async () => {
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
    expect(enriched[0].delay_minutes).to.equal(45);
    expect(enriched[0].original_appointment_time).to.equal("14:00:00");
    expect(enriched[0].estimated_appointment_time).to.equal("14:45:00");
    expect(enriched[0].delay_reason).to.include("Doctor break (15 min)");
    expect(enriched[0].delay_reason).to.include("Emergency consultation (30 min)");
  });
});
