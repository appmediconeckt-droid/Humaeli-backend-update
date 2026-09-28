import mongoose from "../persistence/mongoose.js";

const chatSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    counselorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
      index: true,
    },
    sessionType: {
      type: String,
      enum: ["chat", "voice", "video"],
      default: "chat",
    },
    amount: {
      type: Number,
      default: 0,
    },
    ratePerMinute: {
      type: Number,
      default: 0,
    },
    rateDurationMinutes: {
      type: Number,
      default: 30,
    },
    activeSegmentStartedAt: {
      type: Date,
      default: null,
    },
    billedSeconds: {
      type: Number,
      default: 0,
    },
    billedMinutes: {
      type: Number,
      default: 0,
    },
    lastBilledAt: {
      type: Date,
      default: null,
    },
    commissionRate: {
      type: Number,
      default: 20,
    },
    commissionAmount: {
      type: Number,
      default: 0,
    },
    counselorEarning: {
      type: Number,
      default: 0,
    },
    paymentStatus: {
      type: String,
      enum: ["free", "hold", "paid", "refunded", "released"],
      default: "free",
      index: true,
    },
    sessionStatus: {
      type: String,
      enum: ["pending", "active", "completed", "cancelled", "refunded"],
      default: "pending",
      index: true,
    },
    paymentTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
    },
    earningId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CounselorEarning",
      default: null,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    endedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    refundReason: {
      type: String,
      default: "",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

chatSessionSchema.index({ counselorId: 1, sessionStatus: 1, createdAt: -1 });

const ChatSession =
  mongoose.models.ChatSession || mongoose.model("ChatSession", chatSessionSchema);

export default ChatSession;
