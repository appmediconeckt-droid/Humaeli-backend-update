import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary.js';
import { clinicUploadsRoot } from '../services/clinicPhotoService.js';
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
const uploadDir = path.join(clinicUploadsRoot, "clinic-photos");

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

const cloudStorage = new CloudinaryStorage({ cloudinary, params: { folder: 'clinic-photos', allowed_formats: ['jpg', 'jpeg', 'png', 'webp'], resource_type: 'image' } });
const useCloudStorage = Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
const upload = multer({ storage: useCloudStorage ? cloudStorage : storage, limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(Object.assign(new Error('Clinic photo must be an image in JPG, PNG or WebP format'), {status: 400}));
    cb(null, true);
  } });
const uploadPhoto = (req, res, next) => upload.single('clinic_photo')(req, res, error => {
  if (!error) return next();
  const message = error.code === 'LIMIT_FILE_SIZE' ? 'Clinic photo must be 5 MB or smaller' : error.code === 'LIMIT_UNEXPECTED_FILE' ? 'Upload one image using clinic_photo' : error.status === 400 ? error.message : 'Clinic photo upload failed. Please try again.';
  res.status(error instanceof multer.MulterError || error.status === 400 ? 400 : 502).json({success: false, message});
});

// Create clinic (accepts multipart/form-data with optional `clinic_photo`)
router.post("/", protect, allowRoles('doctor', 'admin'), uploadPhoto, createClinic);

router.get("/", getClinics);

router.get("/:id", getClinicById);

// Update clinic (accepts multipart/form-data with optional `clinic_photo`)
router.patch("/:id", protect, allowRoles('doctor', 'admin'), uploadPhoto, updateClinic);

router.delete("/:id", protect, allowRoles('doctor', 'admin'), deleteClinic);

export default router;
