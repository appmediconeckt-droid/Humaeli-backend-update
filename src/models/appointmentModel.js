// mindCrawller/src/models/appointmentModel.js
import mongoose from "../persistence/mongoose.js";

const appointmentSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    counselor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    date: {
      type: Date,
      required: true,
      validate: {
        // Protect every creation path, not only the HTTP controller. Existing
        // appointments can still be updated after their scheduled time.
        validator(value) {
          return !this.isNew || value.getTime() > Date.now();
        },
        message: "Appointment date and time must be in the future",
      },
    },
    // optional extra fields
    notes: { type: String },
    status: {
      type: String,
      enum: ["pending", "confirmed", "canceled", "rejected"],
      default: "pending",
    },
  },
  { timestamps: true },
);

export default mongoose.model("Appointment", appointmentSchema);
