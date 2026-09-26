import express from "express";
import multer from "multer";
import { authenticateToken } from "../middleware/auth.js";
import { getMyPrescriptions, getPrescriptionFile, getPrescriptionPhoto, uploadPrescriptionPhoto } from "../controllers/prescriptionController.js";

const router = express.Router();
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, done) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) return done(null, true);
    done(new Error("Upload a JPEG, PNG or WebP photo"));
  },
});
router.use(authenticateToken);
router.get("/my", getMyPrescriptions);
router.get("/:id/file", getPrescriptionFile);
router.get("/:id/photo", getPrescriptionPhoto);
router.post("/:id/photo", photoUpload.single("photo"), uploadPrescriptionPhoto);
router.use((error, _req, res, _next) => {
  const uploadError = error instanceof multer.MulterError || error.message === "Upload a JPEG, PNG or WebP photo";
  res.status(uploadError ? 400 : 500).json({ error: uploadError ? error.message : "Unable to process prescription" });
});
export default router;
