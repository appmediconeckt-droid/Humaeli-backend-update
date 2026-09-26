// src/routes/availabilityRoutes.js
import express from "express";
import {
  getAvailabilityRanges,
  createAvailabilityRange,
  deleteAvailabilityRange,
  getAvailableRanges,
  setUnavailableDate,
  removeUnavailableDate,
  clearDateRanges,
  clearAllRanges,
} from "../controllers/availabilityController.js";
import {
  getCounselorOnlineSubscription,
  subscribeToCounselorOnline,
  unsubscribeFromCounselorOnline,
} from "../controllers/notificationController.js";
import { optionalAuth, authMiddleware } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/authorizeRoles.js";

const router = express.Router();

router.get("/ranges", optionalAuth, getAvailabilityRanges);
router.post("/ranges", optionalAuth, createAvailabilityRange);
router.delete("/ranges/:id", optionalAuth, deleteAvailabilityRange);
router.get("/available", optionalAuth, getAvailableRanges);
router.post("/unavailable", authMiddleware, authorizeRoles("doctor", "counsellor"), setUnavailableDate);
router.delete("/unavailable", authMiddleware, authorizeRoles("doctor", "counsellor"), removeUnavailableDate);
router.delete("/clear-date", optionalAuth, clearDateRanges);
router.delete("/clear-all", authMiddleware, authorizeRoles("doctor", "counsellor"), clearAllRanges);

// Bell icon / counselor online subscriptions aliases under /api/availability/*
router.get("/availability-subscriptions/:counselorId", optionalAuth, getCounselorOnlineSubscription);
router.get("/availability-subscriptions", optionalAuth, getCounselorOnlineSubscription);
router.post("/availability-subscriptions/:counselorId", optionalAuth, subscribeToCounselorOnline);
router.post("/availability-subscriptions", optionalAuth, subscribeToCounselorOnline);
router.delete("/availability-subscriptions/:counselorId", optionalAuth, unsubscribeFromCounselorOnline);
router.delete("/availability-subscriptions", optionalAuth, unsubscribeFromCounselorOnline);

router.get("/subscriptions/:counselorId", optionalAuth, getCounselorOnlineSubscription);
router.get("/subscriptions", optionalAuth, getCounselorOnlineSubscription);
router.post("/subscriptions/:counselorId", optionalAuth, subscribeToCounselorOnline);
router.post("/subscriptions", optionalAuth, subscribeToCounselorOnline);
router.delete("/subscriptions/:counselorId", optionalAuth, unsubscribeFromCounselorOnline);
router.delete("/subscriptions", optionalAuth, unsubscribeFromCounselorOnline);

router.get("/", optionalAuth, getAvailabilityRanges);

export default router;
