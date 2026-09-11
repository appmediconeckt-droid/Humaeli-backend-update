import mongoose from "../../persistence/mongoose.js";

const payoutSchema = new mongoose.Schema(
  {
    payoutId: {
      type: String,
      unique: true,
      required: true
    },
    counselorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    counselorName: {
      type: String,
      required: true
    },
    counselorEmail: {
      type: String,
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      default: "USD"
    },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"],
      default: "PENDING",
      index: true
    },
    paymentMethod: {
      type: String,
      enum: ["BANK_TRANSFER", "UPI", "PAYPAL", "STRIPE", "OTHER"],
      default: "BANK_TRANSFER"
    },
    bankDetails: {
      accountHolderName: String,
      accountNumber: String,
      bankName: String,
      ifscCode: String,
      upiId: String
    },
    transactionReference: String,
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin"
    },
    approvedAt: Date,
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin"
    },
    processedAt: Date,
    completedAt: Date,
    failureReason: String,
    notes: String,
    taxDocument: String,
    taxAmount: {
      type: Number,
      default: 0
    },
    netAmount: Number,
    metadata: mongoose.Schema.Types.Mixed,
    period: {
      startDate: Date,
      endDate: Date
    }
  },
  { timestamps: true }
);

// Auto-calculate netAmount
payoutSchema.pre("save", function() {
  if (this.taxAmount) {
    this.netAmount = this.amount - this.taxAmount;
  } else {
    this.netAmount = this.amount;
  }
});

// Index for common queries
payoutSchema.index({ counselorId: 1, createdAt: -1 });
payoutSchema.index({ status: 1, createdAt: -1 });
payoutSchema.index({ createdAt: -1 });

const Payout = mongoose.model("Payout", payoutSchema);
export default Payout;
