import mongoose from "../../persistence/mongoose.js";

const reviewSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    counselorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    counselor: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    // The customer application stores these documents through its Rating
    // model, whose persisted field is `stars`.
    stars: { type: Number, min: 1, max: 5, required: true },
    rating: { type: Number, min: 1, max: 5 },
    review: { type: String, default: "" },
    comment: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved",
      index: true,
    },
  },
  { timestamps: true, collection: "ratings", strict: false }
);

const Review = mongoose.model("Review", reviewSchema);
export default Review;
