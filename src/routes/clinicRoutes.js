// src/routes/clinicRoutes.js
import express from "express";
import {
  getClinics,
  createClinic,
  getClinicById,
  updateClinic,
  deleteClinic,
} from "../controllers/clinicController.js";
import { optionalAuth, authMiddleware } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";
import { uploadClinicPhoto } from "../middleware/multerConfig.js";

const router = express.Router();

router.get("/", optionalAuth, getClinics);
router.post("/", authMiddleware, authorizeRoles("doctor", "counsellor"), uploadClinicPhoto, createClinic);
router.get("/:id", optionalAuth, getClinicById);
router.patch("/:id", authMiddleware, authorizeRoles("doctor", "counsellor"), uploadClinicPhoto, updateClinic);
router.put("/:id", authMiddleware, authorizeRoles("doctor", "counsellor"), uploadClinicPhoto, updateClinic);
router.delete("/:id", authMiddleware, authorizeRoles("doctor", "counsellor"), deleteClinic);

export default router;
