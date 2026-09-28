import mongoose from "../../persistence/mongoose.js";

export const NOTIFICATION_DELIVERY_STATUSES = [
  "pending",
  "sent",
  "failed",
  "skipped",
];

const notificationDeliverySchema = new mongoose.Schema(
  {
    ruleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NotificationRule",
      default: null,
      index: true,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: NOTIFICATION_DELIVERY_STATUSES,
      required: true,
      default: "pending",
      index: true,
    },
    dedupeKey: { type: String, required: true },
    mainBackendStatus: { type: Number, default: null },
    error: { type: String, default: null },
    sentAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: "admin_notification_deliveries" },
);

notificationDeliverySchema.index({ dedupeKey: 1 }, { unique: true });
notificationDeliverySchema.index({ ruleId: 1, recipientId: 1, createdAt: -1 });
notificationDeliverySchema.index({ recipientId: 1, createdAt: -1 });
notificationDeliverySchema.index({ status: 1, createdAt: -1 });

export default mongoose.models.NotificationDelivery ||
  mongoose.model("NotificationDelivery", notificationDeliverySchema);
