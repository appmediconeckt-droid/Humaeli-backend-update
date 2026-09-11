import mongoose from "../persistence/mongoose.js";

const registrationOtpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    otp: {
      type: String,
      required: true,
    },
    purpose: {
      type: String,
      enum: ["registration_email"],
      default: "registration_email",
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  { timestamps: true },
);

registrationOtpSchema.index({ email: 1, otp: 1, purpose: 1, expiresAt: 1 });

const RegistrationOTP =
  mongoose.models.RegistrationOTP ||
  mongoose.model("RegistrationOTP", registrationOtpSchema);

export default RegistrationOTP;
