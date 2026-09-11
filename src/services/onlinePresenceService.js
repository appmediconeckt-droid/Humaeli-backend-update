import User from "../models/userModel.js";
import { notifyCounselorSubscribersOnline } from "./counselorOnlineNotificationService.js";

// Return the previous state atomically so login, HTTP and socket activity do
// not each send a notification for the same offline -> online transition.
export const markUserOnlineAndNotify = async (userId) => {
  const previous = await User.findByIdAndUpdate(userId, {
    $set: { isOnline: true, lastSeen: null },
  }, { new: false });

  if (previous && !previous.isOnline &&
      ["counsellor", "counselor"].includes(previous.role)) {
    await notifyCounselorSubscribersOnline(userId).catch((error) => {
      console.error("Counselor online notification failed:", error.message);
    });
  }
};
