import mongoose from "../../persistence/mongoose.js";
import AuditLog from "../models/AuditLog.js";
import CounselorEarning from "../models/CounselorEarning.js";
import Notification from "../models/Notification.js";
import SupportTicket from "../models/SupportTicket.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";

const roundMoney = value =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const getCallDispute = async ({ ticketId, callId }) => {
  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) {
    const error = new Error("Support ticket not found");
    error.statusCode = 404;
    throw error;
  }

  const normalizedCallId = String(callId || ticket.callDispute?.callId || "").trim();
  if (!normalizedCallId) {
    const error = new Error("Call ID is required");
    error.statusCode = 400;
    throw error;
  }

  const transaction = await Transaction.findOne({
    type: "debit",
    status: "completed",
    "metadata.callId": normalizedCallId,
  });
  if (!transaction) {
    const error = new Error("Completed call payment transaction not found");
    error.statusCode = 404;
    throw error;
  }

  const call = await mongoose.connection
    .collection("calls")
    .findOne({ callId: normalizedCallId });
  if (!call) {
    const error = new Error("Call record not found");
    error.statusCode = 404;
    throw error;
  }

  const durationSeconds = Math.max(
    0,
    Math.floor(
      Number(call.duration) ||
        (call.startedAt && call.endedAt
          ? (new Date(call.endedAt) - new Date(call.startedAt)) / 1000
          : 0),
    ),
  );
  const rate = Number(transaction.metadata?.rate);
  const rateDurationMinutes = Number(transaction.metadata?.rateDurationMinutes);
  if (!Number.isFinite(rate) || !Number.isFinite(rateDurationMinutes) || rateDurationMinutes <= 0) {
    const error = new Error("Original transaction does not contain valid call billing configuration");
    error.statusCode = 409;
    throw error;
  }

  const chargedAmount = roundMoney(transaction.amount);
  const correctAmount = roundMoney(
    (durationSeconds / (rateDurationMinutes * 60)) * rate,
  );
  const excessAmount = roundMoney(Math.max(0, chargedAmount - correctAmount));
  const earning = await CounselorEarning.findOne({
    $or: [{ transactionId: transaction._id }, { callId: normalizedCallId }],
  });
  if (!earning && excessAmount > 0) {
    const error = new Error("Counselor earning record is missing; automatic reversal is unsafe");
    error.statusCode = 409;
    throw error;
  }

  const counselorShare =
    earning && Number(earning.totalAmount) > 0
      ? Number(earning.earningAmount) / Number(earning.totalAmount)
      : 0;
  const adjustmentId = `call-excess:${transaction._id}`;
  const earningAlreadyAdjusted =
    earning?.metadata?.adjustmentId === adjustmentId;
  const counselorReversal = earningAlreadyAdjusted
    ? Number(earning.metadata.excessReversed || 0)
    : roundMoney(excessAmount * counselorShare);
  const platformReversal = roundMoney(excessAmount - counselorReversal);
  const priorRefund = await Transaction.findOne({ transactionId: adjustmentId });

  const [user, counselor] = await Promise.all([
    User.findById(transaction.userId).select("fullName email walletBalance"),
    User.findById(transaction.counselorId).select("fullName email walletBalance"),
  ]);

  return {
    ticket,
    transaction,
    call,
    earning,
    user,
    counselor,
    adjustmentId,
    priorRefund,
    durationSeconds,
    rate,
    rateDurationMinutes,
    chargedAmount,
    correctAmount,
    excessAmount,
    counselorReversal,
    platformReversal,
    counselorShare,
    earningAlreadyAdjusted,
  };
};

const publicInvestigation = dispute => ({
  callId: dispute.call.callId,
  callType: dispute.call.callType,
  callStatus: dispute.call.status,
  actualDurationSeconds: dispute.durationSeconds,
  billedDurationSeconds: Number(dispute.transaction.metadata?.billedSeconds || 0),
  rate: dispute.rate,
  rateDurationMinutes: dispute.rateDurationMinutes,
  chargedAmount: dispute.chargedAmount,
  correctAmount: dispute.correctAmount,
  excessAmount: dispute.excessAmount,
  counselorReversal: dispute.counselorReversal,
  platformReversal: dispute.platformReversal,
  transactionId: dispute.transaction._id,
  adjustmentId: dispute.adjustmentId,
  alreadyRefunded: Boolean(dispute.priorRefund),
  user: dispute.user
    ? {
        _id: dispute.user._id,
        fullName: dispute.user.fullName,
        email: dispute.user.email,
        walletBalance: dispute.user.walletBalance,
      }
    : null,
  counselor: dispute.counselor
    ? {
        _id: dispute.counselor._id,
        fullName: dispute.counselor.fullName,
        email: dispute.counselor.email,
        walletBalance: dispute.counselor.walletBalance,
      }
    : null,
  payoutStatus: dispute.earning?.payoutStatus || null,
});

export const investigateCallDispute = async (req, res) => {
  try {
    const dispute = await getCallDispute({
      ticketId: req.params.id,
      callId: req.body.callId,
    });
    dispute.ticket.callDispute = {
      ...(dispute.ticket.callDispute?.toObject?.() || dispute.ticket.callDispute || {}),
      callId: dispute.call.callId,
      transactionId: dispute.transaction._id,
      chargedAmount: dispute.chargedAmount,
      correctAmount: dispute.correctAmount,
      refundedAmount: dispute.priorRefund?.amount || 0,
      counselorReversal: dispute.counselorReversal,
      platformReversal: dispute.platformReversal,
      actualDurationSeconds: dispute.durationSeconds,
      status: dispute.priorRefund
        ? "REFUNDED"
        : dispute.excessAmount > 0
          ? "INVESTIGATED"
          : "NO_EXCESS",
      adjustmentId: dispute.adjustmentId,
      investigatedAt: new Date(),
    };
    await dispute.ticket.save();

    return res.json({
      success: true,
      data: publicInvestigation(dispute),
      ticket: dispute.ticket,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Call investigation failed",
    });
  }
};

export const refundCallDisputeExcess = async (req, res) => {
  try {
    const reason = String(req.body.reason || "").trim();
    if (reason.length < 10) {
      return res.status(400).json({
        success: false,
        message: "A clear refund reason of at least 10 characters is required",
      });
    }
    if (req.body.confirm !== true) {
      return res.status(400).json({
        success: false,
        message: "Explicit refund confirmation is required",
      });
    }

    const dispute = await getCallDispute({
      ticketId: req.params.id,
      callId: req.body.callId,
    });
    if (dispute.excessAmount <= 0 && !dispute.priorRefund) {
      return res.status(409).json({
        success: false,
        message: "No excess call charge was found",
      });
    }

    if (!dispute.priorRefund) {
      const userUpdate = await User.updateOne(
        {
          _id: dispute.transaction.userId,
          walletAdjustmentIds: { $ne: dispute.adjustmentId },
        },
        {
          $inc: { walletBalance: dispute.excessAmount },
          $addToSet: { walletAdjustmentIds: dispute.adjustmentId },
        },
      );
      if (userUpdate.modifiedCount === 0) {
        const exists = await User.exists({ _id: dispute.transaction.userId });
        if (!exists) throw new Error("Call user not found");
      }

      const counselorUpdate = await User.updateOne(
        {
          _id: dispute.transaction.counselorId,
          walletAdjustmentIds: { $ne: dispute.adjustmentId },
        },
        {
          $inc: { walletBalance: -dispute.counselorReversal },
          $addToSet: { walletAdjustmentIds: dispute.adjustmentId },
        },
      );
      if (counselorUpdate.modifiedCount === 0) {
        const exists = await User.exists({ _id: dispute.transaction.counselorId });
        if (!exists) throw new Error("Call counselor not found");
      }

      if (!dispute.earningAlreadyAdjusted) {
        const correctedEarning = roundMoney(
          Number(dispute.earning.earningAmount) - dispute.counselorReversal,
        );
        await CounselorEarning.updateOne(
          { _id: dispute.earning._id },
          {
            $set: {
              totalAmount: dispute.correctAmount,
              earningAmount: Math.max(0, correctedEarning),
              commission: Math.max(
                0,
                roundMoney(dispute.correctAmount - Math.max(0, correctedEarning)),
              ),
              earningStatus: correctedEarning <= 0 ? "reversed" : "completed",
              metadata: {
                ...(dispute.earning.metadata || {}),
                adjustmentId: dispute.adjustmentId,
                excessReversed: dispute.counselorReversal,
                adjustedAt: new Date(),
                supportTicketId: dispute.ticket._id,
              },
            },
          },
        );
      }

      try {
        dispute.priorRefund = await Transaction.create({
          transactionId: dispute.adjustmentId,
          userId: dispute.transaction.userId,
          counselorId: dispute.transaction.counselorId,
          amount: dispute.excessAmount,
          currency: dispute.transaction.currency || "INR",
          type: "refund",
          status: "completed",
          description: `Excess call charge refund for ${dispute.call.callId}`,
          relatedTransactionId: dispute.transaction._id,
          metadata: {
            callId: dispute.call.callId,
            supportTicketId: dispute.ticket._id,
            originalCharge: dispute.chargedAmount,
            correctCharge: dispute.correctAmount,
            actualDurationSeconds: dispute.durationSeconds,
            counselorReversal: dispute.counselorReversal,
            platformReversal: dispute.platformReversal,
            reason,
            processedBy: req.user?.email || "admin",
          },
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        dispute.priorRefund = await Transaction.findOne({
          transactionId: dispute.adjustmentId,
        });
      }

      await Transaction.updateOne(
        { _id: dispute.transaction._id },
        {
          $set: {
            "metadata.excessRefundStatus": "completed",
            "metadata.excessRefundAmount": dispute.excessAmount,
            "metadata.correctedCharge": dispute.correctAmount,
            "metadata.excessRefundTransactionId": dispute.priorRefund._id,
            "metadata.excessRefundAdjustmentId": dispute.adjustmentId,
            "metadata.excessRefundedAt": new Date(),
            "metadata.excessRefundedBy": req.user?.email || "admin",
            "metadata.supportTicketId": dispute.ticket._id,
          },
        },
      );

      await Promise.all([
        Notification.create({
          recipientId: dispute.transaction.userId,
          actorId: dispute.transaction.counselorId,
          type: "payment",
          title: "Excess call charge refunded",
          message: `INR ${dispute.excessAmount.toFixed(2)} was returned to your wallet after call billing review.`,
          data: {
            callId: dispute.call.callId,
            transactionId: dispute.priorRefund._id,
            amount: dispute.excessAmount,
          },
          actionUrl: "/wallet",
        }),
        Notification.create({
          recipientId: dispute.transaction.counselorId,
          actorId: dispute.transaction.userId,
          type: "payment",
          title: "Call earning adjusted",
          message: `INR ${dispute.counselorReversal.toFixed(2)} excess earning was reversed after call billing review.`,
          data: {
            callId: dispute.call.callId,
            amount: dispute.counselorReversal,
          },
          actionUrl: "/counselor/earnings",
        }),
      ]);
    }

    dispute.ticket.callDispute = {
      ...(dispute.ticket.callDispute?.toObject?.() || dispute.ticket.callDispute || {}),
      callId: dispute.call.callId,
      transactionId: dispute.transaction._id,
      chargedAmount: dispute.chargedAmount,
      correctAmount: dispute.correctAmount,
      refundedAmount: dispute.priorRefund.amount,
      counselorReversal: dispute.counselorReversal,
      platformReversal: dispute.platformReversal,
      actualDurationSeconds: dispute.durationSeconds,
      status: "REFUNDED",
      adjustmentId: dispute.adjustmentId,
      refundedAt: dispute.ticket.callDispute?.refundedAt || new Date(),
      resolvedBy: req.user?.email || "admin",
      reason,
    };
    dispute.ticket.status = "RESOLVED";
    dispute.ticket.resolvedAt = dispute.ticket.resolvedAt || new Date();
    dispute.ticket.unreadByAdmin = false;
    await dispute.ticket.save();

    await AuditLog.findOneAndUpdate(
      {
        action: "REFUND",
        entityType: "TRANSACTION",
        entityId: dispute.transaction._id,
        "changes.adjustmentId": dispute.adjustmentId,
      },
      {
        $setOnInsert: {
          adminEmail: req.user?.email || "admin",
          action: "REFUND",
          entityType: "TRANSACTION",
          entityId: dispute.transaction._id,
          entityName: dispute.call.callId,
          changes: {
            adjustmentId: dispute.adjustmentId,
            chargedAmount: dispute.chargedAmount,
            correctAmount: dispute.correctAmount,
            userRefund: dispute.priorRefund.amount,
            counselorReversal: dispute.counselorReversal,
            platformReversal: dispute.platformReversal,
            supportTicketId: dispute.ticket._id,
          },
          reason,
          ipAddress: req.ip,
          status: "SUCCESS",
          details: "Excess call billing refund and counselor earning reversal",
        },
      },
      { upsert: true, new: true },
    );

    const [user, counselor] = await Promise.all([
      User.findById(dispute.transaction.userId).select("walletBalance"),
      User.findById(dispute.transaction.counselorId).select("walletBalance"),
    ]);
    return res.json({
      success: true,
      message: "Excess charge refunded and counselor earning adjusted",
      data: {
        ...publicInvestigation(dispute),
        refundedAmount: dispute.priorRefund.amount,
        refundTransactionId: dispute.priorRefund._id,
        userWalletBalance: Number(user?.walletBalance || 0),
        counselorWalletBalance: Number(counselor?.walletBalance || 0),
      },
      ticket: dispute.ticket,
    });
  } catch (error) {
    console.error("Call dispute refund failed:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Call dispute refund failed",
    });
  }
};
