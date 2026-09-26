// src/controllers/admin/adminPaymentController.js
import Transaction from "../../models/mysql/TransactionModel.js";
import User from "../../models/userModel.js";

const razorpayRequest = async (path) => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials are not configured");
  }
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      Accept: "application/json",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.description || `Razorpay request failed (${response.status})`);
  }
  return payload;
};

const getCapturedGatewayPayment = async (transaction, requestedPaymentId) => {
  let meta = {};
  try { meta = JSON.parse(transaction.metadata || "{}"); } catch {}

  if (requestedPaymentId) {
    const payment = await razorpayRequest(`/payments/${encodeURIComponent(requestedPaymentId)}`);
    if (String(payment.order_id) !== String(transaction.razorpayOrderId)) {
      throw new Error("Payment ID does not belong to this wallet order");
    }
    return payment;
  }

  const result = await razorpayRequest(
    `/orders/${encodeURIComponent(transaction.razorpayOrderId)}/payments`
  );
  return result.items?.find((p) => p.status === "captured" || p.captured === true) || null;
};

export const getWalletPayments = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search = "" } = req.query;
    const safePage = Math.max(1, parseInt(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));

    let filter = { type: "credit" };
    if (status) filter.status = String(status).toLowerCase();

    let all = await Transaction.find(filter);

    // Filter to wallet top-up transactions
    all = all.filter((tx) => {
      const desc = String(tx.description || "").toLowerCase();
      return desc.includes("wallet") || desc.includes("top-up") || desc.includes("topup") || tx.razorpayOrderId;
    });

    // Search filter
    if (search.trim()) {
      const term = search.trim().toLowerCase();
      const matchingUsers = await User.find({
        $or: [
          { fullName: new RegExp(term, "i") },
          { email: new RegExp(term, "i") },
        ],
      });
      const userIds = new Set(matchingUsers.map((u) => String(u._id || u.id)));

      all = all.filter((tx) => {
        if (userIds.has(String(tx.userId))) return true;
        if (String(tx.razorpayOrderId || "").toLowerCase().includes(term)) return true;
        if (String(tx.razorpayPaymentId || "").toLowerCase().includes(term)) return true;
        return false;
      });
    }

    const total = all.length;
    const paged = all
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice((safePage - 1) * safeLimit, (safePage - 1) * safeLimit + safeLimit);

    // Fetch user details
    const userIds = [...new Set(paged.map((tx) => String(tx.userId)).filter(Boolean))];
    const users = userIds.length > 0 ? await User.find({ _id: { $in: userIds } }) : [];
    const userMap = new Map(users.map((u) => [String(u._id || u.id), u]));

    const payments = paged.map((tx) => ({
      ...tx,
      userId: userMap.get(String(tx.userId)) || {
        _id: tx.userId,
        fullName: `User ${String(tx.userId || "").slice(-6)}`,
        email: "",
        phone: "",
      },
    }));

    res.json({
      success: true,
      data: payments,
      pagination: { total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getWalletPaymentStats = async (req, res) => {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    let all = await Transaction.find({ type: "credit" });
    all = all.filter((tx) => {
      const desc = String(tx.description || "").toLowerCase();
      return desc.includes("wallet") || desc.includes("top-up") || desc.includes("topup") || tx.razorpayOrderId;
    });

    const byStatus = {};
    for (const tx of all) {
      const s = String(tx.status || "pending");
      if (!byStatus[s]) byStatus[s] = { count: 0, amount: 0 };
      byStatus[s].count++;
      byStatus[s].amount += Number(tx.amount) || 0;
    }

    const completed = byStatus.completed || { count: 0, amount: 0 };
    const pending = byStatus.pending || { count: 0, amount: 0 };
    const failed = byStatus.failed || { count: 0, amount: 0 };

    const monthTx = all.filter(
      (tx) => tx.status === "completed" && tx.createdAt && new Date(tx.createdAt) >= startOfMonth
    );
    const thisMonthAmount = monthTx.reduce((s, tx) => s + (Number(tx.amount) || 0), 0);

    res.json({
      success: true,
      data: {
        totalPayments: all.length,
        completedCount: completed.count,
        completedAmount: completed.amount,
        pendingCount: pending.count,
        pendingAmount: pending.amount,
        failedCount: failed.count,
        failedAmount: failed.amount,
        thisMonthAmount,
        thisMonthCount: monthTx.length,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const verifyAndCreditWalletPayment = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction || transaction.type !== "credit") {
      return res.status(404).json({ success: false, message: "Wallet payment not found" });
    }
    if (!transaction.razorpayOrderId) {
      return res.status(400).json({ success: false, message: "Razorpay Order ID is missing" });
    }

    let meta = {};
    try { meta = JSON.parse(transaction.metadata || "{}"); } catch {}

    if (meta.walletCreditStatus === "credited") {
      const user = await User.findById(transaction.userId);
      return res.json({
        success: true,
        message: "Payment is already credited; no balance change was made",
        data: transaction,
        balance: Number(user?.walletBalance || 0),
        alreadyCredited: true,
      });
    }

    if (transaction.status === "completed" && !meta.walletCreditStatus) {
      return res.status(409).json({
        success: false,
        message: "Legacy completed payment cannot be auto-credited safely. Verify the user's statement before manual recovery.",
      });
    }

    const paymentId = String(req.body.paymentId || transaction.razorpayPaymentId || "").trim();
    const payment = await getCapturedGatewayPayment(transaction, paymentId);
    if (!payment || (payment.status !== "captured" && payment.captured !== true)) {
      return res.status(409).json({ success: false, message: "Razorpay does not show a captured payment for this order" });
    }
    if (Number(payment.amount) !== Math.round(Number(transaction.amount) * 100)) {
      return res.status(409).json({ success: false, message: "Gateway amount does not match this order" });
    }
    if (String(payment.currency || "").toUpperCase() !== String(transaction.currency || "INR").toUpperCase()) {
      return res.status(409).json({ success: false, message: "Gateway currency does not match this order" });
    }

    // Credit user wallet
    const user = await User.findById(transaction.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "Payment user not found" });
    }
    const newBalance = (Number(user.walletBalance) || 0) + Number(transaction.amount);
    await User.updateOne({ _id: transaction.userId }, { $set: { walletBalance: newBalance } });

    // Update transaction
    meta.walletCreditStatus = "credited";
    meta.walletCreditedAt = meta.walletCreditedAt || new Date().toISOString();
    meta.walletCreditSource = "admin_recovery";
    meta.gatewayStatus = payment.status;
    meta.gatewayCaptured = payment.captured;
    meta.recoveredBy = req.user?.email || "admin";
    meta.recoveryReason = String(req.body.reason || "Payment captured but wallet credit missing").slice(0, 500);

    await Transaction.updateOne(
      { id: transaction.id },
      { razorpayPaymentId: payment.id, status: "completed", metadata: JSON.stringify(meta) }
    );

    return res.json({
      success: true,
      message: "Razorpay payment verified and wallet credited",
      data: { ...transaction, status: "completed", razorpayPaymentId: payment.id },
      balance: newBalance,
      alreadyCredited: false,
    });
  } catch (err) {
    console.error("Admin wallet recovery failed:", err);
    return res.status(500).json({ success: false, message: err.message || "Wallet recovery failed" });
  }
};
