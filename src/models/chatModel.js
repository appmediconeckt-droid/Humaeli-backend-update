import mongoose from "mongoose";

const chatSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // Optional for guest/landing page chats
    },
    sessionId: {
      type: String,
      index: true,
    },
    userMessage: String,
    aiResponse: String,
    responseType: {
      type: String,
      enum: ["answer", "consultant_recommendation"],
      default: "answer",
    },
    consultants: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
  },
  { timestamps: true },
);

export default mongoose.models.AIChat || mongoose.model("AIChat", chatSchema);
