// import express from "express";
// import {
//   getAppointments,
//   updateStatus,
//   createAppointment, getAppointmentAll, getAppointmentById, getTodayAppointments,
//   getAppointmentsByPatientId, nurseCheckIn, updateAppointment, deleteAppointment,
// } from "../controllers/appointmentController.js";
// import { authenticateToken, authorizeRoles } from "../middleware/auth.js";
// import { protect, allowRoles } from '../middleware/authMiddleware.js';

// const router = express.Router();
// router.post('/book', protect, allowRoles('user', 'doctor', 'admin', 'assistant', 'nurse'), createAppointment);
// router.get('/all', protect, getAppointmentAll);
// router.get('/today', protect, getTodayAppointments);
// router.get('/patient/:patientId', protect, getAppointmentsByPatientId);
// router.get('/:id', protect, getAppointmentById);
// router.patch('/:id/check-in', protect, allowRoles('doctor', 'nurse'), nurseCheckIn);
// router.patch('/:id', protect, allowRoles('doctor', 'admin'), updateAppointment);
// router.delete('/:id', protect, allowRoles('doctor', 'admin'), deleteAppointment);

// router.post("/", protect, allowRoles('user', 'doctor', 'admin', 'assistant', 'nurse'), createAppointment);

// router.get("/", protect, (req, res) => ['user', 'doctor', 'counsellor'].includes(req.user.role) ? getAppointments(req, res) : getAppointmentAll(req, res));

// router.patch("/:id/status", authenticateToken, authorizeRoles("counsellor", "doctor"), updateStatus);

// // All appointment routes share the same model and MySQL table.

// export default router;



import express from "express";

import {
  getAppointments,
  updateStatus,
  createAppointment,
  getAppointmentAll,
  getAppointmentById,
  getTodayAppointments,
  getAppointmentsByPatientId,
  nurseCheckIn,
  updateDoctorAppointment,
  updateAppointment,
  deleteDoctorAppointment,
  deleteAppointment,
  getMyTokenStatus,
  getDoctorQueue,
  setAppointmentEmergency,
} from "../controllers/appointmentController.js";

import {
  authenticateToken,
  authorizeRoles,
} from "../middleware/auth.js";

import {
  protect,
  allowRoles,
} from "../middleware/authMiddleware.js";

const router = express.Router();

// =====================================================
// CREATE APPOINTMENT
// =====================================================

router.post(
  "/book",
  protect,
  allowRoles("user", "doctor", "admin", "assistant", "nurse"),
  createAppointment,
);

router.post(
  "/",
  protect,
  allowRoles("user", "doctor", "admin", "assistant", "nurse"),
  createAppointment,
);

// =====================================================
// PATIENT TOKEN MENU
// Keep all static routes ABOVE /:id
// =====================================================

router.get(
  "/my-token-status",
  protect,
  allowRoles("user"),
  getMyTokenStatus,
);

// =====================================================
// DOCTOR LIVE QUEUE
// =====================================================

router.get(
  "/doctor/queue",
  protect,
  allowRoles("doctor", "counsellor", "admin", "assistant", "nurse"),
  getDoctorQueue,
);

// =====================================================
// APPOINTMENT LISTS
// =====================================================

router.get(
  "/all",
  protect,
  getAppointmentAll,
);

router.get(
  "/today",
  protect,
  getTodayAppointments,
);

router.get(
  "/patient/:patientId",
  protect,
  getAppointmentsByPatientId,
);

router.get(
  "/",
  protect,
  (req, res) =>
    ["user", "doctor", "counsellor"].includes(req.user.role)
      ? getAppointments(req, res)
      : getAppointmentAll(req, res),
);

// =====================================================
// STATUS / QUEUE ACTIONS
// =====================================================

// Existing appointment accept/reject/complete status route.
router.patch(
  "/:id/status",
  authenticateToken,
  authorizeRoles("counsellor", "doctor"),
  updateStatus,
);

// Nurse/doctor check-in. This now moves the patient to queue_status=waiting.
router.patch(
  "/:id/check-in",
  protect,
  allowRoles("doctor", "nurse"),
  nurseCheckIn,
);

// Doctor/reception/admin can mark or unmark an emergency appointment.
router.patch(
  "/:id/emergency",
  protect,
  allowRoles("doctor", "counsellor", "admin", "assistant", "nurse"),
  setAppointmentEmergency,
);

// =====================================================
// DYNAMIC ID ROUTES
// =====================================================

router.get(
  "/:id",
  protect,
  getAppointmentById,
);

// EXISTING generic update endpoint.
//
// Start consultation:
// PATCH /api/appointments/:id
// { "queue_status": "in_progress" }
//
// Call patient:
// PATCH /api/appointments/:id
// { "queue_status": "called" }
//
// End consultation:
// PATCH /api/appointments/:id
// { "queue_status": "completed", "status": "completed" }
//
// The controller is backward-compatible: if the old frontend only sends
// status=completed, queue_status is also completed automatically.
router.patch(
  "/:id",
  protect,
  allowRoles("doctor", "admin"),
  (req, res, next) =>
    ["doctor", "counsellor"].includes(req.user.role)
      ? updateDoctorAppointment(req, res, next)
      : updateAppointment(req, res, next),
);

router.delete(
  "/:id",
  protect,
  allowRoles("doctor", "admin"),
  (req, res, next) =>
    ["doctor", "counsellor"].includes(req.user.role)
      ? deleteDoctorAppointment(req, res, next)
      : deleteAppointment(req, res, next),
);

export default router;
