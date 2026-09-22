import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import Call from "../models/Call.js";
import User from "../models/userModel.js";
import RatingStatus from "../models/RatingStatus.js";

const isValidId = (id) => id != null && String(id).length >= 12;



// ─── Business rule constants ────────────────────────────────────────────────
export const MIN_CALL_SECONDS = 300; // 5 minutes
export const MIN_CHAT_MESSAGES = 20; // exchanged messages
export const ELIGIBLE_DELAY_MS = 48 * 60 * 60 * 1000; // wait 48h after interaction
export const REMIND_LATER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Recompute rating eligibility for every counselor a user has interacted with.
 *
 * A (user, counselor) pair becomes eligible when EITHER:
 *   - any call between them lasted >= 5 minutes, OR
 *   - they exchanged >= 20 chat messages.
 *
 * The popup is then scheduled for lastInteraction + 48h. We persist this on the
 * RatingStatus row WITHOUT touching user decisions (hasRated / neverAskAgain /
 * remindLaterUntil), so refreshing is always safe to call.
 */
export const refreshUserRatingEligibility = async (userId) => {
  if (!isValidId(userId)) return;
  const userObjectId = userId;

  // Accumulate per-counselor signals: { reason, lastInteractionAt }
  const eligible = new Map(); // counselorId(string) -> { reason, lastInteractionAt }

  const note = (counselorId, reason, when) => {
    if (!counselorId || !when) return;
    const key = String(counselorId);
    const ts = new Date(when).getTime();
    if (Number.isNaN(ts)) return;
    const prev = eligible.get(key);
    if (!prev || ts > prev.lastInteractionAt) {
      eligible.set(key, { reason, lastInteractionAt: ts });
    }
  };

  // ── Chat rule: >= 20 messages between the pair ────────────────────────────
  const chats = await Chat.find({ userId: userObjectId }).select("_id counselorId").lean();
  const chatsByCounselor = new Map(); // counselorId(string) -> [chat _id]
  for (const chat of chats) {
    if (!chat.counselorId) continue;
    const key = String(chat.counselorId);
    if (!chatsByCounselor.has(key)) chatsByCounselor.set(key, []);
    chatsByCounselor.get(key).push(chat._id);
  }

  for (const [counselorId, chatIds] of chatsByCounselor.entries()) {
    const messageCount = await Message.countDocuments({ chatId: { $in: chatIds } });
    if (messageCount >= MIN_CHAT_MESSAGES) {
      const lastMsg = await Message.findOne({ chatId: { $in: chatIds } })
        .sort({ createdAt: -1 })
        .select("createdAt")
        .lean();
      note(counselorId, "chat", lastMsg?.createdAt || Date.now());
    }
  }

  // ── Call rule: any call >= 5 minutes ──────────────────────────────────────
  const calls = await Call.find({
    $or: [{ callerId: userObjectId }, { receiverId: userObjectId }],
    duration: { $gte: MIN_CALL_SECONDS },
  })
    .select("callerId receiverId duration endedAt updatedAt")
    .lean();

  for (const call of calls) {
    // The counselor is whichever party isn't the user.
    const counselorId =
      String(call.callerId) === String(userObjectId) ? call.receiverId : call.callerId;
    note(counselorId, "call", call.endedAt || call.updatedAt || Date.now());
  }

  if (eligible.size === 0) return;

  // Keep only parties that are actually counsellors.
  const counselorIds = [...eligible.keys()];
  const counselors = await User.find({
    _id: { $in: counselorIds },
    role: "counsellor",
  })
    .select("_id")
    .lean();
  const validCounselorIds = new Set(counselors.map((c) => String(c._id)));

  // Upsert a RatingStatus row for each eligible pair.
  for (const [counselorId, signal] of eligible.entries()) {
    if (!validCounselorIds.has(counselorId)) continue;

    const eligibleAt = new Date(signal.lastInteractionAt + ELIGIBLE_DELAY_MS);
    const lastInteractionAt = new Date(signal.lastInteractionAt);

    await RatingStatus.findOneAndUpdate(
      { userId: userObjectId, counselorId },
      {
        // Only (re)schedule eligibility timing + reason. User decisions
        // (hasRated / neverAskAgain / remindLaterUntil) are preserved.
        $set: {
          eligibleAt,
          eligibleReason: signal.reason,
          lastInteractionAt,
        },
        $setOnInsert: {
          hasRated: false,
          neverAskAgain: false,
          remindLaterUntil: null,
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
  }
};

/**
 * Return the single RatingStatus row whose popup should be shown now, or null.
 * A row qualifies when:
 *   eligibleAt <= now AND !hasRated AND !neverAskAgain
 *   AND (remindLaterUntil is null or already passed)
 * Oldest-eligible first so the most overdue prompt wins.
 */
export const getPromptableStatus = async (userId) => {
  const now = new Date();
  return RatingStatus.findOne({
    userId,
    hasRated: false,
    neverAskAgain: false,
    eligibleAt: { $ne: null, $lte: now },
    $or: [{ remindLaterUntil: null }, { remindLaterUntil: { $lte: now } }],
  })
    .sort({ eligibleAt: 1 })
    .populate("counselorId", "fullName profilePhoto role")
    .lean();
};
