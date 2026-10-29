import mongoose from "../persistence/mongoose.js";

const appointmentSchema = new mongoose.Schema(
  {
    payment_method: { type: String },
    payment_status: { type: String, default: 'pending' },
    payment_amount: { type: Number },
    payment_reference: { type: String },
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
        validator(value) {
          return !this.isNew ||
            (this.priority === "emergency" && !this.appointment_time) ||
            value.getTime() > Date.now();
        },
        message: "Appointment date and time must be in the future",
      },
    },

    notes: {
      type: String,
    },
    follow_up_synced: { type: Boolean, default: false },

    doctorRating: {
      type: new mongoose.Schema({
        stars: { type: Number, required: true, min: 1, max: 5 },
        review: { type: String, default: "", maxlength: 500 },
        submittedAt: { type: Date, required: true },
      }, { _id: false }),
      default: undefined,
    },

    clinicRating: {
      type: new mongoose.Schema({
        stars: { type: Number, required: true, min: 1, max: 5 },
        review: { type: String, default: "", maxlength: 500 },
        submittedAt: { type: Date, required: true },
      }, { _id: false }),
      default: undefined,
    },

    clinic_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
    },

    appointment_date: {
      type: String,
    },

    appointment_time: {
      type: String,
    },

    token_number: {
      type: Number,
    },

    slot_key: {
      type: String,
    },

    booking_source: {
      type: String,
      enum: ["qr", "direct"],
      default: "direct",
    },

    symptoms: {
      type: String,
    },

    diagnosis: {
      type: String,
    },

    advice: {
      type: String,
    },

    patient_location: {
      type: String,
    },

    consultation_mode: {
      type: String,
    },

    checked_in_at: {
      type: Date,
    },
    cancellation_reason: { type: String },
    cancellation_deadline: { type: Date },
    canceled_at: { type: Date },

    vitals: {
      type: mongoose.Schema.Types.Mixed,
    },

    // Appointment lifecycle (booking/approval)
    status: {
      type: String,
      enum: [
        "awaiting_payment",
        "pending",
        "confirmed",
        "canceled",
        "rejected",
        "completed",
      ],
      default: "pending",
    },

    // Live hospital/clinic queue lifecycle.
    queue_status: {
      type: String,
      enum: [
        "awaiting_payment",
        "booked",
        "waiting",
        "called",
        "in_progress",
        "completed",
        "skipped",
        "no_show",
        "canceled",
      ],
      default: "booked",
      index: true,
    },

    // Emergency patients are ordered ahead of normal waiting patients.
    priority: {
      type: String,
      enum: ["normal", "urgent", "emergency"],
      default: "normal",
      index: true,
    },

    emergency_reason: {
      type: String,
    },

    called_at: {
      type: Date,
    },

    consultation_started_at: {
      type: Date,
    },

    consultation_ended_at: {
      type: Date,
    },

    consultation_timing: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  },
);

appointmentSchema.index(
  { slot_key: 1 },
  { unique: true, sparse: true },
);

// Queue/token lookups used by the patient token menu and doctor queue.
appointmentSchema.index({
  counselor: 1,
  appointment_date: 1,
  token_number: 1,
});

appointmentSchema.index({
  patient: 1,
  appointment_date: 1,
});

// Payment drafts are not appointments visible to lists, queues, dashboards or
// clinical actions. Only payment processing and slot allocation opt into them.
appointmentSchema.pre(/^(find|countDocuments)/, function () {
  if (!this.getOptions().includePaymentDrafts) {
    this.and([{ status: { $ne: 'awaiting_payment' } }]);
  }
});
appointmentSchema.pre('aggregate', function () {
  if (!this.options.includePaymentDrafts) {
    this.pipeline().unshift({ $match: { status: { $ne: 'awaiting_payment' } } });
  }
});

export default mongoose.model("Appointment", appointmentSchema);
