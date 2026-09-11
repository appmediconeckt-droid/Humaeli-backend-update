import mongoose from "../persistence/mongoose.js";

const messageSchema = new mongoose.Schema({
  messageId: {
    type: String,
    unique: true,
    default: () =>
      `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  },
  chatId: {
    type: mongoose.Schema.Types.Mixed,
    ref: "Chat",
    required: true,
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  senderRole: {
    type: String,
    enum: ["user", "counsellor"],
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  contentType: {
    type: String,
    enum: ["TEXT", "IMAGE", "FILE", "AUDIO"],
    default: "TEXT",
  },
  attachmentUrl: {
    type: String,
    default: null,
  },
  attachmentName: {
    type: String,
    default: null,
  },
  attachmentMimeType: {
    type: String,
    default: null,
  },
  attachmentSize: {
    type: Number,
    default: null,
  },
  isRead: {
    type: Boolean,
    default: false,
  },
  deletedFor: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  readAt: Date,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("Message", messageSchema);
