import { messaging } from "../config/firebaseAdmin.js";

const isCallPush = (data = {}) => {
  const presentation = String(data.presentation || data.presentAs || "")
    .trim()
    .toLowerCase();
  const notificationOnly =
    presentation === "notification_only" ||
    String(data.notificationOnly || "").toLowerCase() === "true";
  if (notificationOnly) return false;

  const type = String(data.type || data.notificationType || data.event || "")
    .trim()
    .toUpperCase();
  return type.includes("CALL") || Boolean(data.callId || data.call_id);
};

export const sendPushNotification = async ({
  token,
  title,
  body,
  data = {},
}) => {
  try {
    if (!token) {
      throw new Error('FCM token is required');
    }

    const safeData = {};

    Object.keys(data).forEach((key) => {
      safeData[key] = String(data[key]);
    });

    const callPush = isCallPush(safeData);
    const message = {
      token,
      data: safeData,
      android: {
        priority: 'high',
        ...(callPush
          ? {}
          : {
              notification: {
                sound: 'default',
                channelId: "humaeli-default",
              },
            }),
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            ...(callPush ? { contentAvailable: true } : {}),
          },
        },
      },
    };

    if (!callPush) {
      message.notification = {
        title,
        body,
      };
    }

    const response = await messaging.send(message);

    console.log('✅ Push notification sent successfully:');
    console.log(response);

    return response;
  } catch (error) {
    console.error('❌ Push notification error:', error);
    throw error;
  }
};
