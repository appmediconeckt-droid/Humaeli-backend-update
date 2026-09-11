import mongoose from "../persistence/mongoose.js";

/**
 * RatingStatus — tracks, per (counselor, user) pair, whether/when a rating
 * popup should be shown. This is the server-side source of truth for the
 * "ask once, 48h delay, remind-later, never-again" rules.
 *
 *   eligibleAt        when the popup becomes eligible to show
 *                     (lastEligibleInteraction + 48h). null = not yet eligible.
 *   eligibleReason    "call" | "chat" — what made the pair eligible.
 *   hasRated          true once the user submits a rating (popup never shows again)
 *   remindLaterUntil  if set, suppress the popup until this time (7 days)
 *   neverAskAgain     permanently suppress the popup for this pair
 */
const ratingStatusSchema = new mongoose.Schema(
  {
    counselorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    eligibleAt: {
      type: Date,
      default: null,
    },
    eligibleReason: {
      type: String,
      enum: ["call", "chat", null],
      default: null,
    },
    lastInteractionAt: {
      type: Date,
      default: null,
    },
    hasRated: {
      type: Boolean,
      default: false,
    },
    remindLaterUntil: {
      type: Date,
      default: null,
    },
    neverAskAgain: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// One status row per (user, counselor) pair.
ratingStatusSchema.index({ userId: 1, counselorId: 1 }, { unique: true });

const RatingStatus =
  mongoose.models.RatingStatus ||
  mongoose.model("RatingStatus", ratingStatusSchema);

export default RatingStatus;
