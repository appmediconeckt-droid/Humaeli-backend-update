import mongoose from "../../persistence/mongoose.js";

export const NOTIFICATION_TYPES = [
  "promotion",
  "engagement",
  "reminder",
  "new_feature",
  "custom",
];

export const NOTIFICATION_AUDIENCES = [
  "all_users",
  "selected_users",
  "all_counsellors",
  "selected_counsellors",
];

export const NOTIFICATION_CONDITIONS = [
  "inactive_2_days",
  "inactive_5_7_days",
  "pending_appointment",
  "post_session",
  "feedback_reminder",
  "weekly_user_engagement",
  "counsellor_inactive",
  "pending_counselling_request",
  "counsellor_upcoming_session",
  "counsellor_session_followup",
  "weekly_counsellor_engagement",
  "scheduled_promotion",
];

export const NOTIFICATION_STATUSES = ["active", "inactive"];

const adminAuditSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    adminEmail: { type: String, default: "" },
  },
  { _id: false }
);

const notificationRuleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    notificationType: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
      index: true,
    },
    audience: {
      type: String,
      enum: NOTIFICATION_AUDIENCES,
      required: true,
      index: true,
    },
    condition: {
      type: String,
      enum: NOTIFICATION_CONDITIONS,
      required: true,
      index: true,
    },
    selectedUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    selectedCounsellorIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    specialization: { type: String, trim: true, default: "" },
    actionUrl: { type: String, trim: true, default: "" },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: NOTIFICATION_STATUSES,
      default: "inactive",
      index: true,
    },
    scheduledAt: { type: Date, default: null, index: true },
    timezone: { type: String, trim: true, default: "" },
    sendImmediately: { type: Boolean, default: false },
    lastProcessedAt: { type: Date, default: null, index: true },
    createdBy: { type: adminAuditSchema, default: () => ({}) },
    updatedBy: { type: adminAuditSchema, default: () => ({}) },
  },
  { timestamps: true }
);

notificationRuleSchema.index({ status: 1, condition: 1, audience: 1 });
notificationRuleSchema.index({ notificationType: 1, specialization: 1 });
notificationRuleSchema.index({ status: 1, condition: 1, scheduledAt: 1, lastProcessedAt: 1 });

export default mongoose.models.NotificationRule ||
  mongoose.model("NotificationRule", notificationRuleSchema);
