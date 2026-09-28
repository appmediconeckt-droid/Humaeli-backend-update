import mongoose from "../../persistence/mongoose.js";

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, required: true }, // e.g., "platform_commission", "session_duration"
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    description: { type: String },
    type: { type: String, enum: ["NUMBER", "STRING", "BOOLEAN", "JSON"], default: "STRING" },
    category: { type: String, enum: ["PAYMENT", "SESSION", "USER", "EMAIL", "GENERAL"], default: "GENERAL" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

const Settings = mongoose.model("Settings", settingsSchema);
export default Settings;
