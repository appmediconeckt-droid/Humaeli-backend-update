import mongoose from "mongoose";

const medicineSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 200 },
  dosage: { type: String, required: true, trim: true, maxlength: 120 },
  timeOfDay: [{ type: String, enum: ["Morning", "Afternoon", "Evening", "Night"] }],
  timing: { type: String, required: true, trim: true, maxlength: 240 },
  duration: { type: String, trim: true, maxlength: 120, default: "" },
}, { _id: false });

const prescriptionSchema = new mongoose.Schema({
  chatId: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", required: true, index: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  psychiatristId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  patientSnapshot: {
    name: { type: String, required: true },
    photo: { type: String, default: "" },
  },
  patientPhoto: {
    data: { type: Buffer, select: false },
    mimeType: { type: String, default: "" },
    name: { type: String, default: "" },
  },
  identityVerification: {
    status: { type: String, enum: ["photo_required", "pending", "verified", "rejected"], default: "photo_required", index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: "", maxlength: 500 },
  },
  psychiatristSnapshot: {
    name: { type: String, required: true },
    qualification: { type: String, default: "" },
    specialization: [{ type: String }],
    prescriptionSignature: { type: String, default: "" },
    prescriptionSeal: { type: String, default: "" },
  },
  problem: { type: String, required: true, trim: true, maxlength: 2000 },
  medicines: {
    type: [medicineSchema],
    required: true,
    validate: {
      validator: (items) => Array.isArray(items) && items.length > 0 && items.length <= 30,
      message: "Prescription must contain between 1 and 30 medicines",
    },
  },
  instructions: { type: String, trim: true, maxlength: 4000, default: "" },
  festivalTheme: { type: String, trim: true, default: "default_general", maxlength: 60 },
  pdf: {
    url: { type: String, default: "" },
    name: { type: String, required: true },
    mimeType: { type: String, default: "application/pdf" },
    size: { type: Number, default: null },
    data: { type: Buffer, required: true, select: false },
  },
  issuedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

prescriptionSchema.index({ patientId: 1, issuedAt: -1 });
prescriptionSchema.index({ psychiatristId: 1, issuedAt: -1 });

export default mongoose.model("Prescription", prescriptionSchema);
