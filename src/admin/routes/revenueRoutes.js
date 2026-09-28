import express from "express";
import {
  getCounselorRevenue,
  getRevenueBySessionType,
  getTopCounselors,
  getCounselorDetails
} from "../controllers/revenueController.js";
import { verifyAdminToken } from "../middleware/simpleAdminAuth.js";

const router = express.Router();

// Revenue per counselor (main endpoint)
router.get("/by-counselor", verifyAdminToken, getCounselorRevenue);

// Revenue breakdown by session type
router.get("/by-session-type", verifyAdminToken, getRevenueBySessionType);

// Top counselors
router.get("/top-counselors", verifyAdminToken, getTopCounselors);

// Counselor specific details
router.get("/counselor/:id", verifyAdminToken, getCounselorDetails);

export default router;
