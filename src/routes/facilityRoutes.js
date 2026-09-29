// src/routes/facilityRoutes.js
import express from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";

import {
  createFacility,
  getAllFacilities,
  getFacilityById,
  updateFacility,
  deleteFacility,
  createDepartment,
  getDepartmentsByFacility,
  updateDepartment,
  deleteDepartment,
  addDoctorToFacility,
  getDoctorFacilities,
  getFacilityDoctors,
  removeDoctorFromFacility,
  createOrUpdateSchedule,
  getDoctorSchedule,
  deleteSchedule,
} from "../controllers/facilityController.js";

const router = express.Router();

// ─── FACILITIES ──────────────────────────────────────────────────────────────
// POST   /api/facilities                       → create hospital or clinic
// GET    /api/facilities                       → list all (with optional ?type=hospital|clinic)
// GET    /api/facilities/:id                   → get single facility with departments
// PUT    /api/facilities/:id                   → update facility
// DELETE /api/facilities/:id                   → delete facility

router.post("/", authMiddleware, authorizeRoles("admin", "doctor"), createFacility);
router.get("/", getAllFacilities);
router.get("/:id", getFacilityById);
router.put("/:id", authMiddleware, authorizeRoles("admin", "doctor"), updateFacility);
router.delete("/:id", authMiddleware, authorizeRoles("admin"), deleteFacility);

// ─── DEPARTMENTS ─────────────────────────────────────────────────────────────
// POST   /api/facilities/departments           → create department in a facility
// GET    /api/facilities/:facilityId/departments → list departments of a facility
// PUT    /api/facilities/departments/:id       → update department
// DELETE /api/facilities/departments/:id       → delete department

router.post("/departments", authMiddleware, authorizeRoles("admin", "doctor"), createDepartment);
router.get("/:facilityId/departments", getDepartmentsByFacility);
router.put("/departments/:id", authMiddleware, authorizeRoles("admin", "doctor"), updateDepartment);
router.delete("/departments/:id", authMiddleware, authorizeRoles("admin"), deleteDepartment);

// ─── DOCTOR–FACILITY MAPPING ─────────────────────────────────────────────────
// POST   /api/facilities/doctor-mapping        → map doctor to facility + dept + room
// GET    /api/facilities/doctor/:doctorId      → all facilities a doctor is mapped to
// GET    /api/facilities/:facilityId/doctors   → all doctors in a facility (?departmentId=)
// DELETE /api/facilities/doctor-mapping/:id    → remove/deactivate a mapping

router.post("/doctor-mapping", authMiddleware, authorizeRoles("admin", "doctor"), addDoctorToFacility);
router.get("/doctor/:doctorId", getDoctorFacilities);
router.get("/:facilityId/doctors", getFacilityDoctors);
router.delete("/doctor-mapping/:id", authMiddleware, authorizeRoles("admin", "doctor"), removeDoctorFromFacility);

// ─── DOCTOR SCHEDULES ────────────────────────────────────────────────────────
// POST   /api/facilities/schedules             → create/update doctor schedule
// GET    /api/facilities/schedules/:doctorId   → get schedules for a doctor (?facilityId=)
// DELETE /api/facilities/schedules/:id         → disable a schedule

router.post("/schedules", authMiddleware, authorizeRoles("admin", "doctor"), createOrUpdateSchedule);
router.get("/schedules/:doctorId", getDoctorSchedule);
router.delete("/schedules/:id", authMiddleware, authorizeRoles("admin", "doctor"), deleteSchedule);

export default router;
