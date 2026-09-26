// src/routes/availabilityRoutes.js
import express from "express";
import {
  getAvailabilityRanges,
  createAvailabilityRange,
  deleteAvailabilityRange,
  getAvailableRanges,
  setUnavailableDate,
  removeUnavailableDate,
  clearDateRanges,
  clearAllRanges,
} from "../controllers/availabilityController.js";
import { optionalAuth, authMiddleware } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";

const router = express.Router();

router.get("/ranges", optionalAuth, getAvailabilityRanges);
router.post("/ranges", optionalAuth, createAvailabilityRange);
router.delete("/ranges/:id", optionalAuth, deleteAvailabilityRange);
router.get("/available", optionalAuth, getAvailableRanges);
router.post("/unavailable", authMiddleware, authorizeRoles("doctor", "counsellor"), setUnavailableDate);
router.delete("/unavailable", authMiddleware, authorizeRoles("doctor", "counsellor"), removeUnavailableDate);
router.delete("/clear-date", optionalAuth, clearDateRanges);
router.delete("/clear-all", authMiddleware, authorizeRoles("doctor", "counsellor"), clearAllRanges);
router.get("/", optionalAuth, getAvailabilityRanges);

export default router;
