// src/controllers/admin/adminNotificationController.js
import User from "../../models/userModel.js";
import Notification from "../../models/mysql/NotificationModel.js";
import AuditLog from "../../models/mysql/AuditLogModel.js";
import { sendPushNotification } from "../../services/pushNotificationService.js";

const PROFESSIONAL_ROLES = ["doctor", "consultant", "counselor", "counsellor", "counsellour"];

/**
 * POST /api/admin/notifications/promotion
 * Send a promotional push notification and in-app notification to users / counselors / all.
 */
export const sendPromotionalNotification = async (req, res) => {
  try {
    const {
      title,
      message,
      body,
      description,
      target = "all",
      targetRole,
      role,
      audience,
      imageUrl,
      image,
      url,
      actionUrl,
      data: extraData = {},
    } = req.body || {};

    const notificationTitle = (title || "Special Announcement").trim();
    const notificationBody = (message || body || description || "").trim();

    if (!notificationBody) {
      return res.status(400).json({
        success: false,
        message: "Notification message / body is required",
      });
    }

    // Determine target users filter
    const audienceTarget = String(targetRole || role || audience || target || "all").toLowerCase();
    const filter = { isActive: true };

    if (audienceTarget === "user" || audienceTarget === "users" || audienceTarget === "patient" || audienceTarget === "patients") {
      filter.role = "user";
    } else if (
      audienceTarget === "counselor" ||
      audienceTarget === "counselors" ||
      audienceTarget === "doctor" ||
      audienceTarget === "doctors"
    ) {
      filter.role = { $in: PROFESSIONAL_ROLES };
    }

    // If specific userIds provided
    if (Array.isArray(req.body.userIds) && req.body.userIds.length > 0) {
      filter.id = { $in: req.body.userIds };
    }

    // Fetch targeted users
    const users = await User.find(filter).select("id _id fullName email role fcmToken");

    if (!users || users.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No matching active users found for this audience",
        recipientsCount: 0,
        pushSentCount: 0,
      });
    }

    const img = imageUrl || image || null;
    const link = url || actionUrl || "/notifications";

    let pushSentCount = 0;
    let pushFailedCount = 0;

    // Process push notifications & in-app records
    const inAppRecords = [];

    for (const u of users) {
      const recipientId = String(u._id || u.id);

      inAppRecords.push({
        recipientId,
        actorId: req.admin?.id || req.admin?._id || "admin",
        type: "promotion",
        title: notificationTitle,
        message: notificationBody,
        data: {
          ...extraData,
          imageUrl: img,
          actionUrl: link,
          type: "promotion",
        },
        actionUrl: link,
        isRead: false,
      });

      // If user has a valid FCM token, send push notification
      if (u.fcmToken && typeof u.fcmToken === "string" && u.fcmToken.trim().length > 10) {
        try {
          await sendPushNotification({
            token: u.fcmToken.trim(),
            title: notificationTitle,
            body: notificationBody,
            data: {
              type: "promotion",
              actionUrl: link,
              ...(img ? { imageUrl: img } : {}),
              ...extraData,
            },
          });
          pushSentCount++;
        } catch (pushErr) {
          pushFailedCount++;
          console.warn(`FCM push error for user ${recipientId}:`, pushErr.message);
        }
      }
    }

    // Save in-app notification records (batch insert or sequential)
    try {
      if (inAppRecords.length > 0) {
        await Notification.insertMany(inAppRecords);
      }
    } catch (saveErr) {
      console.warn("Could not save in-app promotion records:", saveErr.message);
    }

    // Create Audit Log
    try {
      await AuditLog.create({
        adminId: req.admin?.id || req.admin?._id || "admin",
        adminName: req.admin?.name || req.admin?.email || "Admin",
        action: "SEND_PROMOTIONAL_NOTIFICATION",
        target: audienceTarget,
        details: {
          title: notificationTitle,
          recipientsCount: users.length,
          pushSentCount,
          pushFailedCount,
          targetAudience: audienceTarget,
        },
        ipAddress: req.ip || req.headers["x-forwarded-for"] || "127.0.0.1",
      });
    } catch (auditErr) {
      console.warn("Could not create audit log:", auditErr.message);
    }

    return res.status(200).json({
      success: true,
      message: `Promotional notification sent successfully to ${users.length} users (${pushSentCount} push delivered)`,
      recipientsCount: users.length,
      pushSentCount,
      pushFailedCount,
      data: {
        title: notificationTitle,
        body: notificationBody,
        audience: audienceTarget,
        sentAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("sendPromotionalNotification error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send promotional notification",
      error: error.message,
    });
  }
};

/**
 * GET /api/admin/notifications/promotions
 * Get list of sent promotional notifications from audit logs
 */
export const getNotificationHistory = async (req, res) => {
  try {
    const logs = await AuditLog.find({ action: "SEND_PROMOTIONAL_NOTIFICATION" })
      .sort({ createdAt: -1 })
      .limit(50);

    return res.status(200).json({
      success: true,
      data: logs || [],
      promotions: logs || [],
    });
  } catch (error) {
    console.error("getNotificationHistory error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch notification history",
      error: error.message,
    });
  }
};

export default {
  sendPromotionalNotification,
  getNotificationHistory,
};
