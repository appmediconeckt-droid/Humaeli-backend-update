import express from "express";
import {
  getPendingPayouts,
  getAllPayouts,
  getPayoutById,
  createPayout,
  approvePayout,
  processPayout,
  rejectPayout,
  getPayoutHistory,
  getPayoutStats,
  updatePayoutBankDetails
} from "../controllers/payoutController.js";
import { verifyAdminToken } from "../middleware/simpleAdminAuth.js";

const router = express.Router();

// Get all payouts with filters
router.get("/", verifyAdminToken, getAllPayouts);

// Get pending payouts
router.get("/pending", verifyAdminToken, getPendingPayouts);

// Get payout statistics
router.get("/stats", verifyAdminToken, getPayoutStats);

// Get payout history for counselor
router.get("/counselor/:counselorId/history", verifyAdminToken, getPayoutHistory);

// Get specific payout details
router.get("/:id", verifyAdminToken, getPayoutById);

// Create new payout
router.post("/", verifyAdminToken, createPayout);

// Update bank details for payout
router.put("/:id/bank-details", verifyAdminToken, updatePayoutBankDetails);

// Approve payout
router.put("/:id/approve", verifyAdminToken, approvePayout);

// Process/Send payout
router.put("/:id/process", verifyAdminToken, processPayout);

// Reject payout
router.put("/:id/reject", verifyAdminToken, rejectPayout);

export default router;
