import CounselorOnlineSubscription from "../models/CounselorOnlineSubscription.js";
import User from "../models/userModel.js";
import { createNotificationSafely } from "./notificationService.js";

export const notifyCounselorSubscribersOnline = async (counselorId) => {
  const counselor = await User.findById(counselorId).select("fullName role").lean();
  if (!counselor || !["counsellor", "counselor"].includes(counselor.role)) {
    return { sent: 0 };
  }

  const subscriptions = await CounselorOnlineSubscription.find({ counselorId })
    .select("userId")
    .lean();

  let sent = 0;
  for (const subscription of subscriptions) {
    const notification = await createNotificationSafely({
      recipientId: subscription.userId,
      actorId: counselorId,
      type: "system",
      title: `${counselor.fullName || "Your consultant"} is online`,
      message: `${counselor.fullName || "Your consultant"} is now online and available to chat.`,
      data: {
        type: "COUNSELOR_ONLINE",
        counselorId: String(counselorId),
        counselorName: counselor.fullName || "",
      },
      actionUrl: `/chat/${counselorId}`,
    });
    if (notification) sent += 1;
  }

  return { sent };
};
