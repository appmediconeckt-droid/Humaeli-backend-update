// src/controllers/admin/adminRefundController.js
import Transaction from "../../models/mysql/TransactionModel.js";
import User from "../../models/userModel.js";
import AuditLog from "../../models/mysql/AuditLogModel.js";

const statusOf = (tx) => {
  let meta = {};
  try { meta = JSON.parse(tx.metadata || "{}"); } catch {}
  return String(meta.refundStatus || tx.status || "pending").toLowerCase();
};

const serialize = (tx) => {
  let meta = {};
  try { meta = JSON.parse(tx.metadata || "{}"); } catch {}
  return {
    _id: tx.id || tx._id,
    amount: tx.amount,
    currency: tx.currency || "INR",
    status: statusOf(tx),
    userId: tx.userId,
    bankDetails: meta.bankDetails || {},
    processingDeadline: meta.processingDeadline,
    transactionReference: meta.transactionReference,
    failureReason: meta.failureReason,
    adminNotes: meta.adminNotes,
    approvedAt: meta.approvedAt,
    paidAt: meta.paidAt,
    rejectedAt: meta.rejectedAt,
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
  };
};

const audit = async (req, tx, details) => {
  try {
    await AuditLog.create({
      adminEmail: req.user?.email,
      action: "REFUND",
      entityType: "TRANSACTION",
      entityId: String(tx.id || tx._id),
      entityName: `Wallet refund ${tx.id || tx._id}`,
      ipAddress: req.ip,
      details,
      status: "SUCCESS",
    });
  } catch (e) {
    console.warn("Audit log error:", e.message);
  }
};

// Notify via wallet controller directly (since we're in same process)
const notifyWalletRefundStatus = async (transactionId, status) => {
  try {
    const walletController = await import("../walletController.js");
    if (walletController.handleAdminRefundStatusNotification) {
      await walletController.handleAdminRefundStatusNotification(transactionId, status);
    }
  } catch {
    // silently ignore if function not available
  }
};

export const listRefundRequests = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const statusFilter = String(req.query.status || "").trim().toLowerCase();

    let all = await Transaction.find({ type: "refund" });
    if (statusFilter) {
      all = all.filter((tx) => statusOf(tx) === statusFilter);
    }
    const total = all.length;
    const rows = all.slice((page - 1) * limit, (page - 1) * limit + limit);
    return res.json({
      success: true,
      data: rows.map(serialize),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Refund requests could not be loaded" });
  }
};

export const getRefundStats = async (_req, res) => {
  try {
    const all = await Transaction.find({ type: "refund" });
    const grouped = {};
    for (const tx of all) {
      const s = statusOf(tx);
      if (!grouped[s]) grouped[s] = { _id: s, count: 0, amount: 0 };
      grouped[s].count++;
      grouped[s].amount += Number(tx.amount) || 0;
    }
    return res.json({ success: true, data: Object.values(grouped) });
  } catch {
    return res.status(500).json({ success: false, message: "Refund statistics could not be loaded" });
  }
};

export const approveRefundRequest = async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx || tx.type !== "refund" || statusOf(tx) !== "pending") {
      return res.status(409).json({ success: false, message: "Only pending refund requests can be approved" });
    }

    let meta = {};
    try { meta = JSON.parse(tx.metadata || "{}"); } catch {}
    meta.refundStatus = "approved";
    meta.approvedAt = new Date().toISOString();
    meta.adminNotes = String(req.body.notes || "").trim();
    meta.approvedBy = req.user?.email;

    await Transaction.updateOne({ id: tx.id }, { metadata: JSON.stringify(meta), status: "hold" });
    await audit(req, tx, "Wallet refund approved");
    await notifyWalletRefundStatus(tx.id, "approved");

    return res.json({ success: true, message: "Refund approved; complete the bank transfer within 48 hours", data: serialize({ ...tx, metadata: JSON.stringify(meta), status: "hold" }) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const markRefundPaid = async (req, res) => {
  try {
    const reference = String(req.body.transactionReference || "").trim();
    if (!reference) return res.status(400).json({ success: false, message: "Bank transaction reference is required" });

    const tx = await Transaction.findById(req.params.id);
    if (!tx || tx.type !== "refund" || !["approved", "processing"].includes(statusOf(tx))) {
      return res.status(409).json({ success: false, message: "Only approved refunds can be marked paid" });
    }

    let meta = {};
    try { meta = JSON.parse(tx.metadata || "{}"); } catch {}
    meta.refundStatus = "paid";
    meta.paidAt = new Date().toISOString();
    meta.transactionReference = reference;
    meta.processedBy = req.user?.email;

    await Transaction.updateOne({ id: tx.id }, { metadata: JSON.stringify(meta), status: "completed" });
    if (tx.userId) {
      await User.updateOne({ _id: tx.userId }, { $set: { activeWalletRefundRequest: false } });
    }
    await audit(req, tx, `Wallet refund paid (${reference})`);
    await notifyWalletRefundStatus(tx.id, "paid");

    return res.json({ success: true, message: "Refund marked as paid", data: serialize({ ...tx, metadata: JSON.stringify(meta), status: "completed" }) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const rejectRefundRequest = async (req, res) => {
  try {
    const reason = String(req.body.failureReason || req.body.reason || "").trim();
    if (reason.length < 3) return res.status(400).json({ success: false, message: "Rejection reason is required" });

    const tx = await Transaction.findById(req.params.id);
    if (!tx || tx.type !== "refund" || ["paid", "rejected"].includes(statusOf(tx))) {
      return res.status(409).json({ success: false, message: "This refund request is already finalized" });
    }

    let meta = {};
    try { meta = JSON.parse(tx.metadata || "{}"); } catch {}
    meta.refundStatus = "rejected";
    meta.rejectedAt = new Date().toISOString();
    meta.failureReason = reason;
    meta.rejectedBy = req.user?.email;

    await Transaction.updateOne({ id: tx.id }, { metadata: JSON.stringify(meta), status: "refunded" });

    if (tx.userId) {
      await User.updateOne({ _id: tx.userId }, {
        $inc: { walletBalance: tx.amount },
        $set: { activeWalletRefundRequest: false },
      });
    }
    await audit(req, tx, `Wallet refund rejected; Rs ${tx.amount} returned to wallet`);
    await notifyWalletRefundStatus(tx.id, "rejected");

    return res.json({ success: true, message: "Request rejected and amount returned to the user wallet", data: serialize({ ...tx, metadata: JSON.stringify(meta), status: "refunded" }) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
