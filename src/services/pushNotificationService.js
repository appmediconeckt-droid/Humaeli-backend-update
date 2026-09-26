import messaging, { admin } from "../config/firebaseAdmin.js";

export const sendPushNotification = async ({
  token,
  title,
  body,
  data = {},
}) => {
  try {
    if (!token || typeof token !== "string" || !token.trim()) {
      throw new Error("FCM token is required");
    }

    const safeData = {};
    Object.keys(data || {}).forEach((key) => {
      const val = data[key];
      safeData[key] = val !== null && val !== undefined ? String(val) : "";
    });

    const notificationType = String(safeData.type || "").toUpperCase();
    const isCallNotification = notificationType.includes("CALL") && Boolean(safeData.callId);

    const imageUrl = safeData.imageUrl || safeData.image || null;

    const message = {
      token: token.trim(),
      ...(isCallNotification
        ? {
            data: {
              ...safeData,
              title: String(title || "Incoming call"),
              body: String(body || "Incoming call"),
            },
          }
        : {
            notification: {
              title: String(title || "Mediconeckt"),
              body: String(body || ""),
              ...(imageUrl ? { imageUrl } : {}),
            },
            data: safeData,
          }),
      android: {
        priority: "high",
        ...(isCallNotification
          ? {}
          : {
              notification: {
                sound: "default",
                channelId: "high_importance_channel",
                priority: "max",
                defaultSound: true,
                defaultVibrateTimings: true,
                clickAction: "FLUTTER_NOTIFICATION_CLICK",
                ...(imageUrl ? { imageUrl } : {}),
              },
            }),
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: String(title || "Mediconeckt"),
              body: String(body || ""),
            },
            sound: "default",
            badge: 1,
            contentAvailable: true,
          },
        },
      },
    };

    const client = messaging || (admin && typeof admin.messaging === "function" ? admin.messaging() : admin);

    if (!client || typeof client.send !== "function") {
      throw new Error("Firebase messaging client not ready");
    }

    const response = await client.send(message);

    console.log("✅ Push notification sent successfully to token:", token.slice(0, 15) + "...", response);
    return response;
  } catch (error) {
    console.error("❌ Push notification error:", error.code || error.message);
    throw error;
  }
};

export default {
  sendPushNotification,
};
