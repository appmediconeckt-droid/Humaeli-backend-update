import { query } from "../config/mysql.js";
import { invalidateTableColumns } from "../models/mysql/BaseModel.js";
import Appointment from "../models/appointmentModel.js";
import User from "../models/userModel.js";
import { ensureClinicStaffSchema, withOwnedClinic } from "./clinicStaffService.js";

export const emergencyAppointmentRepository = { query };
const invalid = (message) => Object.assign(new Error(message), { status: 400 });

export function validateAppointmentPriority(body) {
  const priority = body.priority === undefined ? "normal" : body.priority;
  if (!["normal", "emergency"].includes(priority)) throw invalid("Select a valid appointment type");
  if (priority === "normal") return { priority, emergency_reason: null };
  const reason = typeof body.emergency_reason === "string" ? body.emergency_reason.trim() : "";
  if (reason.length < 1 || reason.length > 1000) throw invalid("Describe the emergency");
  if (!body.clinic_id) throw invalid("Select a clinic for the emergency appointment");
  return { priority, emergency_reason: reason };
}

let schemaReady;
export function ensureEmergencyAppointmentSchema() {
  if (!schemaReady) schemaReady = (async () => {
    for (const [column, definition] of [
      ["priority", "VARCHAR(64) NULL DEFAULT 'normal'"], ["emergency_reason", "TEXT NULL"],
      ["appointment_date", "DATE NULL"], ["appointment_time", "TIME NULL"],
      ["token_number", "INT NULL"], ["slot_key", "VARCHAR(255) NULL"],
    ]) {
      const [columns] = await emergencyAppointmentRepository.query(`SHOW COLUMNS FROM appointments LIKE '${column}'`);
      if (!columns.length) {
        try { await emergencyAppointmentRepository.query(`ALTER TABLE appointments ADD COLUMN ${column} ${definition}`); }
        catch (error) { if (error.code !== "ER_DUP_FIELDNAME") throw error; }
      } else if (column === "priority" && /^enum\(/i.test(columns[0].Type || "") && !columns[0].Type.toLowerCase().includes("'emergency'")) {
        // Preserve existing priority values while allowing the emergency value.
        await emergencyAppointmentRepository.query("ALTER TABLE appointments MODIFY COLUMN priority VARCHAR(64) NULL DEFAULT 'normal'");
      } else if (["appointment_time", "token_number", "slot_key"].includes(column) && columns[0].Null === "NO") {
        await emergencyAppointmentRepository.query(`ALTER TABLE appointments MODIFY COLUMN ${column} ${columns[0].Type} NULL DEFAULT NULL`);
      }
    }
    invalidateTableColumns("appointments");
  })().catch((error) => { schemaReady = undefined; throw error; });
  return schemaReady;
}

export async function createEmergencyAppointment({ patientId, doctorId, body }) {
  const priority = validateAppointmentPriority(body);
  await ensureEmergencyAppointmentSchema();
  await ensureClinicStaffSchema();
  return withOwnedClinic(doctorId, body.clinic_id, async () => {
    const now = new Date();
    const today = new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
    const existing = await Appointment.findOne({ patient: patientId, counselor: doctorId,
      clinic_id: String(body.clinic_id), appointment_date: today, priority: "emergency",
      appointment_time: null, status: { $in: ["pending", "accepted", "booked", "confirmed", "in-progress"] } });
    if (existing) throw Object.assign(new Error("You already have an active emergency request at this clinic. Check My Appointments."), { status: 409 });
    const staff = await User.find({ assignedDoctor: doctorId, clinic_id: String(body.clinic_id),
      isActive: true, role: { $in: ["nurse", "receptionist", "assistant", "manager", "supervisor"] },
    }).select("_id");
    const appointment = await Appointment.create({
      ...priority, patient: patientId, counselor: doctorId, clinic_id: String(body.clinic_id),
      date: now, appointment_date: today, appointment_time: null, token_number: null, slot_key: null,
      consultation_mode: "in-clinic", booking_source: "online", status: "pending",
      notes: body.notes || null, patient_location: body.patient_location || null,
    });
    return { appointment, staffIds: [...new Set(staff.map((person) => String(person._id || person.id)))] };
  });
}
