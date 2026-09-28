import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import mongoose from "../../persistence/mongoose.js";

const walletPaymentFilter = {
  type: "credit",
  $or: [
    { description: /wallet\s*top-?up/i },
    { razorpayOrderId: { $exists: true, $ne: null } }
  ]
};

const razorpayRequest = async (path) => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials are not configured in admin backend");
  }

  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      Accept: "application/json"
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.description || `Razorpay request failed (${response.status})`);
  }
  return payload;
};

const getCapturedGatewayPayment = async (transaction, requestedPaymentId) => {
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
  return result.items?.find(payment =>
    payment.status === "captured" || payment.captured === true
  ) || null;
};

export const getWalletPayments = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search = "" } = req.query;
    const safePage = Math.max(1, parseInt(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const filter = { ...walletPaymentFilter };

    if (status) filter.status = String(status).toLowerCase();

    const term = String(search).trim();
    if (term) {
      const [users, historicalCalls] = await Promise.all([
        User.find({
          $or: [
            { fullName: { $regex: term, $options: "i" } },
            { email: { $regex: term, $options: "i" } },
            { phone: { $regex: term, $options: "i" } }
          ]
        }).select("_id"),
        mongoose.connection.collection("calls").find({
          $or: [
            { callerName: { $regex: term, $options: "i" } },
            { receiverName: { $regex: term, $options: "i" } }
          ]
        }).project({ callerId: 1, receiverId: 1 }).limit(100).toArray()
      ]);
      const historicalUserIds = historicalCalls.flatMap(call => [call.callerId, call.receiverId]).filter(Boolean);
      filter.$and = [{
        $or: [
          { userId: { $in: [...users.map(user => user._id), ...historicalUserIds] } },
          { razorpayOrderId: { $regex: term, $options: "i" } },
          { razorpayPaymentId: { $regex: term, $options: "i" } }
        ]
      }];
    }

    const [paymentRows, total] = await Promise.all([
      Transaction.find(filter)
        .select("userId amount currency status description type razorpayOrderId razorpayPaymentId metadata createdAt updatedAt")
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      Transaction.countDocuments(filter)
    ]);

    const userIds = [...new Set(paymentRows.map(payment => String(payment.userId)).filter(Boolean))];
    const objectIds = userIds.filter(mongoose.isValidObjectId).map(id => new mongoose.Types.ObjectId(id));
    const [users, historicalCalls] = await Promise.all([
      User.find({ _id: { $in: objectIds } }).select("fullName email phone phoneNumber").lean(),
      mongoose.connection.collection("calls").find({
        $or: [
          { callerId: { $in: objectIds } },
          { receiverId: { $in: objectIds } }
        ]
      }).project({ callerId: 1, callerName: 1, receiverId: 1, receiverName: 1 }).sort({ createdAt: -1 }).toArray()
    ]);

    const identityById = new Map(users.map(user => [String(user._id), user]));
    for (const call of historicalCalls) {
      const pairs = [[call.callerId, call.callerName], [call.receiverId, call.receiverName]];
      for (const [id, name] of pairs) {
        const key = String(id || "");
        if (key && name && !identityById.has(key)) {
          identityById.set(key, { _id: id, fullName: name, email: "", phone: "", isArchived: true });
        }
      }
    }

    const payments = paymentRows.map(payment => ({
      ...payment,
      userId: identityById.get(String(payment.userId)) || {
        _id: payment.userId,
        fullName: `User ${String(payment.userId || "").slice(-6)}`,
        email: "",
        phone: "",
        isArchived: true
      }
    }));

    res.json({
      success: true,
      data: payments,
      pagination: { total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) }
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

    const [byStatus, monthly] = await Promise.all([
      Transaction.aggregate([
        { $match: walletPaymentFilter },
        { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$amount" } } }
      ]),
      Transaction.aggregate([
        { $match: { ...walletPaymentFilter, status: "completed", createdAt: { $gte: startOfMonth } } },
        { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } }
      ])
    ]);

    const completed = byStatus.find(row => row._id === "completed") || { count: 0, amount: 0 };
    const pending = byStatus.find(row => row._id === "pending") || { count: 0, amount: 0 };
    const failed = byStatus.find(row => row._id === "failed") || { count: 0, amount: 0 };

    res.json({
      success: true,
      data: {
        totalPayments: byStatus.reduce((sum, row) => sum + row.count, 0),
        completedCount: completed.count,
        completedAmount: completed.amount,
        pendingCount: pending.count,
        pendingAmount: pending.amount,
        failedCount: failed.count,
        failedAmount: failed.amount,
        thisMonthAmount: monthly[0]?.amount || 0,
        thisMonthCount: monthly[0]?.count || 0
      }
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

    if (transaction.metadata?.walletCreditStatus === "credited") {
      const user = await User.findById(transaction.userId).select("walletBalance");
      return res.json({
        success: true,
        message: "Payment is already credited; no balance change was made",
        data: transaction,
        balance: Number(user?.walletBalance || 0),
        alreadyCredited: true
      });
    }

    // Historical completed rows predate the idempotency ledger. Automatically
    // re-crediting them could duplicate real money, so they require a separate
    // audited migration/manual investigation.
    if (transaction.status === "completed" && !transaction.metadata?.walletCreditStatus) {
      return res.status(409).json({
        success: false,
        message: "Legacy completed payment cannot be auto-credited safely. Verify the user's statement before manual recovery."
      });
    }

    const paymentId = String(req.body.paymentId || transaction.razorpayPaymentId || "").trim();
    const payment = await getCapturedGatewayPayment(transaction, paymentId);
    if (!payment || (payment.status !== "captured" && payment.captured !== true)) {
      return res.status(409).json({
        success: false,
        message: "Razorpay does not show a captured payment for this order"
      });
    }
    if (Number(payment.amount) !== Math.round(Number(transaction.amount) * 100)) {
      return res.status(409).json({ success: false, message: "Gateway amount does not match this order" });
    }
    if (
      String(payment.currency || "").toUpperCase() !==
      String(transaction.currency || "INR").toUpperCase()
    ) {
      return res.status(409).json({ success: false, message: "Gateway currency does not match this order" });
    }

    const walletUpdate = await User.updateOne(
      {
        _id: transaction.userId,
        walletCreditPaymentIds: { $ne: payment.id }
      },
      {
        $inc: { walletBalance: Number(transaction.amount) },
        $addToSet: { walletCreditPaymentIds: payment.id }
      }
    );
    const userExists = walletUpdate.modifiedCount > 0 ||
      await User.exists({ _id: transaction.userId });
    if (!userExists) {
      return res.status(404).json({ success: false, message: "Payment user not found" });
    }

    transaction.razorpayPaymentId = payment.id;
    transaction.status = "completed";
    transaction.metadata = {
      ...(transaction.metadata || {}),
      walletCreditStatus: "credited",
      walletCreditedAt: transaction.metadata?.walletCreditedAt || new Date(),
      walletCreditSource: "admin_recovery",
      gatewayStatus: payment.status,
      gatewayCaptured: payment.captured,
      recoveredBy: req.user?.email || "admin",
      recoveryReason: String(req.body.reason || "Payment captured but wallet credit missing").slice(0, 500)
    };
    await transaction.save();

    const user = await User.findById(transaction.userId).select("walletBalance");
    return res.json({
      success: true,
      message: walletUpdate.modifiedCount > 0
        ? "Razorpay payment verified and wallet credited"
        : "Payment was already credited; transaction record was reconciled",
      data: transaction,
      balance: Number(user?.walletBalance || 0),
      alreadyCredited: walletUpdate.modifiedCount === 0
    });
  } catch (err) {
    console.error("Admin wallet recovery failed:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Wallet recovery failed"
    });
  }
};
