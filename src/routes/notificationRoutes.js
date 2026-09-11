import express from 'express';
import mongoose from '../persistence/mongoose.js';

import {
  deleteNotification,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  registerFCMToken,
  subscribeToCounselorOnline,
  unsubscribeFromCounselorOnline,
  getCounselorOnlineSubscription,
} from '../controllers/notificationController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { testNotification } from '../controllers/pushNotificationController.js';

const router = express.Router();

const validateCounselorId = (req, res, next) => {
  if (!mongoose.isObjectIdOrHexString(req.params.counselorId)) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_COUNSELOR_ID',
      message: 'counselorId must be the counselor MongoDB _id',
    });
  }
  return next();
};

router.get("/", authMiddleware, getNotifications);
router.get("/unread-count", authMiddleware, getUnreadNotificationCount);
router.put("/token", authMiddleware, registerFCMToken);
router.post("/token", authMiddleware, registerFCMToken);
router.post("/register-token", authMiddleware, registerFCMToken);
// Both app URL variants share authentication, validation and subscription data.
// Mounted at /api/notifications in app.js.
router.route([
  "/counselors/:counselorId/online-subscription",
  "/availability-subscriptions/:counselorId",
])
  .all(authMiddleware, validateCounselorId)
  .get(getCounselorOnlineSubscription)
  .post(subscribeToCounselorOnline)
  .delete(unsubscribeFromCounselorOnline);
router.post("/test", authMiddleware, testNotification);
router.patch("/read-all", authMiddleware, markAllNotificationsRead);
router.patch("/:id/read", authMiddleware, markNotificationRead);
router.delete("/:id", authMiddleware, deleteNotification);

export default router;
