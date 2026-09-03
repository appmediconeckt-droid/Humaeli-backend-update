import NotificationToken from '../models/NotificationToken.js';
import Notification from '../models/Notification.js';
import User from '../models/userModel.js';

const getRecipientId = (req) => req.userId || req.user?._id;

export const getNotifications = async (req, res) => {
  try {
    const recipientId = getRecipientId(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const query = { recipientId };
    if (req.query.type) query.type = req.query.type;
    if (String(req.query.unread).toLowerCase() === 'true') query.isRead = false;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Notification.countDocuments(query),
      Notification.countDocuments({ recipientId, isRead: false }),
    ]);

    return res.json({
      success: true,
      notifications,
      data: notifications,
      unreadCount,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load notifications' });
  }
};

export const getUnreadNotificationCount = async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      recipientId: getRecipientId(req),
      isRead: false,
    });
    return res.json({ success: true, count, unreadCount: count });
  } catch (error) {
    console.error('Unread notification count error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load unread count' });
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipientId: getRecipientId(req) },
      { $set: { isRead: true, readAt: new Date() } },
      { new: true },
    );
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    return res.json({ success: true, notification });
  } catch (error) {
    console.error('Mark notification read error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update notification' });
  }
};

export const markAllNotificationsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { recipientId: getRecipientId(req), isRead: false },
      { $set: { isRead: true, readAt: new Date() } },
    );
    return res.json({ success: true, updatedCount: result.modifiedCount });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update notifications' });
  }
};

export const deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      recipientId: getRecipientId(req),
    });
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    return res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    console.error('Delete notification error:', error);
    return res.status(500).json({ success: false, message: 'Unable to delete notification' });
  }
};

export const registerFCMToken = async (
  req,
  res,
) => {
  try {
    const userId = req.userId || req.user?._id || req.body?.userId;
    const token = (req.body?.token || req.body?.fcmToken || '').trim();
    const platform = req.body?.platform;

    if (!userId || !token) {
      return res.status(400).json({
        success: false,
        message:
          'userId and token are required',
      });
    }

    // The existing User field remains the canonical token store. Keeping this
    // first also makes registration compatible with databases created before
    // the separate NotificationToken collection existed.
    const updatedUser = await User.findByIdAndUpdate(userId, {
      $set: {
        fcmToken: token,
        ...(platform ? { devicePlatform: platform } : {}),
      },
    }, { new: true });

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    let savedToken = null;
    try {
      savedToken = await NotificationToken.findOneAndUpdate(
        {
          token,
        },
        {
          userId,
          token,
          platform:
            platform || 'android',
          active: true,
          lastUpdatedAt: new Date(),
        },
        {
          new: true,
          upsert: true,
        },
      );
    } catch (tokenStoreError) {
      // Do not reject a valid registration if the optional token collection
      // has an old/conflicting index; push delivery can use User.fcmToken.
      console.warn('Secondary FCM token store failed:', tokenStoreError.message);
    }

    return res.status(200).json({
      success: true,
      message:
        'FCM token saved successfully',
      data: savedToken,
    });
  } catch (error) {
    console.error(
      'FCM token save error:',
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        'Unable to save FCM token',
    });
  }
};
