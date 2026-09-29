// src/routes/queueRoutes.js
import express from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";

import {
  checkIn,
  getDoctorQueue,
  getFacilityQueue,
  updateQueueStatus,
  callNextPatient,
  skipPatient,
  recallPatient,
  getQueueHistory,
} from "../controllers/queueController.js";

const router = express.Router();

// ─── CHECK-IN (create queue entry / token) ──────────────────────────────────
// POST /api/queue/check-in
// Body: { patientName, patientPhone?, facilityId, doctorId, departmentId?, roomId?, bookingSource?, patientId?, appointmentId?, notes? }
// bookingSource: qr | app | reception | walk_in | admin
router.post("/check-in", authMiddleware, checkIn);

// ─── DOCTOR QUEUE ────────────────────────────────────────────────────────────
// GET /api/queue/doctor/:doctorId?facilityId=xxx&date=YYYY-MM-DD
router.get("/doctor/:doctorId", authMiddleware, getDoctorQueue);

// POST /api/queue/doctor/:doctorId/call-next
// Body: { facilityId }
// Marks current in_consultation as completed and calls next waiting patient
router.post("/doctor/:doctorId/call-next", authMiddleware, authorizeRoles("doctor", "admin"), callNextPatient);

// ─── FACILITY-WIDE QUEUE ─────────────────────────────────────────────────────
// GET /api/queue/facility/:facilityId?date=YYYY-MM-DD&departmentId=xxx
router.get("/facility/:facilityId", getFacilityQueue);

// ─── STATUS TRANSITIONS ──────────────────────────────────────────────────────
// PATCH /api/queue/:id/status
// Body: { status: waiting|called|in_consultation|completed|skipped|cancelled|no_show }
router.patch("/:id/status", authMiddleware, authorizeRoles("doctor", "admin"), updateQueueStatus);

// PATCH /api/queue/:id/skip
router.patch("/:id/skip", authMiddleware, authorizeRoles("doctor", "admin"), skipPatient);

// PATCH /api/queue/:id/recall
router.patch("/:id/recall", authMiddleware, authorizeRoles("doctor", "admin"), recallPatient);

// ─── HISTORY ─────────────────────────────────────────────────────────────────
// GET /api/queue/history?doctorId=&facilityId=&date=&status=&page=1&limit=20
router.get("/history", authMiddleware, getQueueHistory);

export default router;
