import mongoose from "../../persistence/mongoose.js";
import User from "../models/User.js";
import { createNotification } from "../../services/notificationService.js";

// The admin and customer APIs now run in one process and share delivery.
export const sendPromotionNotificationToMainBackend = async (payload) => {
  const audience = payload.audience;
  if (!["all_users", "selected_users", "all_counsellors", "selected_counsellors"].includes(audience)) {
    return { success: false, status: 400, error: "Invalid notification audience" };
  }
  const query = { isActive: true, role: audience.includes("counsellor") ? "counsellor" : "user" };
  if (audience.startsWith("selected_")) {
    const ids = audience === "selected_users" ? payload.selectedUserIds : payload.selectedCounsellorIds;
    if (!Array.isArray(ids) || !ids.length || !ids.every(id => mongoose.isObjectIdOrHexString(id))) {
      return { success: false, status: 400, error: "Valid selected recipient IDs are required" };
    }
    query._id = { $in: ids };
  }
  let deliveredCount = 0;
  let failedCount = 0;
  try {
    for await (const recipient of User.find(query).select("_id").lean().cursor()) {
      try {
        await createNotification({
          recipientId: recipient._id,
          type: "system",
          title: payload.title,
          message: payload.body,
          actionUrl: payload.actionUrl || "",
          data: { ...payload.data, notificationType: payload.notificationType || "promotion" },
        });
        deliveredCount += 1;
      } catch {
        failedCount += 1;
      }
    }
    return {
      success: failedCount === 0,
      status: failedCount ? 502 : 200,
      body: { deliveredCount, failedCount },
      error: failedCount ? "Some notifications could not be saved" : null,
    };
  } catch (error) {
    return { success: false, status: 500, body: { deliveredCount, failedCount }, error: error.message };
  }
};
