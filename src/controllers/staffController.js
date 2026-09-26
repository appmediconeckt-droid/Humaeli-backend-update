import User from "../models/userModel.js";
import bcrypt from "bcryptjs";
import {
  authenticatedDoctorId, clinicError, clinicStaffRepository, ensureClinicStaffSchema,
  normalizeStaffRole, requireOwnedClinic, staffRoles, withOwnedClinic,
} from "../services/clinicStaffService.js";

const formatStaff = (u) => ({
  id: u.id || u._id, rawId: u.id || u._id, _id: u.id || u._id,
  employeeId: `STF-${u.id || u._id}`,
  name: u.fullName, fullName: u.fullName, full_name: u.fullName,
  email: u.email || "", phone: u.phoneNumber || "", contact_number: u.phoneNumber || "",
  role: u.role, department: u.department || "General", shift: u.shift || "Morning",
  clinic_id: u.clinic_id || null, clinic_name: u.clinic_name || null,
  assignedDoctor: u.assignedDoctor,
  status: u.isActive === false || Number(u.isActive) === 0 ? "Suspended" : "Active",
  verification: u.isVerified ? "Verified" : "Pending",
  lastLogin: u.lastSeen ? new Date(u.lastSeen).toLocaleDateString() : "Not logged in",
  createdAt: u.createdAt,
});
const fail = (res, error, message) => res.status(error.status || 500).json({
  success: false, message: error.status ? error.message : message,
});
const ownedStaff = async (req) => {
  const staff = await User.findOne({ _id: req.params.id, assignedDoctor: authenticatedDoctorId(req), role: { $in: staffRoles } });
  if (!staff) throw clinicError("Staff member not found", 404);
  return staff;
};

export const getStaff = async (req, res) => {
  try {
    await ensureClinicStaffSchema();
    const doctorId = authenticatedDoctorId(req);
    const clinicId = req.query.clinic_id || req.query.clinicId;
    if (clinicId && !["all", "unassigned"].includes(clinicId)) await requireOwnedClinic(doctorId, clinicId);
    let sql = `SELECT u.id, u.fullName, u.email, u.phoneNumber, u.role, u.department,
      u.shift, u.isActive, u.isVerified, u.lastSeen, u.createdAt, u.assignedDoctor,
      u.clinic_id, c.clinic_name FROM users u
      LEFT JOIN clinics c ON c.id = u.clinic_id AND c.doctor_id = u.assignedDoctor
      WHERE u.assignedDoctor = ? AND u.role IN (${staffRoles.map(() => "?").join(",")})`;
    const params = [doctorId, ...staffRoles];
    if (clinicId === "unassigned") sql += " AND (u.clinic_id IS NULL OR u.clinic_id = '')";
    else if (clinicId && clinicId !== "all") { sql += " AND u.clinic_id = ?"; params.push(clinicId); }
    if (req.query.role && req.query.role !== "all") { sql += " AND u.role = ?"; params.push(normalizeStaffRole(req.query.role)); }
    sql += " ORDER BY u.createdAt DESC";
    const [rows] = await clinicStaffRepository.query(sql, params);
    const staff = rows.map(formatStaff);
    return res.json({ success: true, data: staff, staff, users: staff, count: staff.length });
  } catch (error) { return fail(res, error, "Failed to fetch staff"); }
};

export const createStaff = async (req, res) => {
  try {
    const doctorId = authenticatedDoctorId(req);
    const body = req.body;
    const fullName = String(body.full_name || body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const role = normalizeStaffRole(body.role || "nurse");
    const clinicId = body.clinic_id || body.clinicId;
    if (!fullName) throw clinicError("Staff name is required");
    if (!email) throw clinicError("Staff email is required");
    if (!staffRoles.includes(role)) throw clinicError("Invalid staff role");
    if (!clinicId) throw clinicError("Please select a clinic or hospital");
    await ensureClinicStaffSchema();
    const formatted = await withOwnedClinic(doctorId, clinicId, async (clinic) => {
      if (await User.findOne({ email })) throw clinicError("Email already exists", 409);
      const password = await bcrypt.hash(body.password || "Temp@12345", 10);
      const staff = await User.create({
        fullName, email, role, password, assignedDoctor: doctorId, clinic_id: String(clinicId),
        phoneNumber: body.contact_number || body.phone || "",
        department: body.department || "General", shift: body.shift || "Morning",
        dateOfBirth: body.date_of_birth ? new Date(body.date_of_birth) : null,
        gender: body.gender || "Not specified", isActive: 1, isVerified: 1,
      });
      return formatStaff({ ...staff, clinic_name: clinic.clinic_name });
    });
    return res.status(201).json({ success: true, message: "Staff member created successfully", user: formatted, data: formatted });
  } catch (error) { return fail(res, error, "Failed to create staff member"); }
};

export const updateStaff = async (req, res) => {
  try {
    await ensureClinicStaffSchema();
    const staff = await ownedStaff(req);
    const body = req.body;
    const updates = {};
    const aliases = { full_name: "fullName", name: "fullName", fullName: "fullName", email: "email", contact_number: "phoneNumber", phone: "phoneNumber", department: "department", shift: "shift", gender: "gender" };
    for (const [input, field] of Object.entries(aliases)) {
      if (body[input] !== undefined) updates[field] = String(body[input]).trim();
    }
    if (updates.fullName === "" || updates.email === "") throw clinicError("Staff name and email cannot be empty");
    if (updates.email) {
      updates.email = updates.email.toLowerCase();
      const existing = await User.findOne({ email: updates.email, _id: { $ne: req.params.id } });
      if (existing) throw clinicError("Email already exists", 409);
    }
    if (body.role !== undefined) {
      updates.role = normalizeStaffRole(body.role);
      if (!staffRoles.includes(updates.role)) throw clinicError("Invalid staff role");
    }
    if (body.isActive !== undefined) updates.isActive = body.isActive === true || body.isActive === 1;
    const clinicId = body.clinic_id ?? body.clinicId ?? staff.clinic_id;
    if (!clinicId) throw clinicError("Please assign this staff member to a clinic or hospital");
    const formatted = await withOwnedClinic(authenticatedDoctorId(req), clinicId, async (clinic) => {
      updates.clinic_id = String(clinicId);
      const updated = await User.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
      return formatStaff({ ...updated, clinic_name: clinic.clinic_name });
    });
    return res.json({ success: true, message: "Staff updated successfully", user: formatted, data: formatted });
  } catch (error) { return fail(res, error, "Failed to update staff member"); }
};

export const deleteStaff = async (req, res) => {
  try {
    await ownedStaff(req);
    await User.deleteOne({ _id: req.params.id, assignedDoctor: authenticatedDoctorId(req), role: { $in: staffRoles } });
    return res.json({ success: true, message: "Staff member deleted successfully" });
  } catch (error) { return fail(res, error, "Failed to delete staff member"); }
};
