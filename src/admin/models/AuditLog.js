import mongoose from "../../persistence/mongoose.js";

const auditLogSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    adminEmail: { type: String },
    action: { type: String, enum: ["CREATE", "UPDATE", "DELETE", "ACTIVATE", "DEACTIVATE", "VERIFY", "LOGIN", "REFUND"], required: true },
    entityType: { type: String, enum: ["USER", "COUNSELOR", "SETTINGS", "CONTENT", "TRANSACTION", "SUPPORT"], required: true },
    entityId: { type: mongoose.Schema.Types.ObjectId },
    entityName: { type: String },
    changes: { type: Object }, // Store what was changed
    reason: { type: String }, // For deactivations, suspensions
    ipAddress: { type: String },
    status: { type: String, enum: ["SUCCESS", "FAILURE"], default: "SUCCESS" },
    details: { type: String }
  },
  { timestamps: true }
);

const AuditLog = mongoose.model("AuditLog", auditLogSchema);
export default AuditLog;
