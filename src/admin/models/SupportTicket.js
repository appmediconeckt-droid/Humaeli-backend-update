import mongoose from "../../persistence/mongoose.js";

const messageSchema = new mongoose.Schema({
  direction: { type: String, enum: ["INBOUND", "OUTBOUND"], required: true },
  from: { type: String, required: true },
  to: { type: String },
  body: { type: String, required: true },
  externalMessageId: { type: String },
  sentBy: { type: String },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const supportTicketSchema = new mongoose.Schema({
  ticketNumber: { type: String, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  requesterName: { type: String, default: "" },
  requesterEmail: { type: String, required: true, index: true },
  subject: { type: String, required: true },
  status: { type: String, enum: ["OPEN", "PENDING", "RESOLVED"], default: "OPEN", index: true },
  priority: { type: String, enum: ["LOW", "NORMAL", "HIGH", "URGENT"], default: "NORMAL", index: true },
  source: { type: String, enum: ["EMAIL", "WEBHOOK", "MANUAL"], default: "EMAIL" },
  messages: { type: [messageSchema], default: [] },
  unreadByAdmin: { type: Boolean, default: true, index: true },
  lastMessageAt: { type: Date, default: Date.now, index: true },
  resolvedAt: { type: Date, default: null },
  assignedTo: { type: String, default: "" }
  ,
  callDispute: {
    callId: { type: String, default: "" },
    transactionId: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", default: null },
    chargedAmount: { type: Number, default: 0 },
    correctAmount: { type: Number, default: 0 },
    refundedAmount: { type: Number, default: 0 },
    counselorReversal: { type: Number, default: 0 },
    platformReversal: { type: Number, default: 0 },
    actualDurationSeconds: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["", "INVESTIGATED", "NO_EXCESS", "REFUNDED"],
      default: ""
    },
    adjustmentId: { type: String, default: "" },
    investigatedAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    resolvedBy: { type: String, default: "" },
    reason: { type: String, default: "" }
  }
}, { timestamps: true });

supportTicketSchema.index({ status: 1, lastMessageAt: -1 });

export default mongoose.models.SupportTicket || mongoose.model("SupportTicket", supportTicketSchema);
