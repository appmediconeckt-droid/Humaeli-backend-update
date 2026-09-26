// src/routes/adminRoutes.js
// Consolidated admin panel routes — merged from admin-backend into chatbot-backend
import express from "express";
import { verifyAdminToken, requireSuperadmin } from "../middleware/adminAuth.js";

// --- Auth ---
import {
  adminLogin,
  getAdminProfile,
  adminLogout,
  changePassword,
  createAdmin,
} from "../controllers/admin/adminAuthController.js";

// --- Dashboard ---
import {
  getDashboardAnalytics,
  getUserGrowthData,
  getSystemHealth,
  getRecentActivities,
  getRevenueData,
  getRevenueTimeSeries,
  getAuditLogs,
  getNotifications,
} from "../controllers/admin/adminDashboardController.js";

// --- Users ---
import {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  getUserStats,
  toggleAccountStatus as toggleUserStatus,
  bulkToggleStatus,
} from "../controllers/admin/adminUserController.js";

// --- Counselors ---
import {
  getAllCounselors,
  getCounselorById,
  updateCounselor,
  deleteCounselor,
  approveCounselors,
  rejectCounselors,
  getCounselorStats,
  updateChatPermission,
  getChatPermission,
} from "../controllers/admin/adminCounselorController.js";

// --- Payouts ---
import {
  getAllPayouts,
  getPendingPayouts,
  getPayoutStats,
  getPayoutById,
  createPayout,
  updatePayoutBankDetails,
  approvePayout,
  processPayout,
  rejectPayout,
  getPayoutHistory,
} from "../controllers/admin/adminPayoutController.js";

// --- Support ---
import {
  incomingSupportEmail,
  getSupportTickets,
  getSupportTicket,
  updateSupportTicket,
  replyToSupportTicket,
  getSupportStats,
} from "../controllers/admin/adminSupportController.js";

// --- Refunds ---
import {
  listRefundRequests,
  getRefundStats,
  approveRefundRequest,
  markRefundPaid,
  rejectRefundRequest,
} from "../controllers/admin/adminRefundController.js";

// --- Settings ---
import {
  getGeneralSettings,
  updateGeneralSettings,
} from "../controllers/admin/adminSettingsController.js";

// --- Reviews ---
import { getAllReviews } from "../controllers/admin/adminReviewController.js";

// --- Revenue ---
import {
  getCounselorRevenue,
  getRevenueBySessionType,
  getTopCounselors,
  getCounselorDetails,
} from "../controllers/admin/adminRevenueController.js";

// --- Payments ---
import {
  getWalletPayments,
  getWalletPaymentStats,
  verifyAndCreditWalletPayment,
} from "../controllers/admin/adminPaymentController.js";

// --- Promotional & Admin Notifications ---
import {
  sendPromotionalNotification,
  getNotificationHistory,
} from "../controllers/admin/adminNotificationController.js";

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

// ============================================================
// AUTH routes  (/api/admin/auth/*)
// ============================================================
router.post("/auth/login", adminLogin);
router.post("/auth/create-admin", verifyAdminToken, requireSuperadmin, createAdmin);
router.post("/auth/admins", verifyAdminToken, requireSuperadmin, createAdmin);
router.get("/auth/profile", verifyAdminToken, getAdminProfile);
router.post("/auth/logout", verifyAdminToken, adminLogout);
router.post("/auth/change-password", verifyAdminToken, changePassword);

// ============================================================
// DASHBOARD routes  (/api/admin/dashboard/*)
// ============================================================
router.get("/dashboard/analytics", verifyAdminToken, getDashboardAnalytics);
router.get("/dashboard/growth", verifyAdminToken, getUserGrowthData);
router.get("/dashboard/health", verifyAdminToken, getSystemHealth);
router.get("/dashboard/activities", verifyAdminToken, getRecentActivities);
router.get("/dashboard/revenue", verifyAdminToken, getRevenueData);
router.get("/dashboard/revenue-timeseries", verifyAdminToken, getRevenueTimeSeries);
router.get("/dashboard/audit-logs", verifyAdminToken, getAuditLogs);
router.get("/dashboard/notifications", verifyAdminToken, getNotifications);

// ============================================================
// USERS routes  (/api/admin/users/*)
// ============================================================
router.get("/users", verifyAdminToken, getAllUsers);
router.get("/users/stats", verifyAdminToken, getUserStats);
router.get("/users/:id", verifyAdminToken, getUserById);
router.put("/users/:id", verifyAdminToken, updateUser);
router.put("/users/:id/toggle-status", verifyAdminToken, toggleUserStatus);
router.post("/users/bulk/toggle-status", verifyAdminToken, bulkToggleStatus);
router.delete("/users/:id", verifyAdminToken, deleteUser);

// ============================================================
// COUNSELORS routes  (/api/admin/counselors/*)
// ============================================================
router.get("/counselors", verifyAdminToken, getAllCounselors);
router.get("/counselors/stats", verifyAdminToken, getCounselorStats);
router.post("/counselors/approve", verifyAdminToken, approveCounselors);
router.post("/counselors/reject", verifyAdminToken, rejectCounselors);
router.get("/counselors/:id", verifyAdminToken, getCounselorById);
router.put("/counselors/:id", verifyAdminToken, updateCounselor);
router.delete("/counselors/:id", verifyAdminToken, deleteCounselor);
router.get("/counselors/:id/chat-permission", verifyAdminToken, getChatPermission);
router.put("/counselors/:id/chat-permission", verifyAdminToken, updateChatPermission);

// ============================================================
// PAYOUTS routes  (/api/admin/payouts/*)
// ============================================================
router.get("/payouts", verifyAdminToken, getAllPayouts);
router.get("/payouts/pending", verifyAdminToken, getPendingPayouts);
router.get("/payouts/stats", verifyAdminToken, getPayoutStats);
router.get("/payouts/counselor/:counselorId/history", verifyAdminToken, getPayoutHistory);
router.get("/payouts/:id", verifyAdminToken, getPayoutById);
router.post("/payouts", verifyAdminToken, createPayout);
router.put("/payouts/:id/bank-details", verifyAdminToken, updatePayoutBankDetails);
router.put("/payouts/:id/approve", verifyAdminToken, approvePayout);
router.put("/payouts/:id/process", verifyAdminToken, processPayout);
router.put("/payouts/:id/reject", verifyAdminToken, rejectPayout);

// ============================================================
// SUPPORT routes  (/api/admin/support/*)
// ============================================================
router.post("/support/webhook/incoming", incomingSupportEmail);
router.get("/support/stats", verifyAdminToken, getSupportStats);
router.get("/support", verifyAdminToken, getSupportTickets);
router.get("/support/:id", verifyAdminToken, getSupportTicket);
router.put("/support/:id", verifyAdminToken, updateSupportTicket);
router.post("/support/:id/reply", verifyAdminToken, replyToSupportTicket);

// ============================================================
// REFUND routes  (/api/admin/refunds/*)
// ============================================================
router.get("/refunds", verifyAdminToken, asyncHandler(listRefundRequests));
router.get("/refunds/stats", verifyAdminToken, asyncHandler(getRefundStats));
router.put("/refunds/:id/approve", verifyAdminToken, asyncHandler(approveRefundRequest));
router.put("/refunds/:id/paid", verifyAdminToken, asyncHandler(markRefundPaid));
router.put("/refunds/:id/reject", verifyAdminToken, asyncHandler(rejectRefundRequest));

// ============================================================
// SETTINGS routes  (/api/admin/settings/*)
// ============================================================
router.get("/settings/general", verifyAdminToken, getGeneralSettings);
router.put("/settings/general", verifyAdminToken, updateGeneralSettings);

// ============================================================
// REVIEWS routes  (/api/admin/reviews/*)
// ============================================================
router.get("/reviews", verifyAdminToken, getAllReviews);

// ============================================================
// REVENUE routes  (/api/admin/revenue/*)
// ============================================================
router.get("/revenue/by-counselor", verifyAdminToken, getCounselorRevenue);
router.get("/revenue/by-session-type", verifyAdminToken, getRevenueBySessionType);
router.get("/revenue/top-counselors", verifyAdminToken, getTopCounselors);
router.get("/revenue/counselor/:id", verifyAdminToken, getCounselorDetails);

// ============================================================
// PAYMENTS routes  (/api/admin/payments/*)
// ============================================================
router.get("/payments", verifyAdminToken, getWalletPayments);
router.get("/payments/stats", verifyAdminToken, getWalletPaymentStats);
router.post("/payments/:id/verify-and-credit", verifyAdminToken, verifyAndCreditWalletPayment);

// ============================================================
// NOTIFICATIONS & PROMOTIONS routes (/api/admin/notifications/*)
// ============================================================
router.post("/notifications/promotion", verifyAdminToken, sendPromotionalNotification);
router.post("/notifications/promotional", verifyAdminToken, sendPromotionalNotification);
router.post("/notifications/broadcast", verifyAdminToken, sendPromotionalNotification);
router.post("/notifications/send", verifyAdminToken, sendPromotionalNotification);
router.get("/notifications/promotions", verifyAdminToken, getNotificationHistory);
router.get("/notifications/history", verifyAdminToken, getNotificationHistory);

export default router;
