// src/routes/walkinRoutes.js
import express from "express";
import {
  getWalkinAppointments,
  createWalkinAppointment,
  getWalkinAppointmentById,
  updateWalkinAppointment,
  deleteWalkinAppointment,
} from "../controllers/walkinController.js";
import { optionalAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", optionalAuth, getWalkinAppointments);
router.post("/", optionalAuth, createWalkinAppointment);
router.get("/:id", optionalAuth, getWalkinAppointmentById);
router.patch("/:id", optionalAuth, updateWalkinAppointment);
router.put("/:id", optionalAuth, updateWalkinAppointment);
router.delete("/:id", optionalAuth, deleteWalkinAppointment);

export default router;
