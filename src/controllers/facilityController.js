// src/controllers/facilityController.js
import { query } from "../config/mysql.js";
import Facility from "../models/mysql/FacilityModel.js";
import Department from "../models/mysql/DepartmentModel.js";
import DoctorFacility from "../models/mysql/DoctorFacilityModel.js";
import DoctorSchedule from "../models/mysql/DoctorScheduleModel.js";
import { generateObjectId } from "../models/mysql/BaseModel.js";
import { ensureFacilityQr } from '../services/clinicQrService.js';

const DAYS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];

// ─── UTILITY ────────────────────────────────────────────────────────────────
const ok = (res, data, status = 200) => res.status(status).json({ success: true, ...data });
const fail = (res, msg, status = 400) => res.status(status).json({ success: false, message: msg });

// ─── FACILITY CRUD ──────────────────────────────────────────────────────────
export const createFacility = async (req, res) => {
  try {
    const { name, type = "hospital", address, phone, email, organizationId } = req.body;
    if (!name) return fail(res, "Facility name is required.");

    const facility = await Facility.create({
      id: generateObjectId(),
      organizationId: organizationId || null,
      name,
      type,
      address: address || null,
      phone: phone || null,
      email: email || null,
      status: "active",
    });
    return ok(res, { message: "Facility created successfully", facility }, 201);
  } catch (err) {
    console.error("createFacility error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

export const getAllFacilities = async (req, res) => {
  try {
    const filter = {};
    if (req.query.type) filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status;

    const facilities = await Facility.find(filter).sort({ createdAt: -1 });
    return ok(res, { facilities });
  } catch (err) {
    console.error("getAllFacilities error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

export const getFacilityById = async (req, res) => {
  try {
    const facility = await Facility.findById(req.params.id);
    if (!facility) return fail(res, "Facility not found", 404);

    // Attach departments
    const departments = await Department.find({ facilityId: facility.id });
    return ok(res, { facility, departments });
  } catch (err) {
    console.error("getFacilityById error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

export const updateFacility = async (req, res) => {
  try {
    const facility = await Facility.findById(req.params.id);
    if (!facility) return fail(res, "Facility not found", 404);

    const allowed = ["name", "type", "address", "phone", "email", "status", "organizationId"];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    await Facility.updateOne({ _id: req.params.id }, updates);
    const updated = await Facility.findById(req.params.id);
    return ok(res, { message: "Facility updated", facility: updated });
  } catch (err) {
    console.error("updateFacility error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

export const deleteFacility = async (req, res) => {
  try {
    const facility = await Facility.findById(req.params.id);
    if (!facility) return fail(res, "Facility not found", 404);
    await Facility.deleteOne({ _id: req.params.id });
    return ok(res, { message: "Facility deleted" });
  } catch (err) {
    console.error("deleteFacility error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

// ─── DEPARTMENT CRUD ────────────────────────────────────────────────────────
export const createDepartment = async (req, res) => {
  try {
    const { facilityId, name, code, floor } = req.body;
    if (!facilityId || !name || !code) return fail(res, "facilityId, name and code are required.");

    const facility = await Facility.findById(facilityId);
    if (!facility) return fail(res, "Facility not found", 404);

    const dept = await Department.create({
      id: generateObjectId(),
      facilityId,
      name,
      code: code.toUpperCase(),
      floor: floor || null,
      status: "active",
    });
    return ok(res, { message: "Department created", department: dept }, 201);
  } catch (err) {
    console.error("createDepartment error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

export const getDepartmentsByFacility = async (req, res) => {
  try {
    const departments = await Department.find({ facilityId: req.params.facilityId }).sort({ name: 1 });
    return ok(res, { departments });
  } catch (err) {
    console.error("getDepartmentsByFacility error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

export const updateDepartment = async (req, res) => {
  try {
    const dept = await Department.findById(req.params.id);
    if (!dept) return fail(res, "Department not found", 404);

    const allowed = ["name", "code", "floor", "status"];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.code) updates.code = updates.code.toUpperCase();

    await Department.updateOne({ _id: req.params.id }, updates);
    const updated = await Department.findById(req.params.id);
    return ok(res, { message: "Department updated", department: updated });
  } catch (err) {
    console.error("updateDepartment error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

export const deleteDepartment = async (req, res) => {
  try {
    const dept = await Department.findById(req.params.id);
    if (!dept) return fail(res, "Department not found", 404);
    await Department.deleteOne({ _id: req.params.id });
    return ok(res, { message: "Department deleted" });
  } catch (err) {
    console.error("deleteDepartment error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

// ─── DOCTOR–FACILITY MAPPING ────────────────────────────────────────────────
export const addDoctorToFacility = async (req, res) => {
  try {
    const { doctorId, facilityId, departmentId, roomId, consultationDuration = 15 } = req.body;
    if (!doctorId || !facilityId) return fail(res, "doctorId and facilityId are required.");

    const facility = await Facility.findById(facilityId);
    if (!facility) return fail(res, "Facility not found", 404);

    const existing = await DoctorFacility.findOne({ doctorId, facilityId });
    if (existing) {
      // Update existing mapping instead
      await DoctorFacility.updateOne({ _id: existing.id }, {
        departmentId: departmentId || existing.departmentId,
        roomId: roomId || existing.roomId,
        consultationDuration,
        isActive: true,
      });
      const updated = await DoctorFacility.findById(existing.id);
      return ok(res, { message: "Doctor-Facility mapping updated", mapping: updated, ...await ensureFacilityQr(updated) });
    }

    const mapping = await DoctorFacility.create({
      id: generateObjectId(),
      doctorId,
      facilityId,
      departmentId: departmentId || null,
      roomId: roomId || null,
      consultationDuration,
      isActive: true,
    });
    return ok(res, { message: "Doctor added to facility", mapping, ...await ensureFacilityQr(mapping) }, 201);
  } catch (err) {
    console.error("addDoctorToFacility error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

export const getDoctorFacilities = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const mappings = await DoctorFacility.find({ doctorId, isActive: true });

    // Enrich with facility and department names
    const enriched = await Promise.all(mappings.map(async (m) => {
      const facility = await Facility.findById(m.facilityId);
      const dept = m.departmentId ? await Department.findById(m.departmentId) : null;
      return { ...m, facilityName: facility?.name || null, departmentName: dept?.name || null };
    }));

    return ok(res, { mappings: enriched });
  } catch (err) {
    console.error("getDoctorFacilities error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

export const getFacilityDoctors = async (req, res) => {
  try {
    const { facilityId } = req.params;
    const { departmentId } = req.query;

    const filter = { facilityId, isActive: true };
    if (departmentId) filter.departmentId = departmentId;

    const mappings = await DoctorFacility.find(filter);

    // Fetch doctor basic info
    const doctorIds = mappings.map(m => m.doctorId);
    let doctors = [];
    if (doctorIds.length > 0) {
      const placeholders = doctorIds.map(() => "?").join(", ");
      const [rows] = await query(
        `SELECT id, fullName, specialization, profilePhoto FROM \`users\` WHERE id IN (${placeholders}) AND role = 'doctor'`,
        doctorIds
      );
      doctors = rows || [];
    }

    const docMap = {};
    for (const d of doctors) docMap[d.id] = d;

    const enriched = mappings.map(m => ({
      ...m,
      doctor: docMap[m.doctorId] || null,
    }));

    return ok(res, { doctors: enriched });
  } catch (err) {
    console.error("getFacilityDoctors error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

export const removeDoctorFromFacility = async (req, res) => {
  try {
    const { id } = req.params;
    const mapping = await DoctorFacility.findById(id);
    if (!mapping) return fail(res, "Mapping not found", 404);
    await DoctorFacility.updateOne({ _id: id }, { isActive: false });
    return ok(res, { message: "Doctor removed from facility" });
  } catch (err) {
    console.error("removeDoctorFromFacility error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

// ─── DOCTOR SCHEDULE ────────────────────────────────────────────────────────
export const createOrUpdateSchedule = async (req, res) => {
  try {
    const { doctorId, facilityId, departmentId, day, startTime, endTime, slotDuration = 15, maxPatients = 20 } = req.body;
    if (!doctorId || !facilityId || !day || !startTime || !endTime) {
      return fail(res, "doctorId, facilityId, day, startTime and endTime are required.");
    }
    if (!DAYS.includes(day.toLowerCase())) {
      return fail(res, `day must be one of: ${DAYS.join(", ")}`);
    }

    const existing = await DoctorSchedule.findOne({ doctorId, facilityId, day: day.toLowerCase() });
    if (existing) {
      await DoctorSchedule.updateOne({ _id: existing.id }, {
        departmentId: departmentId || existing.departmentId,
        startTime,
        endTime,
        slotDuration,
        maxPatients,
        isActive: true,
      });
      const updated = await DoctorSchedule.findById(existing.id);
      return ok(res, { message: "Schedule updated", schedule: updated });
    }

    const schedule = await DoctorSchedule.create({
      id: generateObjectId(),
      doctorId,
      facilityId,
      departmentId: departmentId || null,
      day: day.toLowerCase(),
      startTime,
      endTime,
      slotDuration,
      maxPatients,
      isActive: true,
    });
    return ok(res, { message: "Schedule created", schedule }, 201);
  } catch (err) {
    console.error("createOrUpdateSchedule error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

export const getDoctorSchedule = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { facilityId } = req.query;

    const filter = { doctorId, isActive: true };
    if (facilityId) filter.facilityId = facilityId;

    const schedules = await DoctorSchedule.find(filter).sort({ day: 1 });
    return ok(res, { schedules });
  } catch (err) {
    console.error("getDoctorSchedule error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

export const deleteSchedule = async (req, res) => {
  try {
    const sch = await DoctorSchedule.findById(req.params.id);
    if (!sch) return fail(res, "Schedule not found", 404);
    await DoctorSchedule.updateOne({ _id: req.params.id }, { isActive: false });
    return ok(res, { message: "Schedule disabled" });
  } catch (err) {
    console.error("deleteSchedule error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};
