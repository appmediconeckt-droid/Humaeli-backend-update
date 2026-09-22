import Rating from "../models/Rating.js";
import User from "../models/userModel.js";
import RatingStatus from "../models/RatingStatus.js";
import {

  refreshUserRatingEligibility,
  getPromptableStatus,
  REMIND_LATER_MS,
} from "../services/ratingEligibilityService.js";

const isValidId = (id) => id != null && String(id).length >= 12;

// Recompute and persist a counselor's aggregate rating + count from the Rating
// collection. Kept in one place so submit/delete stay consistent.
const recomputeCounselorRating = async (counselorId) => {
  const result = await Rating.aggregate([
    { $match: { counselorId: counselorId } },
    {
      $group: {
        _id: "$counselorId",
        avg: { $avg: "$stars" },
        count: { $sum: 1 },
      },
    },
  ]);

  const avg = result[0]?.avg || 0;
  const count = result[0]?.count || 0;
  // Round the average to one decimal place for clean display (e.g. 4.6).
  const rating = Math.round(avg * 10) / 10;

  await User.findByIdAndUpdate(counselorId, { rating, ratingCount: count });
  return { rating, ratingCount: count };
};

/**
 * POST /api/counselors/:counselorId/ratings
 * Body: { stars: 1-5, comment?: string, chatId?: string }
 * Only users can rate. Re-rating the same chat session updates the existing one.
 */
export const submitRating = async (req, res) => {
  try {
    if (req.user.role !== "user") {
      return res.status(403).json({ error: "Only users can rate counselors" });
    }

    const { counselorId } = req.params;
    const { stars, comment = "", chatId = null } = req.body;

    if (!isValidId(counselorId)) {
      return res.status(400).json({ error: "Invalid counselor id" });
    }

    const starsNum = Number(stars);
    if (!Number.isFinite(starsNum) || starsNum < 1 || starsNum > 5) {
      return res.status(400).json({ error: "stars must be between 1 and 5" });
    }

    const counselor = await User.findOne({
      _id: counselorId,
      role: "counsellor",
    });
    if (!counselor) {
      return res.status(404).json({ error: "Counselor not found" });
    }

    const cleanComment = String(comment || "").trim().slice(0, 500);

    if (chatId) {
      // Upsert so a session can be rated once and updated if re-submitted.
      await Rating.findOneAndUpdate(
        { userId: req.user._id, chatId },
        {
          $set: {
            counselorId,
            stars: starsNum,
            comment: cleanComment,
          },
        },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
      );
    } else {
      // No chatId — just record the rating.
      await Rating.create({
        counselorId,
        userId: req.user._id,
        stars: starsNum,
        comment: cleanComment,
      });
    }

    const aggregate = await recomputeCounselorRating(counselorId);
    return res.json(aggregate); // { rating, ratingCount }
  } catch (error) {
    // Duplicate-key (race on the unique index) → treat as already rated.
    if (error?.code === 11000) {
      try {
        const aggregate = await recomputeCounselorRating(req.params.counselorId);
        return res.json(aggregate);
      } catch (_) {
        /* fall through */
      }
    }
    console.error("Error submitting rating:", error);
    return res.status(500).json({ error: "Error submitting rating" });
  }
};

/**
 * GET /api/counselors/:counselorId/ratings
 * Public-ish list of recent reviews for a counselor (most recent first).
 */
export const getCounselorRatings = async (req, res) => {
  try {
    const { counselorId } = req.params;
    if (!isValidId(counselorId)) {
      return res.status(400).json({ error: "Invalid counselor id" });
    }

    const ratings = await Rating.find({ counselorId })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("userId", "fullName profilePhoto")
      .lean();

    return res.json({ ratings });
  } catch (error) {
    console.error("Error fetching ratings:", error);
    return res.status(500).json({ error: "Error fetching ratings" });
  }
};

// ─── New eligibility-driven rating API (/api/ratings, /api/counselors/:id/rating)
// These enforce the full business rules server-side. Frontend validation alone
// is never trusted.

/**
 * POST /api/ratings/submit
 * Body: { counselorId, rating, review? }
 * Enforces: only users; counselor must exist; the pair must be eligible (had a
 * qualifying interaction); one rating per (user, counselor).
 */
export const submitRatingV2 = async (req, res) => {
  try {
    if (req.user.role !== "user") {
      return res.status(403).json({ error: "Only users can rate counselors" });
    }

    const { counselorId, rating, review = "", sessionId = null } = req.body;

    if (!isValidId(counselorId)) {
      return res.status(400).json({ error: "Invalid counselor id" });
    }

    const starsNum = Number(rating);
    if (!Number.isFinite(starsNum) || starsNum < 1 || starsNum > 5) {
      return res.status(400).json({ error: "rating must be between 1 and 5" });
    }

    const counselor = await User.findOne({ _id: counselorId, role: "counsellor" });
    if (!counselor) {
      return res.status(404).json({ error: "Counselor not found" });
    }

    // Enforce: cannot rate a counselor with no eligible interaction. Refresh
    // first so a freshly-eligible pair is reflected.
    await refreshUserRatingEligibility(req.user._id);
    const status = await RatingStatus.findOne({
      userId: req.user._id,
      counselorId,
    });
    if (!status || !status.eligibleAt) {
      return res
        .status(403)
        .json({ error: "Not eligible to rate this counselor yet" });
    }

    // Enforce: one rating per (user, counselor).
    const existing = await Rating.findOne({
      userId: req.user._id,
      counselorId,
    });
    if (existing || status.hasRated) {
      return res
        .status(409)
        .json({ error: "You have already rated this counselor" });
    }

    const cleanReview = String(review || "").trim().slice(0, 500);

    await Rating.create({
      counselorId,
      userId: req.user._id,
      stars: starsNum,
      comment: cleanReview,
      sessionId: sessionId || null,
    });

    // Mark the pair as rated so the popup never shows again.
    await RatingStatus.findOneAndUpdate(
      { userId: req.user._id, counselorId },
      { $set: { hasRated: true, remindLaterUntil: null } }
    );

    const aggregate = await recomputeCounselorRating(counselorId);
    return res.json({
      success: true,
      averageRating: aggregate.rating,
      totalRatings: aggregate.ratingCount,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res
        .status(409)
        .json({ error: "You have already rated this counselor" });
    }
    console.error("Error submitting rating:", error);
    return res.status(500).json({ error: "Error submitting rating" });
  }
};

/**
 * GET /api/ratings/check-eligibility
 * Returns the next counselor the user should be prompted to rate (if any).
 */
export const checkEligibility = async (req, res) => {
  try {
    if (req.user.role !== "user") {
      return res.json({ showPopup: false });
    }

    await refreshUserRatingEligibility(req.user._id);
    const status = await getPromptableStatus(req.user._id);

    if (!status) {
      return res.json({ showPopup: false });
    }

    const counselor = status.counselorId || {};
    const counselorPhoto =
      typeof counselor.profilePhoto === "string"
        ? counselor.profilePhoto
        : counselor.profilePhoto?.url ||
          counselor.profilePhoto?.secure_url ||
          null;

    return res.json({
      showPopup: true,
      counselorId: counselor._id || status.counselorId,
      counselorName: counselor.fullName || "your counselor",
      counselorPhoto,
      eligibleReason: status.eligibleReason,
      daysRemaining: 0,
    });
  } catch (error) {
    console.error("Error checking rating eligibility:", error);
    return res.status(500).json({ error: "Error checking eligibility" });
  }
};

/**
 * POST /api/ratings/remind-later
 * Body: { counselorId } — suppress the popup for 7 days.
 */
export const remindLater = async (req, res) => {
  try {
    const { counselorId } = req.body;
    if (!isValidId(counselorId)) {
      return res.status(400).json({ error: "Invalid counselor id" });
    }

    await RatingStatus.findOneAndUpdate(
      { userId: req.user._id, counselorId },
      { $set: { remindLaterUntil: new Date(Date.now() + REMIND_LATER_MS) } },
      { upsert: true }
    );

    return res.json({ success: true });
  } catch (error) {
    console.error("Error setting remind-later:", error);
    return res.status(500).json({ error: "Error updating reminder" });
  }
};

/**
 * POST /api/ratings/never-ask-again
 * Body: { counselorId } — permanently suppress the popup for this pair.
 */
export const neverAskAgain = async (req, res) => {
  try {
    const { counselorId } = req.body;
    if (!isValidId(counselorId)) {
      return res.status(400).json({ error: "Invalid counselor id" });
    }

    await RatingStatus.findOneAndUpdate(
      { userId: req.user._id, counselorId },
      { $set: { neverAskAgain: true, remindLaterUntil: null } },
      { upsert: true }
    );

    return res.json({ success: true });
  } catch (error) {
    console.error("Error setting never-ask-again:", error);
    return res.status(500).json({ error: "Error updating preference" });
  }
};

/**
 * GET /api/counselors/:counselorId/rating
 * Public aggregate rating for display on profiles.
 */
export const getCounselorRatingSummary = async (req, res) => {
  try {
    const { counselorId } = req.params;
    if (!isValidId(counselorId)) {
      return res.status(400).json({ error: "Invalid counselor id" });
    }

    const counselor = await User.findById(counselorId)
      .select("rating ratingCount")
      .lean();
    if (!counselor) {
      return res.status(404).json({ error: "Counselor not found" });
    }

    return res.json({
      averageRating: Math.round((counselor.rating || 0) * 10) / 10,
      totalRatings: counselor.ratingCount || 0,
    });
  } catch (error) {
    console.error("Error fetching counselor rating:", error);
    return res.status(500).json({ error: "Error fetching rating" });
  }
};
