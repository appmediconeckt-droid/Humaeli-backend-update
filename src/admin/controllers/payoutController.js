import Payout from "../models/Payout.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import Notification from "../models/Notification.js";

const transactionStatusToPayoutStatus = (status, metadata = {}) => {
  const payoutStatus = String(metadata.payoutStatus || "").toLowerCase();
  if (payoutStatus === "paid") return "COMPLETED";
  if (payoutStatus === "approved" || payoutStatus === "processing") return "APPROVED";
  if (payoutStatus === "rejected") return "CANCELLED";
  return ({ pending: "PENDING", hold: "APPROVED", completed: "COMPLETED", failed: "FAILED", refunded: "CANCELLED" })[String(status || "pending").toLowerCase()] || String(status).toUpperCase();
};

const payoutStatusToTransactionStatus = (status) =>
  ({ APPROVED: "hold", COMPLETED: "completed", CANCELLED: "failed" })[status] || status.toLowerCase();

const withdrawalFilter = { type: "debit", description: /withdrawal/i };

const normalizeWithdrawal = (transaction) => ({
  _id: `withdrawal-${transaction._id}`,
  payoutId: `WITHDRAWAL-${transaction._id}`,
  counselorId: transaction.userId?._id || transaction.userId,
  counselorName: transaction.userId?.fullName || "Unknown counselor",
  counselorEmail: transaction.userId?.email || "",
  amount: Number(transaction.amount || 0),
  taxAmount: Number(transaction.metadata?.feeAmount || 0),
  netAmount: Number(transaction.metadata?.netAmount ?? transaction.amount ?? 0),
  currency: transaction.currency || "INR",
  status: transactionStatusToPayoutStatus(transaction.status, transaction.metadata),
  paymentMethod: "BANK_TRANSFER",
  payoutType: transaction.metadata?.payoutType || "standard",
  transactionReference: transaction.metadata?.transactionReference || "",
  approvedAt: transaction.metadata?.approvedAt || null,
  processedAt: transaction.metadata?.processedAt || null,
  completedAt: transaction.metadata?.paidAt || null,
  failureReason: transaction.metadata?.failureReason || "",
  source: "WITHDRAWAL_TRANSACTION",
  createdAt: transaction.createdAt,
  updatedAt: transaction.updatedAt
});

const updateWithdrawal = async (syntheticId, status, extra = {}) => {
  if (!String(syntheticId).startsWith("withdrawal-")) return null;
  const id = String(syntheticId).slice(11);
  const transaction = await Transaction.findByIdAndUpdate(
    id,
    { status: payoutStatusToTransactionStatus(status), ...extra },
    { new: true }
  ).populate("userId", "fullName email");
  return transaction ? normalizeWithdrawal(transaction) : null;
};

const createCounselorNotification = async ({ recipientId, title, message, transaction, status }) => {
  if (!recipientId) return;
  try {
    await Notification.create({
      recipientId,
      type: "payment",
      title,
      message,
      data: {
        withdrawalId: transaction._id,
        amount: transaction.amount,
        netAmount: transaction.metadata?.netAmount ?? transaction.amount,
        payoutStatus: status,
        transactionReference: transaction.metadata?.transactionReference || ""
      },
      actionUrl: "/counselor/earnings"
    });
  } catch (error) {
    console.error("Payout notification failed:", error.message);
  }
};

// Helper: Generate unique payout ID
const generatePayoutId = () => {
  return `PAYOUT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// Get all payouts with filters
export const getAllPayouts = async (req, res) => {
  try {
    const { status, page = 1, limit = 10, counselorId, sortBy = "createdAt" } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (counselorId) filter.counselorId = counselorId;

    const skip = (page - 1) * limit;

    const transactionFilter = {
      ...withdrawalFilter,
      ...(status ? { status: payoutStatusToTransactionStatus(status) } : {})
    };

    const [savedPayouts, withdrawals] = await Promise.all([
      Payout.find(filter)
        .sort({ [sortBy]: -1 })
        .populate("approvedBy", "email")
        .populate("processedBy", "email"),
      Transaction.find(transactionFilter)
        .sort({ [sortBy]: -1 })
        .populate("userId", "fullName email")
    ]);

    const combined = [
      ...savedPayouts.map(p => p.toObject()),
      ...withdrawals.map(normalizeWithdrawal)
    ].sort((a, b) => new Date(b[sortBy] || b.createdAt) - new Date(a[sortBy] || a.createdAt));
    const total = combined.length;
    const payouts = combined.slice(skip, skip + parseInt(limit));

    res.json({
      success: true,
      data: payouts,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("Error in getAllPayouts:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Get pending payouts
export const getPendingPayouts = async (req, res) => {
  try {
    const payouts = await Payout.find({ status: "PENDING" })
      .sort({ createdAt: -1 })
      .populate("counselorId", "fullName email");

    const totalPending = payouts.reduce((sum, p) => sum + p.amount, 0);

    res.json({
      success: true,
      count: payouts.length,
      totalAmount: totalPending,
      data: payouts
    });
  } catch (err) {
    console.error("Error in getPendingPayouts:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Get payout statistics
export const getPayoutStats = async (req, res) => {
  try {
    const stats = await Payout.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" }
        }
      }
    ]);

    const total = await Payout.aggregate([
      {
        $group: {
          _id: null,
          totalPayouts: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
          totalTax: { $sum: "$taxAmount" },
          totalNet: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, "$netAmount", 0] } }
        }
      }
    ]);

    const withdrawalStats = await Transaction.aggregate([
      { $match: withdrawalFilter },
      { $group: { _id: "$status", count: { $sum: 1 }, totalAmount: { $sum: { $ifNull: ["$amount", 0] } }, totalNet: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, { $ifNull: ["$metadata.netAmount", "$amount"] }, 0] } }, totalTax: { $sum: { $ifNull: ["$metadata.feeAmount", 0] } } } }
    ]);
    const withdrawalOverall = withdrawalStats.reduce((acc, row) => ({
      totalPayouts: acc.totalPayouts + row.count,
      totalAmount: acc.totalAmount + row.totalAmount,
      totalNet: acc.totalNet + row.totalNet,
      totalTax: acc.totalTax + row.totalTax
    }), { totalPayouts: 0, totalAmount: 0, totalTax: 0, totalNet: 0 });
    const savedOverall = total[0] || { totalPayouts: 0, totalAmount: 0, totalTax: 0, totalNet: 0 };

    res.json({
      success: true,
      byStatus: [
        ...stats,
        ...withdrawalStats.map(s => ({ _id: transactionStatusToPayoutStatus(s._id), count: s.count, totalAmount: s.totalAmount }))
      ],
      overall: {
        totalPayouts: savedOverall.totalPayouts + withdrawalOverall.totalPayouts,
        totalAmount: savedOverall.totalAmount + withdrawalOverall.totalAmount,
        totalTax: savedOverall.totalTax + withdrawalOverall.totalTax,
        totalNet: savedOverall.totalNet + withdrawalOverall.totalNet
      }
    });
  } catch (err) {
    console.error("Error in getPayoutStats:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Get specific payout
export const getPayoutById = async (req, res) => {
  try {
    const payout = await Payout.findById(req.params.id)
      .populate("counselorId")
      .populate("approvedBy", "email")
      .populate("processedBy", "email");

    if (!payout) {
      return res.status(404).json({ success: false, error: "Payout not found" });
    }

    res.json({ success: true, data: payout });
  } catch (err) {
    console.error("Error in getPayoutById:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Create payout from counselor earnings
export const createPayout = async (req, res) => {
  try {
    const { counselorId, amount, period, taxAmount = 0, notes } = req.body;

    if (!counselorId || !amount) {
      return res.status(400).json({
        success: false,
        error: "counselorId and amount are required"
      });
    }

    // Get counselor details
    const counselor = await User.findById(counselorId);
    if (!counselor) {
      return res.status(404).json({ success: false, error: "Counselor not found" });
    }

    // Create payout
    const payout = new Payout({
      payoutId: generatePayoutId(),
      counselorId,
      counselorName: counselor.fullName,
      counselorEmail: counselor.email,
      amount,
      taxAmount,
      period,
      notes
    });

    await payout.save();

    res.json({
      success: true,
      message: "Payout created successfully",
      data: payout
    });
  } catch (err) {
    console.error("Error in createPayout:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Update bank details
export const updatePayoutBankDetails = async (req, res) => {
  try {
    const { bankDetails, paymentMethod } = req.body;

    const payout = await Payout.findByIdAndUpdate(
      req.params.id,
      {
        bankDetails,
        paymentMethod
      },
      { new: true }
    );

    if (!payout) {
      return res.status(404).json({ success: false, error: "Payout not found" });
    }

    res.json({
      success: true,
      message: "Bank details updated",
      data: payout
    });
  } catch (err) {
    console.error("Error in updatePayoutBankDetails:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Approve payout
export const approvePayout = async (req, res) => {
  try {
    const { notes } = req.body;
    const adminId = req.adminId; // From token

    if (String(req.params.id).startsWith("withdrawal-")) {
      const id = String(req.params.id).slice(11);
      const approvedAt = new Date();
      const transaction = await Transaction.findOneAndUpdate(
        { _id: id, ...withdrawalFilter, status: "pending" },
        {
          $set: {
            status: "hold",
            "metadata.payoutStatus": "approved",
            "metadata.approvalStatus": "approved",
            "metadata.approvedAt": approvedAt,
            "metadata.approvedBy": adminId,
            "metadata.approvalNotes": notes || ""
          }
        },
        { new: true }
      ).populate("userId", "fullName email");
      if (!transaction) return res.status(409).json({ success: false, error: "Only pending withdrawals can be approved" });
      await createCounselorNotification({
        recipientId: transaction.userId?._id || transaction.userId,
        title: "Withdrawal approved",
        message: `Your withdrawal of ₹${Number(transaction.metadata?.netAmount ?? transaction.amount).toFixed(2)} was approved and is awaiting bank transfer.`,
        transaction,
        status: "approved"
      });
      return res.json({ success: true, message: "Payout approved; bank transfer is still pending", data: normalizeWithdrawal(transaction) });
    }

    const payout = await Payout.findByIdAndUpdate(
      req.params.id,
      {
        status: "APPROVED",
        approvedBy: adminId,
        approvedAt: new Date(),
        notes
      },
      { new: true }
    );

    if (!payout) {
      return res.status(404).json({ success: false, error: "Payout not found" });
    }

    res.json({
      success: true,
      message: "Payout approved",
      data: payout
    });
  } catch (err) {
    console.error("Error in approvePayout:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Process/Send payout
export const processPayout = async (req, res) => {
  try {
    const { transactionReference } = req.body;
    const adminId = req.adminId;

    if (!String(transactionReference || "").trim()) {
      return res.status(400).json({ success: false, error: "Bank transaction reference/UTR is required" });
    }

    if (String(req.params.id).startsWith("withdrawal-")) {
      const id = String(req.params.id).slice(11);
      const paidAt = new Date();
      const transaction = await Transaction.findOneAndUpdate(
        { _id: id, ...withdrawalFilter, status: "hold" },
        {
          $set: {
            status: "completed",
            "metadata.payoutStatus": "paid",
            "metadata.transactionReference": String(transactionReference).trim(),
            "metadata.processedAt": paidAt,
            "metadata.paidAt": paidAt,
            "metadata.processedBy": adminId
          }
        },
        { new: true }
      ).populate("userId", "fullName email");
      if (!transaction) return res.status(409).json({ success: false, error: "Only approved withdrawals can be marked paid" });
      await createCounselorNotification({
        recipientId: transaction.userId?._id || transaction.userId,
        title: "Withdrawal paid",
        message: `₹${Number(transaction.metadata?.netAmount ?? transaction.amount).toFixed(2)} was sent to your bank account. UTR: ${transaction.metadata.transactionReference}`,
        transaction,
        status: "paid"
      });
      return res.json({ success: true, message: "Bank transfer confirmed and payout marked paid", data: normalizeWithdrawal(transaction) });
    }

    const payout = await Payout.findById(req.params.id);
    if (!payout) {
      return res.status(404).json({ success: false, error: "Payout not found" });
    }

    if (payout.status !== "APPROVED") {
      return res.status(400).json({
        success: false,
        error: "Only approved payouts can be processed"
      });
    }

    // In real system, integrate with payment gateway here
    // For now, just mark as completed
    payout.status = "COMPLETED";
    payout.processedBy = adminId;
    payout.processedAt = new Date();
    payout.completedAt = new Date();
    payout.transactionReference = transactionReference;

    await payout.save();

    res.json({
      success: true,
      message: "Payout processed successfully",
      data: payout
    });
  } catch (err) {
    console.error("Error in processPayout:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Reject payout
export const rejectPayout = async (req, res) => {
  try {
    const { failureReason } = req.body;

    if (String(req.params.id).startsWith("withdrawal-")) {
      if (!String(failureReason || "").trim()) {
        return res.status(400).json({ success: false, error: "Rejection reason is required" });
      }
      const id = String(req.params.id).slice(11);
      const rejectedAt = new Date();
      const transaction = await Transaction.findOneAndUpdate(
        { _id: id, ...withdrawalFilter, status: { $in: ["pending", "hold"] } },
        {
          $set: {
            status: "failed",
            "metadata.payoutStatus": "rejected",
            "metadata.failureReason": String(failureReason).trim(),
            "metadata.rejectedAt": rejectedAt,
            "metadata.refundedAt": rejectedAt
          }
        },
        { new: true }
      ).populate("userId", "fullName email");
      if (!transaction) return res.status(409).json({ success: false, error: "Only pending or approved withdrawals can be rejected" });
      await User.findByIdAndUpdate(transaction.userId?._id || transaction.userId, { $inc: { walletBalance: transaction.amount } });
      await createCounselorNotification({
        recipientId: transaction.userId?._id || transaction.userId,
        title: "Withdrawal rejected",
        message: `Your withdrawal was rejected and ₹${Number(transaction.amount).toFixed(2)} was returned to your wallet. Reason: ${transaction.metadata.failureReason}`,
        transaction,
        status: "rejected"
      });
      return res.json({ success: true, message: "Payout rejected and amount returned to counselor wallet", data: normalizeWithdrawal(transaction) });
    }

    const payout = await Payout.findByIdAndUpdate(
      req.params.id,
      {
        status: "CANCELLED",
        failureReason
      },
      { new: true }
    );

    if (!payout) {
      return res.status(404).json({ success: false, error: "Payout not found" });
    }

    res.json({
      success: true,
      message: "Payout cancelled",
      data: payout
    });
  } catch (err) {
    console.error("Error in rejectPayout:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Get payout history for a counselor
export const getPayoutHistory = async (req, res) => {
  try {
    const { counselorId } = req.params;

    const payouts = await Payout.find({ counselorId })
      .sort({ createdAt: -1 })
      .populate("approvedBy", "email")
      .populate("processedBy", "email");

    const stats = {
      totalPayouts: payouts.length,
      totalAmount: payouts.reduce((sum, p) => sum + p.amount, 0),
      completedAmount: payouts
        .filter(p => p.status === "COMPLETED")
        .reduce((sum, p) => sum + p.amount, 0),
      pendingAmount: payouts
        .filter(p => p.status === "PENDING")
        .reduce((sum, p) => sum + p.amount, 0),
      approvedAmount: payouts
        .filter(p => p.status === "APPROVED")
        .reduce((sum, p) => sum + p.amount, 0)
    };

    res.json({
      success: true,
      stats,
      data: payouts
    });
  } catch (err) {
    console.error("Error in getPayoutHistory:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};
