import Notification from "../models/Notification.js";
import User from "../models/userModel.js";
import { sendPushNotification } from "./pushNotificationService.js";

const enabledNotificationTypes = new Set([
  "appointment",
  "payment",
  "message",
  "call",
  "prescription",
]);

export const createNotification = async ({
  recipientId,
  actorId = null,
  type,
  title,
  message,
  data = {},
  actionUrl = "",
}) => {
  if (!recipientId) return null;
  if (!enabledNotificationTypes.has(type)) return null;

  const notification = await Notification.create({
    recipientId,
    actorId,
    type,
    title,
    message,
    data,
    actionUrl,
  });

  const payload = notification.toObject();
  if (global.io) {
    const recipient = String(recipientId);
    const rooms = [
      `user_${recipient}`,
      `counsellor_${recipient}`,
      `counselor_${recipient}`,
    ];
    rooms.forEach((room) => global.io.to(room).emit("notification:new", payload));
  }

  const recipientUser = await User.findById(recipientId)
    .select("fcmToken")
    .lean();
  if (recipientUser?.fcmToken) {
    const pushType =
      type === "call"
        ? "INCOMING_CALL"
        : type === "message"
          ? "CHAT_MESSAGE"
          : String(type || "NOTIFICATION").toUpperCase();

    await sendPushNotification({
      token: recipientUser.fcmToken,
      title,
      body: message,
      data: {
        ...data,
        type: pushType,
        notificationId: notification._id,
      },
    });
  }

  return notification;
};

// Notifications must never make the main message/payment/booking request fail.
export const createNotificationSafely = async (payload) => {
  try {
    return await createNotification(payload);
  } catch (error) {
    console.error("Notification creation failed:", error.message);
    return null;
  }
};

export const notifyCounselorOnlineSubscribers = async (counselorId) => {
  if (!counselorId) return;
  try {
    const CounselorOnlineSubscription = (await import("../models/mysql/CounselorOnlineSubscription.js")).default;
    const subscriptions = await CounselorOnlineSubscription.find({ counselorId: String(counselorId) });
    if (!subscriptions || subscriptions.length === 0) return;

    const counselor = await User.findById(counselorId).select("fullName specialization").lean();
    const counselorName = counselor?.fullName || "Your counselor";

    for (const sub of subscriptions) {
      try {
        const subscriber = await User.findById(sub.userId).select("fcmToken").lean();
        if (subscriber?.fcmToken) {
          await sendPushNotification({
            token: subscriber.fcmToken,
            title: `${counselorName} is now online!`,
            body: `${counselorName} is available for consultation now.`,
            data: {
              type: "COUNSELOR_ONLINE",
              counselorId: String(counselorId),
            },
          });
        }
        await CounselorOnlineSubscription.deleteOne({ _id: sub._id || sub.id });
      } catch (subErr) {
        console.warn(`Failed to notify subscriber ${sub.userId}:`, subErr.message);
      }
    }
  } catch (err) {
    console.error("notifyCounselorOnlineSubscribers error:", err.message);
  }
};

