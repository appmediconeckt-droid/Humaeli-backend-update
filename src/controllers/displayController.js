// src/controllers/displayController.js
import { query } from "../config/mysql.js";
import Display from "../models/mysql/DisplayModel.js";
import Facility from "../models/mysql/FacilityModel.js";
import Department from "../models/mysql/DepartmentModel.js";
import { generateObjectId } from "../models/mysql/BaseModel.js";
import { getDoctorQueueData } from "./queueController.js";
import { queueToday } from '../utils/queueDate.js';
import { clinicDisplayQueue, notifyClinicDisplayPatients } from '../services/clinicDisplayQueue.js';
import { getDisplayTiming } from '../services/displayTimingService.js';

const DISPLAY_TYPES = ["doctor", "department", "floor", "hospital", "reception"];

const ok = (res, data, status = 200) => res.status(status).json({ success: true, ...data });
const fail = (res, msg, status = 400) => res.status(status).json({ success: false, message: msg });

function todayStr() {
  return queueToday();
}

// ─── DISPLAY CRUD ────────────────────────────────────────────────────────────
/**
 * POST /api/displays
 * Body: { facilityId, name, displayType, departmentId?, doctorId?, floor?, theme? }
 */
export const createDisplay = async (req, res) => {
  try {
    const { facilityId, name, displayType, departmentId, doctorId, floor, theme } = req.body;
    if (!facilityId || !name || !displayType) {
      return fail(res, "facilityId, name and displayType are required.");
    }
    if (!DISPLAY_TYPES.includes(displayType)) {
      return fail(res, `displayType must be one of: ${DISPLAY_TYPES.join(", ")}`);
    }

    if (displayType === 'doctor' && !doctorId) return fail(res, 'doctorId is required for a doctor display.');
    if (displayType === 'department' && !departmentId) return fail(res, 'departmentId is required for a department display.');
    if (displayType === 'floor' && !floor) return fail(res, 'floor is required for a floor display.');
    const facility = await Facility.findById(facilityId);
    if (!facility) return fail(res, "Facility not found", 404);

    const display = await Display.create({
      id: generateObjectId(),
      facilityId,
      name,
      displayType,
      departmentId: departmentId || null,
      doctorId: doctorId || null,
      floor: floor || null,
      isActive: true,
      theme: theme || null,
    });
    return ok(res, { message: "Display created", display, displayUrl: `/display/${display.id || display._id}` }, 201);
  } catch (err) {
    console.error("createDisplay error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

export const getDisplaysByFacility = async (req, res) => {
  try {
    const displays = await Display.find({ facilityId: req.params.facilityId, isActive: true });
    return ok(res, { displays });
  } catch (err) {
    console.error("getDisplaysByFacility error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

export const updateDisplay = async (req, res) => {
  try {
    const display = await Display.findById(req.params.id);
    if (!display) return fail(res, "Display not found", 404);

    const allowed = ["name", "displayType", "departmentId", "doctorId", "floor", "isActive", "theme"];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    await Display.updateOne({ _id: req.params.id }, updates);
    const updated = await Display.findById(req.params.id);
    return ok(res, { message: "Display updated", display: updated });
  } catch (err) {
    console.error("updateDisplay error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

export const deleteDisplay = async (req, res) => {
  try {
    const display = await Display.findById(req.params.id);
    if (!display) return fail(res, "Display not found", 404);
    await Display.updateOne({ _id: req.params.id }, { isActive: false });
    return ok(res, { message: "Display deactivated" });
  } catch (err) {
    console.error("deleteDisplay error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

// ─── DISPLAY QUEUE DATA (READ-ONLY LIVE VIEW) ────────────────────────────────
/**
 * GET /api/displays/:displayId/queue
 * This is what the TV page calls on mount to get initial state.
 * Then it connects to socket for live updates.
 */
export const getDisplayQueue = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const display = await Display.findById(req.params.displayId);
    if (!display) return fail(res, "Display not found", 404);
    if (!display.isActive) return fail(res, "Display is inactive", 403);

    const { facilityId, displayType, departmentId, doctorId } = display;
    const queueDate = todayStr();

    // ── DOCTOR DISPLAY ──────────────────────────────────────────────────────
    if (displayType === "doctor") {
      if (!doctorId) return fail(res, "This display has no doctor configured.", 422);
      const [links] = await query('SELECT * FROM doctor_clinic_links WHERE facility_id=? AND doctor_id=? AND is_active=1 LIMIT 1', [facilityId, doctorId]);
      const data = links[0] ? await clinicDisplayQueue(links[0], queueDate) : await getDoctorQueueData(facilityId, doctorId, queueDate);
      if (links[0]) await notifyClinicDisplayPatients(links[0], queueDate, data);
      const timing = await getDisplayTiming({ doctorId, date: queueDate, clinicId: links[0]?.clinic_id || '',
        nextAppointmentId: data.waiting[0]?.appointmentId, nextToken: data.waiting[0]?.tokenNumber });

      // Fetch facility info
      const facility = await Facility.findById(facilityId);
      const [docRows] = await query("SELECT fullName, specialization FROM `users` WHERE id = ? LIMIT 1", [doctorId]);
      const doctor = docRows?.[0] || {};
      const [mappingRows] = await query('SELECT roomId FROM doctor_facilities WHERE facilityId = ? AND doctorId = ? AND isActive = 1 LIMIT 1', [facilityId, doctorId]);

      return ok(res, {
        displayType: "doctor",
        displayId: display.id,
        displayName: display.name,
        facility: { id: facilityId, name: facility?.name },
        doctor: { id: doctorId, name: doctor.fullName, specialization: doctor.specialization },
        roomId: data.current?.roomId || mappingRows?.[0]?.roomId || null,
        queueDate,
        current: data.current ? { token: data.current.tokenNumber, status: data.current.status } : null,
        nextTokens: data.waiting.slice(0, 2).map(e => e.tokenNumber),
        waitingCount: data.waitingCount,
        totalPatients: data.totalPatients,
        completedCount: data.completedCount,
        ...timing,
      });
    }

    // ── DEPARTMENT DISPLAY ──────────────────────────────────────────────────
    if (displayType === "department") {
      if (!departmentId) return fail(res, "This display has no department configured.", 422);

      const dept = await Department.findById(departmentId);
      const [doctorRows] = await query(
        `SELECT df.doctorId, df.roomId, u.fullName AS doctorName
         FROM \`doctor_facilities\` df
         LEFT JOIN \`users\` u ON u.id = df.doctorId
         WHERE df.facilityId = ? AND df.departmentId = ? AND df.isActive = 1`,
        [facilityId, departmentId]
      );

      const doctors = await Promise.all((doctorRows || []).map(async (row) => {
        const data = await getDoctorQueueData(facilityId, row.doctorId, queueDate);
        return {
          doctorId: row.doctorId,
          doctorName: row.doctorName,
          roomId: row.roomId,
          current: data.current ? { token: data.current.tokenNumber } : null,
          nextToken: data.waiting[0]?.tokenNumber || null,
          waitingCount: data.waitingCount,
        };
      }));

      const facility = await Facility.findById(facilityId);

      return ok(res, {
        displayType: "department",
        displayId: display.id,
        displayName: display.name,
        facility: { id: facilityId, name: facility?.name },
        department: { id: departmentId, name: dept?.name, floor: dept?.floor },
        queueDate,
        doctors,
      });
    }

    // ── HOSPITAL / FLOOR DISPLAY ────────────────────────────────────────────
    if (displayType === "hospital" || displayType === "floor" || displayType === "reception") {
      let sql = `SELECT df.doctorId, df.departmentId, df.roomId, u.fullName AS doctorName, dep.name AS departmentName
                 FROM \`doctor_facilities\` df
                 LEFT JOIN \`users\` u ON u.id = df.doctorId
                 LEFT JOIN \`departments\` dep ON dep.id = df.departmentId
                 WHERE df.facilityId = ? AND df.isActive = 1`;
      const params = [facilityId];

      if (displayType === "floor" && display.floor) {
        sql += " AND dep.floor = ?";
        params.push(display.floor);
      }

      const [doctorRows] = await query(sql, params);

      const doctors = await Promise.all((doctorRows || []).map(async (row) => {
        const data = await getDoctorQueueData(facilityId, row.doctorId, queueDate);
        return {
          doctorId: row.doctorId,
          doctorName: row.doctorName,
          departmentId: row.departmentId,
          departmentName: row.departmentName,
          roomId: row.roomId,
          current: data.current ? { token: data.current.tokenNumber } : null,
          nextToken: data.waiting[0]?.tokenNumber || null,
          waitingCount: data.waitingCount,
        };
      }));

      const facility = await Facility.findById(facilityId);

      // Group by department for display
      const grouped = {};
      for (const d of doctors) {
        const key = d.departmentId || "other";
        if (!grouped[key]) grouped[key] = { departmentName: d.departmentName || "General", doctors: [] };
        grouped[key].doctors.push(d);
      }

      return ok(res, {
        displayType,
        displayId: display.id,
        displayName: display.name,
        facility: { id: facilityId, name: facility?.name },
        queueDate,
        departments: Object.values(grouped),
      });
    }

    return fail(res, `Unsupported displayType: ${displayType}`, 422);
  } catch (err) {
    console.error("getDisplayQueue error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};
