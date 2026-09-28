import mongoose from "../persistence/mongoose.js";

const counselorEarningSchema = new mongoose.Schema(
  {
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    counselorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatSession",
      default: null,
      index: true,
    },
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
      unique: true,
      sparse: true,
    },
    callId: {
      type: String,
      default: null,
      index: true,
    },
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      default: null,
    },
    sessionType: {
      type: String,
      enum: ["chat", "voice", "video"],
      default: "chat",
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    commission: {
      type: Number,
      default: 0,
    },
    earningAmount: {
      type: Number,
      required: true,
    },
    earningStatus: {
      type: String,
      enum: ["completed", "refunded", "reversed"],
      default: "completed",
      index: true,
    },
    payoutStatus: {
      type: String,
      enum: ["pending", "approved", "paid", "rejected"],
      default: "pending",
      index: true,
    },
    paidAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

const CounselorEarning =
  mongoose.models.CounselorEarning ||
  mongoose.model("CounselorEarning", counselorEarningSchema);

export default CounselorEarning;
