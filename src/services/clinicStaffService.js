import { createHash } from "node:crypto";
import { getPool, query } from "../config/mysql.js";
import { invalidateTableColumns } from "../models/mysql/BaseModel.js";
import Clinic from "../models/clinicModel.js";
import User from "../models/userModel.js";
import DateRange from "../models/dateRangeModel.js";
import Appointment from "../models/appointmentModel.js";
import WalkinAppointment from "../models/walkinAppointmentModel.js";

export const clinicStaffRepository = {
  query,
  connection: () => getPool().getConnection(),
};
export const clinicError = (message, status = 400) => Object.assign(new Error(message), { status });
export const authenticatedDoctorId = (req) => req.userId || req.user?._id || req.user?.id;
export const staffRoles = ["nurse", "staff", "assistant", "technician", "receptionist", "housekeeping", "supervisor", "manager", "billing"];
export const normalizeStaffRole = (value) => {
  const role = String(value || "").trim().toLowerCase();
  return ({ "medical assistant": "assistant", "lab technician": "technician", "billing staff": "billing", "department manager": "manager" })[role] || role;
};

let schemaReady;
export function ensureClinicStaffSchema() {
  if (!schemaReady) schemaReady = (async () => {
    for (const table of ["users", "appointments", "walkin_appointments"]) {
      const [columns] = await clinicStaffRepository.query(`SHOW COLUMNS FROM \`${table}\` LIKE 'clinic_id'`);
      if (!columns.length) {
        try {
          await clinicStaffRepository.query(`ALTER TABLE \`${table}\` ADD COLUMN clinic_id VARCHAR(64) NULL`);
        } catch (error) {
          if (error.code !== "ER_DUP_FIELDNAME") throw error;
        }
        invalidateTableColumns(table);
      }
    }
  })().catch((error) => { schemaReady = undefined; throw error; });
  return schemaReady;
}

export async function requireOwnedClinic(doctorId, clinicId) {
  if (!doctorId) throw clinicError("Authentication required", 401);
  if (!clinicId) throw clinicError("Please select a clinic or hospital");
  const clinic = await Clinic.findOne({ _id: clinicId, doctor_id: doctorId });
  if (!clinic) throw clinicError("Clinic not found for this doctor", 404);
  return clinic;
}

// Assignment and deletion share a lock so a clinic cannot disappear while
// a staff member is being assigned to it.
export async function withOwnedClinic(doctorId, clinicId, action) {
  if (!clinicId) throw clinicError("Please select a clinic or hospital");
  const connection = await clinicStaffRepository.connection();
  const key = `clinic:${createHash("sha256").update(String(clinicId)).digest("hex").slice(0, 48)}`;
  let locked = false;
  try {
    const [rows] = await connection.query("SELECT GET_LOCK(?, 5) AS acquired", [key]);
    locked = Number(rows[0]?.acquired) === 1;
    if (!locked) throw clinicError("Clinic is busy. Please try again.", 409);
    return await action(await requireOwnedClinic(doctorId, clinicId));
  } finally {
    try { if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [key]); }
    finally { connection.release(); }
  }
}

export async function removeOwnedClinic(doctorId, clinicId) {
  await ensureClinicStaffSchema();
  return withOwnedClinic(doctorId, clinicId, async () => {
    const [staff, schedules, appointments, walkins] = await Promise.all([
      User.countDocuments({ clinic_id: clinicId }),
      DateRange.countDocuments({ clinic_id: clinicId }),
      Appointment.countDocuments({ clinic_id: clinicId }),
      WalkinAppointment.countDocuments({ clinic_id: clinicId }),
    ]);
    if (staff) throw clinicError("Move or remove this clinic's staff before deleting the clinic.", 409);
    if (appointments || walkins) throw clinicError("This clinic has appointment records and cannot be deleted. Its patient history must be preserved.", 409);
    if (schedules) throw clinicError("Clear this clinic's availability timings before deleting the clinic.", 409);
    await Clinic.deleteOne({ _id: clinicId, doctor_id: doctorId });
  });
}
