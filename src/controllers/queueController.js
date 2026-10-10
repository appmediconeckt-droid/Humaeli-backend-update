// src/controllers/queueController.js
import { query } from "../config/mysql.js";
import QueueEntry from "../models/mysql/QueueEntryModel.js";
import Facility from "../models/mysql/FacilityModel.js";
import Department from "../models/mysql/DepartmentModel.js";
import DoctorFacility from "../models/mysql/DoctorFacilityModel.js";
import { generateObjectId } from "../models/mysql/BaseModel.js";
import { queueToday } from '../utils/queueDate.js';
import { withQueueMutex } from '../services/queueMutex.js';
import { notifyNextQueueTokens } from '../services/queueTurnNotificationService.js';

// Valid queue statuses
const VALID_STATUSES = ["waiting", "called", "in_consultation", "completed", "skipped", "cancelled", "no_show"];
const VALID_SOURCES = ["qr", "app", "reception", "walk_in", "admin"];

const ok = (res, data, status = 200) => res.status(status).json({ success: true, ...data });
const fail = (res, msg, status = 400) => res.status(status).json({ success: false, message: msg });

/**
 * Generate today's date string YYYY-MM-DD
 */
function todayStr() {
  return queueToday();
}

/**
 * Generate a token prefix for a doctor: e.g., "AM" from "Dr Amit Mehta"
 */
function buildTokenPrefix(doctorName) {
  if (!doctorName) return "T";
  const parts = doctorName.replace(/^Dr\.?\s*/i, "").trim().split(" ").filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.slice(0, 2) || "T").toUpperCase();
}

/**
 * Get the next queue position for a doctor on a specific date
 */
async function getNextPosition(facilityId, doctorId, queueDate) {
  const [rows] = await query(
    `SELECT COALESCE(MAX(\`queuePosition\`), 0) AS maxPos
     FROM \`queue_entries\`
     WHERE \`facilityId\` = ? AND \`doctorId\` = ? AND \`queueDate\` = ?`,
    [facilityId, doctorId, queueDate]
  );
  return (Number(rows[0]?.maxPos) || 0) + 1;
}

/**
 * Emit real-time queue update through Socket.IO
 */
function emitQueueUpdate(facilityId, departmentId, doctorId, payload) {
  const io = global.io;
  if (!io) return;
  // Notify doctor's room
  io.to(`doctor:${doctorId}`).emit("queueUpdated", payload);
  // Notify department room (for department TV)
  if (departmentId) io.to(`department:${departmentId}`).emit("queueUpdated", payload);
  // Notify facility room (for hospital-wide TV)
  io.to(`facility:${facilityId}`).emit("queueUpdated", payload);
}

// ─── CHECK-IN / CREATE QUEUE ENTRY ──────────────────────────────────────────
/**
 * POST /api/queue/check-in
 * Body: { patientName, patientPhone?, facilityId, doctorId, departmentId?, roomId?, bookingSource?, patientId?, appointmentId?, notes? }
 */
export const checkIn = async (req, res) => {
  const { facilityId, doctorId } = req.body || {};
  if (!facilityId || !doctorId) return fail(res, 'facilityId and doctorId are required.');
  try { return await withQueueMutex(facilityId, doctorId, todayStr(), () => checkInUnlocked(req, res)); }
  catch (error) { return fail(res, error.statusCode ? error.message : 'Unable to check in', error.statusCode || 500); }
};
const checkInUnlocked = async (req, res) => {
  try {
    const {
      patientName,
      patientPhone,
      facilityId,
      doctorId,
      departmentId,
      roomId,
      bookingSource = "reception",
      patientId,
      appointmentId,
      notes,
    } = req.body;

    if (!patientName) return fail(res, "patientName is required.");
    if (!facilityId) return fail(res, "facilityId is required.");
    if (!doctorId) return fail(res, "doctorId is required.");
    if (!VALID_SOURCES.includes(bookingSource)) {
      return fail(res, `bookingSource must be one of: ${VALID_SOURCES.join(", ")}`);
    }

    // Verify facility exists
    const facility = await Facility.findById(facilityId);
    if (!facility) return fail(res, "Facility not found.", 404);

    const queueDate = todayStr();
    const position = await getNextPosition(facilityId, doctorId, queueDate);

    // Fetch doctor name to build token prefix
    const [docRows] = await query("SELECT fullName FROM `users` WHERE id = ? LIMIT 1", [doctorId]);
    const doctorName = docRows?.[0]?.fullName || "";
    const prefix = buildTokenPrefix(doctorName);
    const tokenNumber = `${prefix}${String(position).padStart(3, "0")}`;

    // Determine roomId: if not passed, try to get from doctor_facilities mapping
    let resolvedRoomId = roomId || null;
    if (!resolvedRoomId) {
      const mapping = await DoctorFacility.findOne({ doctorId, facilityId, isActive: true });
      resolvedRoomId = mapping?.roomId || null;
    }

    const entry = await QueueEntry.create({
      id: generateObjectId(),
      appointmentId: appointmentId || null,
      patientId: patientId || null,
      patientName,
      patientPhone: patientPhone || null,
      facilityId,
      departmentId: departmentId || null,
      doctorId,
      roomId: resolvedRoomId,
      tokenNumber,
      queueDate,
      queuePosition: position,
      status: "waiting",
      bookingSource,
      notes: notes || null,
      checkedInAt: new Date(),
    });

    // Emit real-time update
    const queueSummary = await getDoctorQueueData(facilityId, doctorId, queueDate);
    emitQueueUpdate(facilityId, departmentId, doctorId, queueSummary);

    return ok(res, { message: "Patient checked-in successfully", entry, tokenNumber }, 201);
  } catch (err) {
    console.error("checkIn error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

// ─── GET TODAY'S QUEUE FOR A DOCTOR ──────────────────────────────────────────
/**
 * GET /api/queue/doctor/:doctorId
 * Query: ?facilityId=xxx&date=YYYY-MM-DD
 */
export const getDoctorQueue = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { facilityId, date } = req.query;

    if (!facilityId) return fail(res, "facilityId query param is required.");

    const queueDate = date || todayStr();
    const data = await getDoctorQueueData(facilityId, doctorId, queueDate);
    return ok(res, data);
  } catch (err) {
    console.error("getDoctorQueue error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

// ─── INTERNAL QUEUE DATA BUILDER ─────────────────────────────────────────────
export async function getDoctorQueueData(facilityId, doctorId, queueDate) {
  const [allRows] = await query(
    `SELECT * FROM \`queue_entries\`
     WHERE \`facilityId\` = ? AND \`doctorId\` = ? AND \`queueDate\` = ?
     ORDER BY \`queuePosition\` ASC`,
    [facilityId, doctorId, queueDate]
  );
  const all = allRows || [];

  const inConsultation = all.find(r => r.status === "in_consultation") || null;
  const waiting = all.filter(r => r.status === "waiting" || (inConsultation && r.status === "called"));
  const called = all.find(r => r.status === "called") || null;
  const completed = all.filter(r => r.status === "completed");
  const skipped = all.filter(r => r.status === "skipped");

  const current = inConsultation || called || null;

  if (queueDate === todayStr()) await notifyNextQueueTokens(waiting.filter(entry => entry.tokenNumber != null).map(entry => ({
    id: entry.appointmentId || entry.id, source: 'queue', token: entry.tokenNumber,
    patientId: entry.patientId,
  })), { doctorId, date: queueDate, clinicId: facilityId,
    currentAppointmentId: String(current?.appointmentId || current?.id || '') });

  return {
    facilityId,
    doctorId,
    queueDate,
    totalPatients: all.length,
    waitingCount: waiting.length,
    completedCount: completed.length,
    skippedCount: skipped.length,
    current,
    waiting: waiting.slice(0, 10),     // Next 10 in queue
    nextToken: waiting[0]?.tokenNumber || null,
    allEntries: all,
  };
}

// ─── CHANGE QUEUE STATUS ──────────────────────────────────────────────────────
/**
 * PATCH /api/queue/:id/status
 * Body: { status }
 */
export const updateQueueStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!VALID_STATUSES.includes(status)) {
      return fail(res, `status must be one of: ${VALID_STATUSES.join(", ")}`);
    }

    const entry = await QueueEntry.findById(id);
    if (!entry) return fail(res, "Queue entry not found", 404);

    const updates = { status };
    const now = new Date();
    if (status === "called") updates.calledAt = now;
    if (status === "in_consultation") updates.consultationStartedAt = now;
    if (status === "completed") updates.completedAt = now;

    await QueueEntry.updateOne({ _id: id }, updates);
    const updated = await QueueEntry.findById(id);

    // Emit real-time update
    const queueSummary = await getDoctorQueueData(updated.facilityId, updated.doctorId, updated.queueDate);
    emitQueueUpdate(updated.facilityId, updated.departmentId, updated.doctorId, queueSummary);

    return ok(res, { message: `Status updated to '${status}'`, entry: updated });
  } catch (err) {
    console.error("updateQueueStatus error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

// ─── DOCTOR CALLS NEXT PATIENT ────────────────────────────────────────────────
/**
 * POST /api/queue/doctor/:doctorId/call-next
 * Body: { facilityId }
 */
export const callNextPatient = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { facilityId } = req.body;
    if (!facilityId) return fail(res, "facilityId is required.");

    const queueDate = todayStr();

    // Complete current in_consultation patient automatically
    const [inConsult] = await query(
      `SELECT id, departmentId FROM \`queue_entries\`
       WHERE \`doctorId\` = ? AND \`facilityId\` = ? AND \`queueDate\` = ? AND \`status\` = 'in_consultation'
       LIMIT 1`,
      [doctorId, facilityId, queueDate]
    );
    if (inConsult?.[0]) {
      await query(
        `UPDATE \`queue_entries\` SET \`status\` = 'completed', \`completedAt\` = NOW() WHERE \`id\` = ?`,
        [inConsult[0].id]
      );
    }

    // Get next waiting patient
    const [waitingRows] = await query(
      `SELECT * FROM \`queue_entries\`
       WHERE \`doctorId\` = ? AND \`facilityId\` = ? AND \`queueDate\` = ? AND \`status\` = 'waiting'
       ORDER BY \`queuePosition\` ASC LIMIT 1`,
      [doctorId, facilityId, queueDate]
    );

    const nextPatient = waitingRows?.[0];
    if (!nextPatient) {
      const summary = await getDoctorQueueData(facilityId, doctorId, queueDate);
      emitQueueUpdate(facilityId, null, doctorId, summary);
      return ok(res, { message: "No more patients waiting", queue: summary });
    }

    await query(
      `UPDATE \`queue_entries\` SET \`status\` = 'called', \`calledAt\` = NOW() WHERE \`id\` = ?`,
      [nextPatient.id]
    );

    const summary = await getDoctorQueueData(facilityId, doctorId, queueDate);
    emitQueueUpdate(facilityId, nextPatient.departmentId, doctorId, summary);

    return ok(res, {
      message: `Token ${nextPatient.tokenNumber} called`,
      calledToken: nextPatient.tokenNumber,
      calledEntry: { ...nextPatient, status: "called" },
      queue: summary,
    });
  } catch (err) {
    console.error("callNextPatient error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

// ─── GET QUEUE BY FACILITY / DEPARTMENT ──────────────────────────────────────
/**
 * GET /api/queue/facility/:facilityId
 * Query: ?date=YYYY-MM-DD&departmentId=xxx
 */
export const getFacilityQueue = async (req, res) => {
  try {
    const { facilityId } = req.params;
    const { date, departmentId } = req.query;
    const queueDate = date || todayStr();

    let sql = `SELECT qe.*, u.fullName AS doctorName
               FROM \`queue_entries\` qe
               LEFT JOIN \`users\` u ON u.id = qe.doctorId
               WHERE qe.facilityId = ? AND qe.queueDate = ?`;
    const params = [facilityId, queueDate];

    if (departmentId) {
      sql += " AND qe.departmentId = ?";
      params.push(departmentId);
    }

    sql += " ORDER BY qe.doctorId, qe.queuePosition ASC";

    const [rows] = await query(sql, params);
    const all = rows || [];

    // Group by doctorId
    const grouped = {};
    for (const row of all) {
      if (!grouped[row.doctorId]) {
        grouped[row.doctorId] = { doctorId: row.doctorId, doctorName: row.doctorName, roomId: row.roomId, entries: [] };
      }
      grouped[row.doctorId].entries.push(row);
    }

    // Build per-doctor summary
    const doctors = Object.values(grouped).map(g => {
      const entries = g.entries;
      const current = entries.find(e => e.status === "in_consultation") || entries.find(e => e.status === "called") || null;
      const waiting = entries.filter(e => e.status === "waiting");
      return {
        doctorId: g.doctorId,
        doctorName: g.doctorName,
        roomId: g.roomId,
        totalPatients: entries.length,
        completedCount: entries.filter(e => e.status === "completed").length,
        waitingCount: waiting.length,
        current: current ? { token: current.tokenNumber, patientName: current.patientName } : null,
        nextTokens: waiting.slice(0, 3).map(e => e.tokenNumber),
      };
    });

    return ok(res, { facilityId, queueDate, doctors });
  } catch (err) {
    console.error("getFacilityQueue error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

// ─── SKIP / RECALL ────────────────────────────────────────────────────────────
/**
 * PATCH /api/queue/:id/skip
 */
export const skipPatient = async (req, res) => {
  try {
    const entry = await QueueEntry.findById(req.params.id);
    if (!entry) return fail(res, "Queue entry not found", 404);
    if (entry.status === "completed") return fail(res, "Cannot skip a completed patient.");

    await QueueEntry.updateOne({ _id: req.params.id }, { status: "skipped" });
    const updated = await QueueEntry.findById(req.params.id);
    const summary = await getDoctorQueueData(updated.facilityId, updated.doctorId, updated.queueDate);
    emitQueueUpdate(updated.facilityId, updated.departmentId, updated.doctorId, summary);

    return ok(res, { message: "Patient skipped", entry: updated });
  } catch (err) {
    console.error("skipPatient error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

/**
 * PATCH /api/queue/:id/recall
 * Moves a skipped patient back to waiting (end of queue)
 */
export const recallPatient = async (req, res) => {
  try {
    const entry = await QueueEntry.findById(req.params.id);
    if (!entry) return fail(res, "Queue entry not found", 404);
    if (entry.status !== "skipped") return fail(res, "Only skipped patients can be recalled.");

    // Put at end of queue
    const newPosition = await getNextPosition(entry.facilityId, entry.doctorId, entry.queueDate);
    await QueueEntry.updateOne({ _id: req.params.id }, { status: "waiting", queuePosition: newPosition });
    const updated = await QueueEntry.findById(req.params.id);
    const summary = await getDoctorQueueData(updated.facilityId, updated.doctorId, updated.queueDate);
    emitQueueUpdate(updated.facilityId, updated.departmentId, updated.doctorId, summary);

    return ok(res, { message: "Patient recalled to queue", entry: updated });
  } catch (err) {
    console.error("recallPatient error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};

// ─── QUEUE HISTORY ────────────────────────────────────────────────────────────
/**
 * GET /api/queue/history
 * Query: ?doctorId=&facilityId=&date=&status=&page=1&limit=20
 */
export const getQueueHistory = async (req, res) => {
  try {
    const { doctorId, facilityId, date, status, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let sql = "SELECT * FROM `queue_entries` WHERE 1=1";
    const params = [];

    if (facilityId) { sql += " AND `facilityId` = ?"; params.push(facilityId); }
    if (doctorId) { sql += " AND `doctorId` = ?"; params.push(doctorId); }
    if (date) { sql += " AND `queueDate` = ?"; params.push(date); }
    if (status) { sql += " AND `status` = ?"; params.push(status); }

    sql += " ORDER BY `queueDate` DESC, `queuePosition` ASC LIMIT ? OFFSET ?";
    params.push(Number(limit), offset);

    const [rows] = await query(sql, params);
    return ok(res, { entries: rows || [], page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error("getQueueHistory error:", err.message);
    return fail(res, "Internal server error", 500);
  }
};
