import Chat from "../models/Chat.js";
import ChatSession from "../models/ChatSession.js";
import CounselorEarning from "../models/CounselorEarning.js";
import Transaction from "../models/transactionModel.js";
import User from "../models/userModel.js";
import { createNotificationSafely } from "./notificationService.js";

const truthy = new Set(["1", "true", "yes", "on", "enabled"]);
const falsy = new Set(["0", "false", "no", "off", "disabled"]);
const pendingChatStops = new Map();

export const isPaidSessionsEnabled = () => {
  const configured = String(
    process.env.PAID_COUNSELOR_SESSIONS_ENABLED || "",
  ).toLowerCase();
  if (falsy.has(configured)) return false;
  return configured === "" || truthy.has(configured);
};

export const getPaidSessionConfig = () => ({
  enabled: isPaidSessionsEnabled(),
  billing: {
    chat: "per_minute",
    voice: "per_minute",
    video: "per_minute",
  },
  fees: {
    chat: Number(process.env.COUNSELOR_CHAT_FEE || 100),
    voice: Number(process.env.COUNSELOR_VOICE_FEE || 200),
    video: Number(process.env.COUNSELOR_VIDEO_FEE || 300),
  },
  durationMinutes: Number(process.env.COUNSELOR_SESSION_DURATION_MINUTES || 30),
  requestExpiryHours: Number(process.env.COUNSELOR_REQUEST_EXPIRY_HOURS || 24),
  commissionRate: Number(process.env.PLATFORM_COMMISSION_PERCENT || 20),
});

export const getSessionAmount = (sessionType = "chat") => {
  const { fees } = getPaidSessionConfig();
  return fees[sessionType] ?? fees.chat;
};

export const calculateCallCharge = ({
  durationSeconds,
  rate,
  rateDurationMinutes,
}) => {
  const packageMinutes = Number(rateDurationMinutes);
  const packageRate = Number(rate);
  if (packageMinutes <= 0 || packageRate < 0) return 0;
  const billedSeconds = Math.min(
    Math.max(0, Math.floor(Number(durationSeconds) || 0)),
    packageMinutes * 60,
  );
  return Number(
    ((billedSeconds / (packageMinutes * 60)) * packageRate).toFixed(2),
  );
};

export const getRequestExpiryDate = () => {
  const { requestExpiryHours } = getPaidSessionConfig();
  return new Date(Date.now() + requestExpiryHours * 60 * 60 * 1000);
};

const getSessionMetadata = (session) =>
  session?.metadata && typeof session.metadata === "object"
    ? { ...session.metadata }
    : {};

export const createPaidSessionHold = async ({
  userId,
  counselorId,
  chat,
  sessionType = "chat",
}) => {
  if (!isPaidSessionsEnabled()) {
    return null;
  }

  const amount = getSessionAmount(sessionType);
  // Chat and calls are usage-billed. The package price is only used for the
  // balance eligibility check and as the rate for the configured duration;
  // it must not be removed from the wallet before any usage occurs.
  if (["chat", "voice", "video"].includes(sessionType)) {
    const user = await User.findById(userId).select("walletBalance");
    if (!user) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    if (sessionType !== "chat" && (user.walletBalance || 0) < amount) {
      const error = new Error("Insufficient wallet balance");
      error.statusCode = 402;
      error.requiredAmount = amount;
      error.walletBalance = user.walletBalance || 0;
      throw error;
    }

    const session = await ChatSession.create({
      userId,
      counselorId,
      chatId: chat._id,
      sessionType,
      amount: 0,
      ratePerMinute: amount,
      rateDurationMinutes: getPaidSessionConfig().durationMinutes,
      commissionRate: getPaidSessionConfig().commissionRate,
      paymentStatus: "free",
      sessionStatus: "pending",
      metadata: {
        billingType: "per_minute",
        packageAmount: amount,
        packageDurationMinutes: getPaidSessionConfig().durationMinutes,
      },
      expiresAt: chat.expiresAt || getRequestExpiryDate(),
    });

    chat.amount = 0;
    chat.sessionType = sessionType;
    chat.paymentStatus = "free";
    chat.paidSessionId = session._id;
    await chat.save();

    return { session, amount: 0, walletBalance: user?.walletBalance || 0 };
  }
};

export const activatePaidSession = async (chat) => {
  if (!isPaidSessionsEnabled() || !chat?.paidSessionId) {
    return null;
  }

  const session = await ChatSession.findById(chat.paidSessionId);
  if (!session || session.sessionStatus !== "pending") {
    return session;
  }

  session.sessionStatus = "active";
  session.acceptedAt = new Date();
  session.startedAt = session.acceptedAt;
  await session.save();

  chat.paymentStatus = session.amount > 0 ? "paid" : "free";
  await chat.save();

  return session;
};

export const startTimedChatUsage = async (
  chat,
  { fromBillableActivity = false } = {},
) => {
  if (!isPaidSessionsEnabled() || !chat?.paidSessionId) return null;

  let session = await ChatSession.findById(chat.paidSessionId);
  if (!session || session.sessionType !== "chat" || session.sessionStatus !== "active") {
    return session;
  }
  const metadata = getSessionMetadata(session);
  if (!fromBillableActivity || !metadata.hasBillableActivity) {
    const user = await User.findById(session.userId).select("walletBalance");
    return {
      active: false,
      reason: "waiting_for_chat_activity",
      walletBalance: user?.walletBalance || 0,
    };
  }
  const stopKey = String(session._id);
  const pendingStop = pendingChatStops.get(stopKey);
  if (pendingStop) {
    clearTimeout(pendingStop.timer);
    pendingChatStops.delete(stopKey);
  }
  if (
    !pendingStop &&
    session.activeSegmentStartedAt &&
    session.lastBilledAt &&
    Date.now() - new Date(session.lastBilledAt).getTime() > 30_000
  ) {
    await stopTimedChatUsage(chat);
    session = await ChatSession.findById(chat.paidSessionId);
  }
  if (!session.activeSegmentStartedAt) {
    session.activeSegmentStartedAt = new Date();
    session.lastBilledAt = session.activeSegmentStartedAt;
    await session.save();
  }
  const user = await User.findById(session.userId).select("walletBalance");
  return {
    startedAt: session.activeSegmentStartedAt,
    rate: session.ratePerMinute || getSessionAmount("chat"),
    rateDurationMinutes: session.rateDurationMinutes || 30,
    walletBalance: user?.walletBalance || 0,
  };
};

export const touchTimedChatUsage = async (chat) => {
  if (!isPaidSessionsEnabled() || !chat?.paidSessionId) return null;
  const session = await ChatSession.findById(chat.paidSessionId);
  if (!session || session.sessionType !== "chat" || !session.activeSegmentStartedAt) {
    return session;
  }
  session.lastBilledAt = new Date();
  await session.save();
  return { active: true, lastSeenAt: session.lastBilledAt };
};

export const stopTimedChatUsage = async (chat, { endedAt = Date.now() } = {}) => {
  if (!isPaidSessionsEnabled() || !chat?.paidSessionId) return null;

  const session = await ChatSession.findById(chat.paidSessionId);
  if (!session || session.sessionType !== "chat") return session;
  if (!session.activeSegmentStartedAt) {
    const user = await User.findById(session.userId).select("walletBalance");
    return { session, charged: 0, walletBalance: user?.walletBalance || 0 };
  }

  const segmentStartedAt = new Date(session.activeSegmentStartedAt);
  const segmentUserMessageCount = Number(
    session.metadata?.billingSegmentUserMessageCount || 0,
  );
  const segmentCounselorMessageCount = Number(
    session.metadata?.billingSegmentCounselorMessageCount || 0,
  );
  // Clear first so repeated stop/unmount requests cannot charge the same segment.
  session.activeSegmentStartedAt = null;
  session.metadata = {
    ...(session.metadata || {}),
    billingSegmentUserMessageCount: 0,
    billingSegmentCounselorMessageCount: 0,
  };
  session.markModified("metadata");
  await session.save();

  // A charge represents an actively continued two-way conversation. A lone
  // user message, or any number of one-sided counselor messages, is free.
  if (segmentUserMessageCount < 2 || segmentCounselorMessageCount < 1) {
    const user = await User.findById(session.userId).select("walletBalance");
    return {
      session,
      charged: 0,
      walletBalance: user?.walletBalance || 0,
      reason: "no_confirmed_two_way_activity",
    };
  }

  const lastSeenAt = session.lastBilledAt
    ? new Date(session.lastBilledAt).getTime()
    : Date.now();
  // If a browser crashes without sending stop, its last presence heartbeat
  // prevents offline time from being billed.
  const requestedEndAt = new Date(endedAt).getTime();
  const effectiveEndAt = Math.min(requestedEndAt, lastSeenAt + 20_000);
  const elapsedSeconds = Math.max(
    1,
    Math.floor((effectiveEndAt - segmentStartedAt.getTime()) / 1000),
  );
  const rate = session.ratePerMinute || getSessionAmount("chat");
  const rateDurationMinutes = session.rateDurationMinutes || 30;
  const requestedAmount = Number(
    ((elapsedSeconds / (rateDurationMinutes * 60)) * rate).toFixed(2),
  );
  const user = await User.findById(session.userId);
  const available = Number(user?.walletBalance || 0);

  if (!user || available < requestedAmount) {
    const error = new Error("Insufficient wallet balance. Chat session has been stopped.");
    error.statusCode = 402;
    error.walletBalance = available;
    error.requiredAmount = requestedAmount;
    throw error;
  }

  const charge = requestedAmount;
  user.walletBalance = Number((available - charge).toFixed(2));
  await user.save();

  const counselor = await User.findById(session.counselorId).select("fullName");
  const durationMinutes = Number((elapsedSeconds / 60).toFixed(2));
  const transaction = await Transaction.create({
    userId: session.userId,
    counselorId: session.counselorId,
    chatId: session.chatId,
    sessionId: session._id,
    amount: charge,
    status: "completed",
    type: "debit",
    description: `Chat with ${counselor?.fullName || "Counselor"} (${durationMinutes} min)`,
    metadata: {
      sessionType: "chat",
      billedSeconds: elapsedSeconds,
      billedMinutes: durationMinutes,
      rate,
      rateDurationMinutes,
    },
  });

  session.billedSeconds = (session.billedSeconds || 0) + elapsedSeconds;
  session.billedMinutes = Number((session.billedSeconds / 60).toFixed(2));
  session.amount = Number(((session.amount || 0) + charge).toFixed(2));
  session.paymentStatus = "paid";
  session.lastBilledAt = new Date();
  await session.save();
  chat.amount = session.amount;
  chat.paymentStatus = "paid";
  await chat.save();

  const commissionRate = getPaidSessionConfig().commissionRate;
  const commission = Number((charge * commissionRate / 100).toFixed(2));
  const earningAmount = Number((charge - commission).toFixed(2));
  const existingEarning = await CounselorEarning.findOne({ sessionId: session._id });
  if (!existingEarning) {
    await CounselorEarning.create({
      counselorId: session.counselorId,
      userId: session.userId,
      sessionId: session._id,
      transactionId: transaction._id,
      chatId: session.chatId,
      sessionType: "chat",
      totalAmount: charge,
      commission,
      earningAmount,
      earningStatus: "completed",
      payoutStatus: "pending",
    });
    await User.findByIdAndUpdate(session.counselorId, {
      $inc: { walletBalance: earningAmount },
    });
  } else {
    existingEarning.totalAmount = Number(
      ((existingEarning.totalAmount || 0) + charge).toFixed(2),
    );
    existingEarning.commission = Number(
      ((existingEarning.commission || 0) + commission).toFixed(2),
    );
    existingEarning.earningAmount = Number(
      ((existingEarning.earningAmount || 0) + earningAmount).toFixed(2),
    );
    await existingEarning.save();
    await User.findByIdAndUpdate(session.counselorId, {
      $inc: { walletBalance: earningAmount },
    });
  }

  await Promise.all([
    createNotificationSafely({
      recipientId: session.userId,
      actorId: session.counselorId,
      type: "payment",
      title: "Chat payment deducted",
      message: `₹${charge.toFixed(2)} was deducted for ${durationMinutes} minutes of counselor chat.`,
      data: {
        transactionId: transaction._id,
        sessionId: session._id,
        sessionType: "chat",
        amount: charge,
        durationMinutes,
        balance: user.walletBalance,
      },
      actionUrl: "/wallet",
    }),
    createNotificationSafely({
      recipientId: session.counselorId,
      actorId: session.userId,
      type: "payment",
      title: "New chat earning",
      message: `You earned ₹${earningAmount.toFixed(2)} after ${commissionRate}% platform commission.`,
      data: {
        transactionId: transaction._id,
        sessionId: session._id,
        sessionType: "chat",
        grossAmount: charge,
        platformCommission: commission,
        earningAmount,
      },
      actionUrl: "/counselor/earnings",
    }),
  ]);

  return {
    session,
    charged: charge,
    segmentSeconds: elapsedSeconds,
    segmentMinutes: durationMinutes,
    billedMinutes: session.billedMinutes,
    walletBalance: user.walletBalance,
  };
};

export const requestTimedChatStop = async (chat) => {
  if (!isPaidSessionsEnabled() || !chat?.paidSessionId) return null;
  const session = await ChatSession.findById(chat.paidSessionId);
  if (!session || session.sessionType !== "chat" || !session.activeSegmentStartedAt) {
    return { scheduled: false };
  }

  const stopKey = String(session._id);
  const existing = pendingChatStops.get(stopKey);
  // A UI unmount/visibility stop must not move the billing end beyond the
  // last real message activity. New message activity calls start first, which
  // explicitly cancels this pending stop before scheduling a fresh one.
  if (existing) {
    return {
      scheduled: true,
      inactivitySeconds: existing.inactivitySeconds,
      requestedAt: existing.requestedAt,
    };
  }

  const requestedAt = new Date();
  const inactivitySeconds = Math.max(
    15,
    Number(process.env.CHAT_BILLING_INACTIVITY_SECONDS || 120),
  );
  const timer = setTimeout(async () => {
    pendingChatStops.delete(stopKey);
    try {
      const freshChat = await Chat.findById(chat._id);
      if (freshChat) {
        await stopTimedChatUsage(freshChat, { endedAt: requestedAt });
      }
    } catch (error) {
      console.error("Delayed chat billing stop failed:", error.message);
    }
  }, inactivitySeconds * 1000);
  timer.unref?.();
  pendingChatStops.set(stopKey, { timer, requestedAt, inactivitySeconds });

  return {
    scheduled: true,
    inactivitySeconds,
    requestedAt,
  };
};

export const recordTimedChatActivity = async (chat, { actorRole } = {}) => {
  if (!isPaidSessionsEnabled() || !chat?.paidSessionId) return null;
  const session = await ChatSession.findById(chat.paidSessionId);
  if (!session || session.sessionType !== "chat" || session.sessionStatus !== "active") {
    return session;
  }

  const normalizedRole = actorRole === "counsellor" ? "counsellor" : actorRole;
  const metadata = getSessionMetadata(session);
  if (!metadata.hasBillableActivity) {
    const now = new Date();
    metadata.hasBillableActivity = true;
    metadata.firstBillableMessageAt = now;
    session.metadata = metadata;
    await session.save();
  }

  if (normalizedRole === "counsellor") {
    if (!session.activeSegmentStartedAt) {
      return { active: false, billable: false };
    }
    await ChatSession.updateOne(
      { _id: session._id, activeSegmentStartedAt: { $ne: null } },
      { $inc: { "metadata.billingSegmentCounselorMessageCount": 1 } },
    );
    return { active: true, billable: false };
  }

  if (normalizedRole !== "user") return null;
  const started = await startTimedChatUsage(chat, { fromBillableActivity: true });
  if (!started?.startedAt) return started;
  await ChatSession.updateOne(
    { _id: chat.paidSessionId, activeSegmentStartedAt: { $ne: null } },
    { $inc: { "metadata.billingSegmentUserMessageCount": 1 } },
  );
  await touchTimedChatUsage(chat);
  return requestTimedChatStop(chat);
};

export const settleInactiveChatSessions = async () => {
  if (!isPaidSessionsEnabled()) return 0;
  const inactivitySeconds = Math.max(
    15,
    Number(process.env.CHAT_BILLING_INACTIVITY_SECONDS || 120),
  );
  const cutoff = new Date(Date.now() - inactivitySeconds * 1000);
  const inactiveSessions = await ChatSession.find({
    sessionType: "chat",
    sessionStatus: "active",
    activeSegmentStartedAt: { $ne: null },
    lastBilledAt: { $lte: cutoff },
  }).limit(100);

  let settled = 0;
  for (const session of inactiveSessions) {
    const stopKey = String(session._id);
    if (pendingChatStops.has(stopKey)) continue;
    const chat = await Chat.findById(session.chatId);
    if (!chat) continue;
    try {
      await stopTimedChatUsage(chat, { endedAt: session.lastBilledAt });
      settled += 1;
    } catch (error) {
      console.error(`Inactive chat settlement failed for ${session._id}:`, error.message);
    }
  }
  return settled;
};

export const refundPaidSession = async (chat, reason = "request_not_accepted") => {
  if (!isPaidSessionsEnabled() || !chat?.paidSessionId) {
    return null;
  }

  const session = await ChatSession.findById(chat.paidSessionId);
  if (!session || session.paymentStatus === "refunded") {
    return session;
  }

  if (!["pending", "active"].includes(session.sessionStatus)) {
    return session;
  }

  const refundAmount = Number(session.amount || 0);
  const user = await User.findById(session.userId);
  if (user) {
    if (refundAmount > 0) {
      user.walletBalance = Number(((user.walletBalance || 0) + refundAmount).toFixed(2));
      await user.save();
    }
  }

  const holdTransaction = session.paymentTransactionId
    ? await Transaction.findById(session.paymentTransactionId)
    : null;

  if (holdTransaction) {
    holdTransaction.status = "refunded";
    await holdTransaction.save();
  }

  if (refundAmount > 0) {
    await Transaction.create({
      userId: session.userId,
      counselorId: session.counselorId,
      chatId: session.chatId,
      sessionId: session._id,
      relatedTransactionId: holdTransaction?._id,
      amount: session.amount,
      status: "completed",
      type: "refund",
      description: `Refund for ${session.sessionType} session`,
      metadata: { reason },
    });
  }

  session.paymentStatus = refundAmount > 0 ? "refunded" : "free";
  session.sessionStatus = refundAmount > 0 ? "refunded" : "cancelled";
  session.refundReason = reason;
  session.endedAt = new Date();
  await session.save();

  chat.paymentStatus = refundAmount > 0 ? "refunded" : "free";
  chat.cancelledAt = chat.cancelledAt || new Date();
  await chat.save();

  return session;
};

export const chargeCallByDuration = async ({
  callId,
  userId,
  counselorId,
  sessionType,
  durationSeconds,
}) => {
  if (!isPaidSessionsEnabled()) return null;
  const callType = sessionType === "voice" ? "voice" : "video";
  const rate = getSessionAmount(callType);
  const rateDurationMinutes = getPaidSessionConfig().durationMinutes;
  const billedSeconds = Math.min(
    Math.max(0, Math.floor(Number(durationSeconds) || 0)),
    rateDurationMinutes * 60,
  );
  const amount = calculateCallCharge({ durationSeconds, rate, rateDurationMinutes });
  const existing = await Transaction.findOne({
    "metadata.callId": callId,
    type: "debit",
    status: "completed",
  });
  if (existing) {
    const user = await User.findById(userId).select("walletBalance");
    return { transaction: existing, amount: existing.amount, walletBalance: user?.walletBalance || 0 };
  }

  if (amount <= 0) {
    const user = await User.findById(userId).select("walletBalance");
    return { transaction: null, amount: 0, walletBalance: user?.walletBalance || 0 };
  }

  const [user, counselor] = await Promise.all([
    User.findById(userId),
    User.findById(counselorId).select("fullName"),
  ]);
  if (!user) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }
  if ((user.walletBalance || 0) < amount) {
    const error = new Error("Insufficient wallet balance");
    error.statusCode = 402;
    error.requiredAmount = amount;
    error.walletBalance = user.walletBalance || 0;
    throw error;
  }

  user.walletBalance = Number(((user.walletBalance || 0) - amount).toFixed(2));
  await user.save();
  const transaction = await Transaction.create({
    userId,
    counselorId,
    amount,
    status: "completed",
    type: "debit",
    description: `${callType === "voice" ? "Voice" : "Video"} call with ${counselor?.fullName || "Counselor"} (${Number((billedSeconds / 60).toFixed(2))} min)`,
    metadata: {
      callId,
      sessionType: callType,
      billingType: "per_minute",
      billedSeconds,
      billedMinutes: Number((billedSeconds / 60).toFixed(2)),
      rate,
      rateDurationMinutes,
    },
  });
  const earning = Number(
    (amount * (1 - getPaidSessionConfig().commissionRate / 100)).toFixed(2),
  );
  const commission = Number((amount - earning).toFixed(2));
  await CounselorEarning.findOneAndUpdate(
    { transactionId: transaction._id },
    {
      $setOnInsert: {
        counselorId,
        userId,
        // Keeps compatibility with the legacy unique sessionId index while
        // call earnings use transactionId as their durable identifier.
        sessionId: transaction._id,
        transactionId: transaction._id,
        callId,
        sessionType: callType,
        totalAmount: amount,
        commission,
        earningAmount: earning,
        earningStatus: "completed",
        payoutStatus: "pending",
      },
    },
    { upsert: true, new: true },
  );
  await User.findByIdAndUpdate(counselorId, {
    $inc: { walletBalance: earning, totalSessions: 1 },
  });
  await Promise.all([
    createNotificationSafely({
      recipientId: userId,
      actorId: counselorId,
      type: "payment",
      title: `${callType === "voice" ? "Voice" : "Video"} call payment deducted`,
      message: `₹${amount.toFixed(2)} was deducted from your wallet.`,
      data: { transactionId: transaction._id, callId, sessionType: callType, amount, billedSeconds },
      actionUrl: "/wallet",
    }),
    createNotificationSafely({
      recipientId: counselorId,
      actorId: userId,
      type: "payment",
      title: `New ${callType} call earning`,
      message: `You earned ₹${earning.toFixed(2)} after ${getPaidSessionConfig().commissionRate}% platform commission.`,
      data: {
        transactionId: transaction._id,
        callId,
        sessionType: callType,
        grossAmount: amount,
        platformCommission: commission,
        earningAmount: earning,
      },
      actionUrl: "/counselor/earnings",
    }),
  ]);
  return { transaction, amount, walletBalance: user.walletBalance };
};

export const completePaidSession = async (chat) => {
  if (!isPaidSessionsEnabled() || !chat?.paidSessionId) {
    return null;
  }

  let session = await ChatSession.findById(chat.paidSessionId);
  if (!session || session.sessionStatus === "completed") {
    return session;
  }

  if (session.paymentStatus === "refunded") {
    return session;
  }

  if (session.sessionType === "chat" && session.sessionStatus === "active") {
    try {
      await stopTimedChatUsage(chat);
    } catch (error) {
      if (error.statusCode !== 402) throw error;
    }
    session = await ChatSession.findById(chat.paidSessionId);
  }

  if (Number(session.amount || 0) <= 0) {
    session.sessionStatus = "completed";
    session.paymentStatus = "free";
    session.amount = 0;
    session.commissionAmount = 0;
    session.counselorEarning = 0;
    session.endedAt = new Date();
    await session.save();

    chat.paymentStatus = "free";
    chat.amount = 0;
    chat.status = chat.status === "closed" ? chat.status : "closed";
    chat.closedAt = chat.closedAt || new Date();
    chat.isActive = false;
    await chat.save();

    return session;
  }

  const commissionAmount = Number(
    ((session.amount * session.commissionRate) / 100).toFixed(2),
  );
  const counselorEarning = Number((session.amount - commissionAmount).toFixed(2));

  let earning = await CounselorEarning.findOne({ sessionId: session._id });
  if (!earning) {
    earning = await CounselorEarning.create({
      counselorId: session.counselorId,
      userId: session.userId,
      sessionId: session._id,
      chatId: session.chatId,
      sessionType: session.sessionType,
      totalAmount: session.amount,
      commission: commissionAmount,
      earningAmount: counselorEarning,
      earningStatus: "completed",
      payoutStatus: "pending",
    });

    await User.findByIdAndUpdate(session.counselorId, {
      $inc: { walletBalance: counselorEarning, totalSessions: 1 },
    });
  }

  session.sessionStatus = "completed";
  session.paymentStatus = "released";
  session.commissionAmount = commissionAmount;
  session.counselorEarning = counselorEarning;
  session.earningId = earning._id;
  session.endedAt = new Date();
  await session.save();

  chat.paymentStatus = "released";
  chat.status = chat.status === "closed" ? chat.status : "closed";
  chat.closedAt = chat.closedAt || new Date();
  chat.isActive = false;
  await chat.save();

  return session;
};

export const expirePendingPaidChatRequests = async () => {
  if (!isPaidSessionsEnabled()) {
    return 0;
  }

  const now = new Date();
  const expiredChats = await Chat.find({
    status: "pending",
    $or: [
      { paidSessionId: { $ne: null } },
      { paymentStatus: { $in: ["free", "hold"] } },
    ],
    expiresAt: { $lte: now },
    isActive: true,
  }).limit(100);

  for (const chat of expiredChats) {
    chat.status = "cancelled";
    chat.isActive = false;
    chat.cancelledAt = now;
    await refundPaidSession(chat, "request_expired_24h");
    await chat.save();
  }

  return expiredChats.length;
};
