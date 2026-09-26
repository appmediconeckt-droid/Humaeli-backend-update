import express from "express";
import { authenticateToken } from "../middleware/auth.js";
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

router.get("/availability-subscriptions/:counselorId", authenticateToken, getCounselorOnlineSubscription);
router.get("/availability-subscriptions", authenticateToken, getCounselorOnlineSubscription);
router.post("/availability-subscriptions/:counselorId", authenticateToken, subscribeToCounselorOnline);
router.post("/availability-subscriptions", authenticateToken, subscribeToCounselorOnline);
router.delete("/availability-subscriptions/:counselorId", authenticateToken, unsubscribeFromCounselorOnline);
router.delete("/availability-subscriptions", authenticateToken, unsubscribeFromCounselorOnline);

router.get("/", authenticateToken, getNotifications);
router.get("/unread-count", authenticateToken, getUnreadCount);
router.put("/token", authenticateToken, saveFCMToken);
router.post("/test", authenticateToken, testNotification);
router.patch("/read-all", authenticateToken, markAllAsRead);
router.patch("/:id/read", authenticateToken, markAsRead);
router.delete("/:id", authenticateToken, deleteNotification);

export default router;
