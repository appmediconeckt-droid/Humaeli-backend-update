import express from "express";

import {
  createWalkinAppointment,
  getWalkinAppointments,
  getWalkinAppointmentById,
  updateWalkinAppointment,
  deleteWalkinAppointment,
} from "../controllers/walkinAppointmentController.js";
import { protect, allowRoles } from "../middleware/authMiddleware.js";
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Public: walk-in patients do not have an account/session yet.
router.post("/", rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 }), createWalkinAppointment);

// Reading or modifying walk-in appointments still requires authentication.
router.use(protect, allowRoles('doctor', 'admin', 'assistant', 'nurse'));

// Get All
router.get("/", getWalkinAppointments);

// Get By ID
router.get("/:id", getWalkinAppointmentById);

// Update
router.patch("/:id", updateWalkinAppointment);

// Delete
router.delete("/:id", deleteWalkinAppointment);

export default router;
