import { sendPushNotification } from "../services/pushNotificationService.js";

export const testNotification = async (req, res) => {
  try {
    const rawToken = req.body?.fcmToken || req.body?.token;

    console.log("================================");
    console.log("TOKEN TYPE:", typeof rawToken);
    console.log("RAW TOKEN LENGTH:", rawToken?.length);
    console.log("================================");

    if (!rawToken || typeof rawToken !== "string") {
      return res.status(400).json({
        success: false,
        message: "Valid FCM token is required",
      });
    }

    const cleanToken = rawToken.trim();

    console.log("CLEAN TOKEN LENGTH:", cleanToken.length);

    const result = await sendPushNotification({
      token: cleanToken,
      title: "Humaeli",
      body: "Backend push notification is working!",
      data: {
        type: "test",
      },
    });

    return res.status(200).json({
      success: true,
      message: "Notification sent successfully",
      result,
    });
  } catch (error) {
    console.error("❌ Notification Error");
    console.error("Code:", error.code);
    console.error("Message:", error.message);

    return res.status(500).json({
      success: false,
      code: error.code || null,
      message: error.message,
    });
  }
};
