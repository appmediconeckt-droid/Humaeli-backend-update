import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { uploadPrescriptionPdf, uploadPrescriptionPhoto } from "../middleware/multerConfig.js";
import { getMyPrescriptions, getPatientPhoto, getPrescriptionFile, getPrescriptionsForReview, issuePrescription, reviewPatientPhoto, updatePrescriptionFestivalTheme, uploadPatientPhoto } from "../controllers/prescriptionController.js";

const router = express.Router();

router.get("/my", authenticateToken, getMyPrescriptions);
router.get("/review", authenticateToken, getPrescriptionsForReview);
router.get("/:id/file", authenticateToken, getPrescriptionFile);
router.get("/:id/photo", authenticateToken, getPatientPhoto);
router.post("/:id/photo", authenticateToken, uploadPrescriptionPhoto, uploadPatientPhoto);
router.patch("/:id/festival-theme", authenticateToken, updatePrescriptionFestivalTheme);
router.patch("/:id/verification", authenticateToken, reviewPatientPhoto);
router.post("/chat/:chatId", authenticateToken, uploadPrescriptionPdf, issuePrescription);

export default router;
