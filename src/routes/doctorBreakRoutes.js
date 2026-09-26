// src/routes/doctorBreakRoutes.js
import express from "express";
import {
  getActiveBreak,
  startBreak,
  endBreak,
  getDoctorBreaks,
} from "../controllers/doctorBreakController.js";
import { optionalAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/active", optionalAuth, getActiveBreak);
router.post("/start", optionalAuth, startBreak);
router.patch("/:id/end", optionalAuth, endBreak);
router.post("/:id/end", optionalAuth, endBreak);
router.get("/", optionalAuth, getDoctorBreaks);

export default router;
