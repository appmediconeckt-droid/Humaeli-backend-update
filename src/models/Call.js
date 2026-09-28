import mongoose from "../persistence/mongoose.js";

const callSchema = new mongoose.Schema(
  {
    callId: {
      type: String,
      required: true,
      unique: true,
      default: () =>
        `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    },
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: false, // Make optional as videoCallController doesn't use it yet
      index: true,
    },
    roomId: {
      type: String,
      required: false,
      index: true,
    },
    callerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    initiatorType: {
      type: String,
      enum: ["user", "counsellor", "counselor"],
      default: "user",
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    receiverType: {
      type: String,
      enum: ["user", "counsellor", "counselor"],
      default: "counsellor",
    },
    callType: {
      type: String,
      enum: ["audio", "video", "voice"],
      required: true,
    },
    status: {
      type: String,
      enum: [
        "initiated",
        "ringing",
        "connected",
        "ended",
        "missed",
        "rejected",
        "busy",
        "on-hold",
        "pending",
        "active",
        "cancelled",
      ],
      default: "initiated",
    },
    startedAt: {
      type: Date,
      default: null,
    },
    endedAt: {
      type: Date,
      default: null,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    duration: {
      type: Number, // Duration in seconds
      default: 0,
    },
    callerName: {
      type: String,
      required: true,
    },
    receiverName: {
      type: String,
      required: true,
    },
    callerAvatar: {
      type: String,
      default: null,
    },
    receiverAvatar: {
      type: String,
      default: null,
    },
    callerLocation: {
      type: String,
      default: null,
    },
    receiverLocation: {
      type: String,
      default: null,
    },
    callerLocationData: {
      coordinates: { type: [Number], default: undefined }, // [lng, lat]
      address: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      country: { type: String, default: "" },
      capturedAt: { type: Date, default: null },
      _id: false,
    },
    receiverLocationData: {
      coordinates: { type: [Number], default: undefined }, // [lng, lat]
      address: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      country: { type: String, default: "" },
      capturedAt: { type: Date, default: null },
      _id: false,
    },
    isMuted: {
      type: Boolean,
      default: false,
    },
    isSpeakerOn: {
      type: Boolean,
      default: false,
    },
    isOnHold: {
      type: Boolean,
      default: false,
    },
    callQuality: {
      type: String,
      enum: ["good", "medium", "poor"],
      default: "good",
    },
    recordingUrl: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    endedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    paymentTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
    },
    paymentAmount: {
      type: Number,
      default: 0,
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "paid", "failed"],
      default: "unpaid",
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for better query performance
callSchema.index({ status: 1 });
callSchema.index({ createdAt: -1 });
// Composite index for fast call history queries (most common pattern)
callSchema.index({ callerId: 1, createdAt: -1 });
callSchema.index({ receiverId: 1, createdAt: -1 });
// Compound index for OR queries
callSchema.index({ callerId: 1, status: 1, createdAt: -1 });
callSchema.index({ receiverId: 1, status: 1, createdAt: -1 });

// Virtual for formatted duration
callSchema.virtual("formattedDuration").get(function () {
  const hrs = Math.floor(this.duration / 3600);
  const mins = Math.floor((this.duration % 3600) / 60);
  const secs = this.duration % 60;

  if (hrs > 0) {
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
});

const Call = mongoose.models.Call || mongoose.model("Call", callSchema);

export default Call;
