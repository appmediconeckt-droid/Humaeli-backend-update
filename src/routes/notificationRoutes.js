import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { optionalAuth, authMiddleware } from "../middleware/authMiddleware.js";
import {
  deleteNotification,
  getCounselorOnlineSubscription,
  getNotifications,
  getUnreadCount,
  markAllAsRead,
  markAsRead,
  saveFCMToken,
  subscribeToCounselorOnline,
  unsubscribeFromCounselorOnline,
} from "../controllers/notificationController.js";
import { testNotification } from "../controllers/pushNotificationController.js";

const router = express.Router();

// Flexible auth middleware that allows GET to proceed optionally, but requires auth for mutations
const flexibleSubscriptionAuth = (req, res, next) => {
  if (req.user) return next();
  authenticateToken(req, res, (err) => {
    if (!err && req.user) return next();
    authMiddleware(req, res, (err2) => {
      if (!err2 && req.user) return next();
      if (req.method === "GET") return next();
      return res.status(401).json({ success: false, message: "Authentication required" });
    });
  });
};

// Availability subscription routes under /api/notifications/availability-subscriptions
router.get("/availability-subscriptions/:counselorId", flexibleSubscriptionAuth, getCounselorOnlineSubscription);
router.get("/availability-subscriptions", flexibleSubscriptionAuth, getCounselorOnlineSubscription);
router.post("/availability-subscriptions/:counselorId", flexibleSubscriptionAuth, subscribeToCounselorOnline);
router.post("/availability-subscriptions", flexibleSubscriptionAuth, subscribeToCounselorOnline);
router.delete("/availability-subscriptions/:counselorId", flexibleSubscriptionAuth, unsubscribeFromCounselorOnline);
router.delete("/availability-subscriptions", flexibleSubscriptionAuth, unsubscribeFromCounselorOnline);

// In case the router is mounted directly at /api/availability-subscriptions
router.get("/:counselorId", (req, res, next) => {
  // If the param is not a sub-route name (like unread-count, token, test)
  if (["unread-count", "token", "test", "read-all"].includes(req.params.counselorId)) {
    return next();
  }
  return flexibleSubscriptionAuth(req, res, () => getCounselorOnlineSubscription(req, res, next));
});
router.post("/:counselorId", (req, res, next) => {
  if (["test"].includes(req.params.counselorId)) return next();
  return flexibleSubscriptionAuth(req, res, () => subscribeToCounselorOnline(req, res, next));
});
router.delete("/:counselorId", (req, res, next) => {
  if (["test"].includes(req.params.counselorId)) return next();
  return flexibleSubscriptionAuth(req, res, () => unsubscribeFromCounselorOnline(req, res, next));
});

// Notifications management
router.get("/", authenticateToken, getNotifications);
router.get("/unread-count", authenticateToken, getUnreadCount);
router.put("/token", authenticateToken, saveFCMToken);
router.post("/test", authenticateToken, testNotification);
router.patch("/read-all", authenticateToken, markAllAsRead);
router.patch("/:id/read", authenticateToken, markAsRead);
router.delete("/:id", authenticateToken, deleteNotification);

export default router;
