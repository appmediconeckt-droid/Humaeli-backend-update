import mongoose from "../persistence/mongoose.js";

// One rating a user leaves for a counselor after a session. A user can rate a
// given chat session only once — enforced by the unique (userId, chatId) index.
const ratingSchema = new mongoose.Schema(
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
    },
    chatId: {
      type: String,
      default: null,
    },
    // Optional reference to the interaction (chat or call) that earned the rating.
    sessionId: {
      type: String,
      default: null,
    },
    stars: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      default: "",
      maxlength: 500,
    },
  },
  { timestamps: true }
);

// Prevent duplicate ratings for the same session. `sparse` so ratings without a
// chatId (edge cases) don't all collide on null.
ratingSchema.index({ userId: 1, chatId: 1 }, { unique: true, sparse: true });

const Rating = mongoose.model("Rating", ratingSchema);
export default Rating;
