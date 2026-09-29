// src/routes/displayRoutes.js
import express from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";

import {
  createDisplay,
  getDisplaysByFacility,
  updateDisplay,
  deleteDisplay,
  getDisplayQueue,
} from "../controllers/displayController.js";

const router = express.Router();

// ─── DISPLAY MANAGEMENT ──────────────────────────────────────────────────────
// POST   /api/displays                        → create a TV display (admin/doctor)
// GET    /api/displays/facility/:facilityId   → list all displays for a facility
// PUT    /api/displays/:id                    → update display config
// DELETE /api/displays/:id                    → deactivate display

router.post("/", authMiddleware, authorizeRoles("admin", "doctor"), createDisplay);
router.get("/facility/:facilityId", getDisplaysByFacility);
router.put("/:id", authMiddleware, authorizeRoles("admin", "doctor"), updateDisplay);
router.delete("/:id", authMiddleware, authorizeRoles("admin"), deleteDisplay);

// ─── DISPLAY QUEUE DATA (TV / LED page) ──────────────────────────────────────
// GET /api/displays/:displayId/queue
// No auth required – TV/LED pages are public read-only screens
// Returns current queue state formatted for the displayType (doctor|department|hospital|floor|reception)
router.get("/:displayId/queue", getDisplayQueue);

export default router;
