import {
  messaging,
} from '../config/firebaseAdmin.js';

import NotificationToken from '../models/NotificationToken.js';
import Notification from '../models/Notification.js';
import User from '../models/userModel.js';

export const sendPushNotification = async ({
  token,
  title,
  body,
  data = {},
  dataOnly = false,
}) => {
  try {
    if (!messaging) {
      console.warn('FCM push skipped: Firebase Admin is not configured');
      return null;
    }

    if (!token) {
      console.log('FCM token missing');
      return null;
    }

    // FCM data values strings hone chahiye
    const stringData = {};

    Object.entries(data).forEach(
      ([key, value]) => {
        stringData[key] = String(value);
      },
    );

    const message = {
      token,
      data: stringData,
      android: {
        priority: 'high',
      },
    };

    if (!dataOnly) {
      message.notification = { title, body };
      message.android.notification = {
        channelId: 'humaeli-default',
        sound: 'default',
      };
      message.apns = {
        payload: { aps: { sound: 'default' } },
      };
    }

    if (dataOnly) {
      console.log('FCM data-only push:', {
        type: stringData.type,
        chatId: stringData.chatId,
        hasNotificationPayload: Boolean(message.notification),
      });
    }

    const response =
      await messaging.send(message);

    console.log(
      '✅ Push notification sent:',
      response,
    );

    return response;
  } catch (error) {
    console.error(
      '❌ Push notification error:',
      error,
    );

    throw error;
  }
};

// Persist every in-app notification and, when the recipient has an active FCM
// token, also deliver the same notification as a push. Notification failures
// must never break the primary chat/payment/appointment operation.
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

    const notification = await Notification.create({
      recipientId,
      actorId: actorId || null,
      type,
      title,
      message,
      data,
      actionUrl,
    });

    const payload = notification.toObject();
    if (global.io) {
      const recipient = String(recipientId);
      [
        `user_${recipient}`,
        `counsellor_${recipient}`,
        `counselor_${recipient}`,
      ].forEach((room) => global.io.to(room).emit('notification:new', payload));
    }

    try {
      const registeredToken = await NotificationToken.findOne({
        userId: recipientId,
        active: true,
      }).sort({ lastUpdatedAt: -1 });

      const token = registeredToken?.token || (await User.findById(recipientId)
        .select('fcmToken')
        .lean())?.fcmToken;

      if (token) {
        await sendPushNotification({
          token,
          title,
          body: message,
          dataOnly: pushDataOnly,
          data: {
            ...data,
            notificationId: notification._id,
            type: pushType || type,
            title,
            body: message,
            actionUrl,
          },
        });
      }
    } catch (pushError) {
      console.error('Push delivery failed:', pushError.message);
    }

    return notification;
  } catch (error) {
    console.error('Notification creation failed:', error.message);
    return null;
  }
};
