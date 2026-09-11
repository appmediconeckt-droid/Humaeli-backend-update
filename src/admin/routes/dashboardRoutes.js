import express from "express";
import {
  getDashboardAnalytics,
  getUserGrowthData,
  getSystemHealth,
  getRecentActivities,
  getRevenueData,
  getRevenueTimeSeries,
  getAuditLogs,
  getNotifications
} from "../controllers/dashboardController.js";
import { verifyAdminToken } from "../middleware/simpleAdminAuth.js";

const router = express.Router();

router.get("/analytics", verifyAdminToken, getDashboardAnalytics);
router.get("/growth", verifyAdminToken, getUserGrowthData);
router.get("/health", verifyAdminToken, getSystemHealth);
router.get("/activities", verifyAdminToken, getRecentActivities);
router.get("/revenue", verifyAdminToken, getRevenueData);
router.get("/revenue-timeseries", verifyAdminToken, getRevenueTimeSeries);
router.get("/audit-logs", verifyAdminToken, getAuditLogs);
router.get("/notifications", verifyAdminToken, getNotifications);

export default router;
