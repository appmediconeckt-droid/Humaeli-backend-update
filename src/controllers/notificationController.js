import Notification from "../models/Notification.js";
import User from "../models/userModel.js";
import CounselorOnlineSubscription from "../models/mysql/CounselorOnlineSubscription.js";

const isValidId = (id) => id != null && String(id).length >= 12;



const visibleNotificationTypes = ["appointment", "payment"];

export const saveFCMToken = async (req, res) => {
  try {
    const userId = req.body?.userId || req.user?._id || req.user?.userId;
    const { fcmToken, platform } = req.body || {};

    if (!userId || !fcmToken) {
      return res.status(400).json({
        success: false,
        message: "userId and fcmToken are required",
      });
    }

    const normalizedToken = typeof fcmToken === "string" ? fcmToken.trim() : "";
    if (!normalizedToken) {
      return res.status(400).json({
        success: false,
        message: "fcmToken is required",
      });
    }

    const updateData = { fcmToken: normalizedToken };
    if (platform !== undefined) {
      updateData.devicePlatform = platform || null;
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true },
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "FCM token saved successfully",
    });
  } catch (error) {
    console.error("FCM token save error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to save FCM token",
    });
  }
};

export const getNotifications = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const filter = { recipientId: req.user._id, type: { $in: visibleNotificationTypes } };
  if (visibleNotificationTypes.includes(req.query.type)) filter.type = req.query.type;
  if (req.query.unread === "true") filter.isRead = false;

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter)
      .populate("actorId", "fullName profilePhoto role")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipientId: req.user._id, type: { $in: visibleNotificationTypes }, isRead: false }),
  ]);

  res.json({
    success: true,
    notifications,
    unreadCount,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
};

export const getUnreadCount = async (req, res) => {
  const unreadCount = await Notification.countDocuments({
    recipientId: req.user._id,
    type: { $in: visibleNotificationTypes },
    isRead: false,
  });
  res.json({ success: true, unreadCount });
};

export const markAsRead = async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ message: "Invalid notification id" });
  }
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipientId: req.user._id },
    { isRead: true, readAt: new Date() },
    { new: true },
  );
  if (!notification) return res.status(404).json({ message: "Notification not found" });
  res.json({ success: true, notification });
};

export const markAllAsRead = async (req, res) => {
  const result = await Notification.updateMany(
    { recipientId: req.user._id, type: { $in: visibleNotificationTypes }, isRead: false },
    { isRead: true, readAt: new Date() },
  );
  res.json({ success: true, updatedCount: result.modifiedCount });
};
export const deleteNotification = async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user?._id || req.user?.id || req.user?.userId;

    if (!isValidId(notificationId)) {
      return res.status(400).json({ success: false, message: "Invalid notification id" });
    }

    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      recipientId: userId,
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    return res.json({ success: true, message: "Notification deleted successfully" });
  } catch (error) {
    console.error("deleteNotification error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete notification" });
  }
};

export const getCounselorOnlineSubscription = async (req, res) => {
  try {
    const counselorId = req.params?.counselorId || req.params?.id || req.query?.counselorId;
    const userId = req.user?._id || req.user?.id || req.user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!counselorId) {
      const subscriptions = await CounselorOnlineSubscription.find({ userId: String(userId) });
      return res.json({
        success: true,
        subscriptions,
      });
    }

    const subscription = await CounselorOnlineSubscription.findOne({
      userId: String(userId),
      counselorId: String(counselorId),
    });

    const isSubscribed = Boolean(subscription);

    return res.json({
      success: true,
      isSubscribed,
      subscribed: isSubscribed,
      subscription: subscription || null,
      data: subscription || null,
    });
  } catch (error) {
    console.error("getCounselorOnlineSubscription error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch counselor online subscription",
      error: error.message,
    });
  }
};

export const subscribeToCounselorOnline = async (req, res) => {
  try {
    const counselorId =
      req.body?.counselorId ||
      req.body?.ccounselorId ||
      req.params?.counselorId ||
      req.params?.id;
    const userId = req.user?._id || req.user?.id || req.user?.userId;
    const fcmToken = req.body?.fcmToken;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!counselorId) {
      return res.status(400).json({
        success: false,
        message: "counselorId is required",
      });
    }

    if (fcmToken && typeof fcmToken === "string" && fcmToken.trim()) {
      try {
        await User.findByIdAndUpdate(userId, {
          $set: { fcmToken: fcmToken.trim() },
        });
      } catch (err) {
        console.warn("Could not update user fcmToken on subscribe:", err.message);
      }
    }

    let subscription = await CounselorOnlineSubscription.findOne({
      userId: String(userId),
      counselorId: String(counselorId),
    });

    if (!subscription) {
      subscription = await CounselorOnlineSubscription.create({
        userId: String(userId),
        counselorId: String(counselorId),
      });
    }

    return res.json({
      success: true,
      message: "Subscribed to counselor online alerts successfully",
      isSubscribed: true,
      subscribed: true,
      subscription,
      data: subscription,
    });
  } catch (error) {
    console.error("subscribeToCounselorOnline error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to subscribe to counselor online alerts",
      error: error.message,
    });
  }
};

export const unsubscribeFromCounselorOnline = async (req, res) => {
  try {
    const counselorId =
      req.params?.counselorId ||
      req.params?.id ||
      req.body?.counselorId ||
      req.body?.ccounselorId;
    const userId = req.user?._id || req.user?.id || req.user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!counselorId) {
      return res.status(400).json({
        success: false,
        message: "counselorId is required",
      });
    }

    await CounselorOnlineSubscription.deleteOne({
      userId: String(userId),
      counselorId: String(counselorId),
    });

    return res.json({
      success: true,
      message: "Unsubscribed from counselor online alerts successfully",
      isSubscribed: false,
      subscribed: false,
    });
  } catch (error) {
    console.error("unsubscribeFromCounselorOnline error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to unsubscribe from counselor online alerts",
      error: error.message,
    });
  }
};
