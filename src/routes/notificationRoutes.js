import express from 'express';

import {
  deleteNotification,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  registerFCMToken,
} from '../controllers/notificationController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { testNotification } from '../controllers/pushNotificationController.js';

const router = express.Router();

router.post(
  '/register-token',
  authMiddleware,
  registerFCMToken,
);
router.put('/token', authMiddleware, registerFCMToken);
router.post('/test', authMiddleware, testNotification);

router.get('/', authMiddleware, getNotifications);
router.get('/unread-count', authMiddleware, getUnreadNotificationCount);
router.patch('/read-all', authMiddleware, markAllNotificationsRead);
router.patch('/:id/read', authMiddleware, markNotificationRead);
router.delete('/:id', authMiddleware, deleteNotification);

export default router;
