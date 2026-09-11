import mongoose from "mongoose";

const counselorOnlineSubscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    counselorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  { timestamps: true },
);

counselorOnlineSubscriptionSchema.index(
  { userId: 1, counselorId: 1 },
  { unique: true },
);

export default mongoose.model(
  "CounselorOnlineSubscription",
  counselorOnlineSubscriptionSchema,
);
