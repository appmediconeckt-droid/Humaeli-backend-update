import Notification from "../models/Notification.js";
import User from "../models/userModel.js";
import NotificationToken from "../models/NotificationToken.js";
import CounselorOnlineSubscription from "../models/CounselorOnlineSubscription.js";
import { sendPushNotification } from "./pushNotificationService.js";

const enabledNotificationTypes = new Set([
  "appointment",
  "payment",
  "message",
  "call",
  "system",
]);

const notificationTypeToPushType = {
  appointment: "APPOINTMENT",
  payment: "PAYMENT",
  message: "CHAT_MESSAGE",
  call: "INCOMING_CALL",
  system: "SYSTEM",
};

export const createNotification = async ({
  recipientId,
  actorId = null,
  type = 'system',
  title,
  message,
  data = {},
  actionUrl = '',
  pushDataOnly = false,
  pushType = null,
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

  try {
    const recipient = await User.findById(recipientId)
      .select("fcmToken role")
      .lean();

    if (recipient?.fcmToken) {
      const pushData = {
        type: data?.type || notificationTypeToPushType[type] || String(type).toUpperCase(),
        notificationId: String(notification._id),
        recipientId: String(recipientId),
        recipientRole: recipient.role || "",
        title,
        body: message,
        ...data,
      };

      await sendPushNotification({
        token: recipient.fcmToken,
        title,
        body: message,
        data: pushData,
      });
    }
  } catch (error) {
    console.error("Push delivery failed:", error.message);
  }

  return notification;
};

// Notifications must never make the main message/payment/booking request fail.
export const createNotificationSafely = async ({
  recipientId,
  actorId = null,
  type = 'system',
  title,
  message,
  data = {},
  actionUrl = '',
  pushDataOnly = false,
  pushType = null,
}) => {
  try {
    if (!recipientId || !title || !message) return null;

    const isCounselorOnline = (pushType || data?.type) === 'COUNSELOR_ONLINE';
    const isStillSubscribed = async () => !isCounselorOnline || Boolean(
      data?.counselorId && await CounselorOnlineSubscription.exists({
        userId: recipientId,
        counselorId: data.counselorId,
      }),
    );
    // Recheck the exact pair, including notifications queued before bell OFF.
    if (!await isStillSubscribed()) return null;

    const notification = await Notification.create({
      recipientId,
      actorId: actorId || null,
      type,
      title,
      message,
      data,
      actionUrl,
    });

    const notificationPayload = notification.toObject();
    if (global.io) {
      const recipient = String(recipientId);
      [
        `user_${recipient}`,
        `counsellor_${recipient}`,
        `counselor_${recipient}`,
      ].forEach((room) => global.io.to(room).emit('notification:new', notificationPayload));
    }

    try {
      let registeredTokens = [];
      try {
        registeredTokens = await NotificationToken.find({
          userId: recipientId,
          active: true,
        }).select('token').lean();
      } catch (error) {
        console.warn('FCM token lookup failed; using user token:', error.message);
      }
      const tokens = new Set(registeredTokens.map((entry) => entry.token).filter(Boolean));
      if (tokens.size === 0) {
        const recipient = await User.findById(recipientId).select('fcmToken').lean();
        if (recipient?.fcmToken) {
          const owner = await NotificationToken.findOne({ token: recipient.fcmToken })
            .select('userId active').lean();
          if (!owner || (owner.active && String(owner.userId) === String(recipientId))) {
            tokens.add(recipient.fcmToken);
          }
        }
      }

      // One expired device must not stop delivery to the user's other devices.
      await Promise.all([...tokens].map(async (token) => {
        try {
          if (!await isStillSubscribed()) return;
          await sendPushNotification({
            token,
            title,
            body: message,
            dataOnly: pushDataOnly,
            data: {
              ...data,
              notificationId: notification._id,
              type: pushType || data?.type || notificationTypeToPushType[type] || type,
              title,
              body: message,
              actionUrl,
            },
          });
        } catch (error) {
          if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(error.code)) {
            await NotificationToken.updateOne({ token, userId: recipientId }, { $set: { active: false } });
            await User.updateOne({ _id: recipientId, fcmToken: token }, { $unset: { fcmToken: '' } });
          }
          console.error('Push delivery failed for a device:', error.message);
        }
      }));
    } catch (pushError) {
      console.error('Push delivery failed:', pushError.message);
    }

    return notification;
  } catch (error) {
    console.error('Notification creation failed:', error.message);
    return null;
  }
};
