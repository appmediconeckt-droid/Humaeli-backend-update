import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";

import {
  createClinic,
  getClinics,
  getClinicById,
  updateClinic,
  deleteClinic,
} from "../controllers/clinicController.js";
import { protect, allowRoles } from "../middleware/authMiddleware.js";

const router = express.Router();
const uploadDir = path.join(process.cwd(), "uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer setup for handling file uploads (clinic_photo)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "-");
    cb(null, Date.now() + "-" + safeName);
  },
});

const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) });

// Create clinic (accepts multipart/form-data with optional `clinic_photo`)
router.post("/", protect, allowRoles('doctor', 'admin'), upload.single("clinic_photo"), createClinic);

router.get("/", getClinics);

router.get("/:id", getClinicById);

// Update clinic (accepts multipart/form-data with optional `clinic_photo`)
router.patch("/:id", protect, allowRoles('doctor', 'admin'), upload.single("clinic_photo"), updateClinic);

router.delete("/:id", protect, allowRoles('doctor', 'admin'), deleteClinic);

export default router;
