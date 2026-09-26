import express from "express";
const router = express.Router();
import * as appointmentCtrl from "../controllers/appointmentController.js";
import { authenticateToken, authorizeRoles } from "../middleware/auth.js";
import { getMyTokenStatus } from "../controllers/tokenStatusController.js";

// Users can book appointments
router.post("/", authenticateToken, authorizeRoles("user"), appointmentCtrl.book);

// Both can see their appointments
router.get("/", authenticateToken, appointmentCtrl.getAppointments);
router.get("/my-token-status", authenticateToken, authorizeRoles("user"), getMyTokenStatus);

// Counsellors can update appointment status
router.patch("/:id/status", authenticateToken, authorizeRoles("counsellor", "doctor"), appointmentCtrl.updateStatus);
router.patch("/:id", authenticateToken, authorizeRoles("counsellor", "doctor"), appointmentCtrl.updateDoctorAppointment);
router.delete("/:id", authenticateToken, authorizeRoles("counsellor", "doctor"), appointmentCtrl.deleteDoctorAppointment);

export default router;
