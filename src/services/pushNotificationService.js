import { messaging } from "../config/firebaseAdmin.js";

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

    const message = {
      token,
      notification: {
        title,
        body,
      },
      data: safeData,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
        },
      },
    };

    if (!messaging) {
      throw new Error('Firebase Admin is not configured on the backend');
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

