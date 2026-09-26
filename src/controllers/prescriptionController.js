import path from "node:path";
import { fileURLToPath } from "node:url";
import Prescription from "../models/mysql/PrescriptionModel.js";

const uploadsRoot = fileURLToPath(new URL("../../uploads/", import.meta.url));
export const formatPrescription = (record) => ({
  id: record.id || record._id,
  chatId: record.chatId,
  patient: { ...record.patientSnapshot, id: record.patientId },
  psychiatrist: { ...record.psychiatristSnapshot, id: record.psychiatristId },
  problem: record.problem || "",
  medicines: Array.isArray(record.medicines) ? record.medicines : [],
  instructions: record.instructions || "",
  festivalTheme: record.festivalTheme,
  issuedAt: record.issuedAt || record.createdAt,
  hasPatientPhoto: Boolean(record.patientPhoto?.data),
  verificationStatus: record.identityVerification?.status || "pending",
  rejectionReason: record.identityVerification?.rejectionReason || "",
});

export const getMyPrescriptions = async (req, res) => {
  try {
    const records = await Prescription.find({ patientId: req.user._id }).sort({ issuedAt: -1 });
    return res.json({ success: true, prescriptions: records.map(formatPrescription) });
  } catch (error) {
    console.error("Failed to load prescriptions:", error.message);
    return res.status(500).json({ success: false, error: "Unable to load prescriptions" });
  }
};

const ownedPrescription = async (req, res) => {
  const record = await Prescription.findById(req.params.id);
  const userId = String(req.user._id);
  if (!record || (String(record.patientId) !== userId && String(record.psychiatristId) !== userId)) {
    res.status(404).json({ error: "Prescription not found" });
    return null;
  }
  res.set("Cache-Control", "private, no-store");
  return record;
};

export const getPrescriptionPhoto = async (req, res) => {
  const record = await ownedPrescription(req, res);
  if (!record) return;
  const photo = record.patientPhoto;
  const data = photo?.data;
  // Support migrated MongoDB Extended JSON as well as new Buffer JSON.
  const bytes = data?.$binary?.base64 ? Buffer.from(data.$binary.base64, "base64")
    : typeof data?.$binary === "string" ? Buffer.from(data.$binary, "base64")
    : data?.type === "Buffer" && Array.isArray(data.data) ? Buffer.from(data.data)
    : typeof data === "string" ? Buffer.from(data, "base64") : null;
  if (!bytes?.length) return res.status(404).json({ error: "Patient photo not found" });
  const mime = ["image/jpeg", "image/png", "image/webp"].includes(photo.mimeType) ? photo.mimeType : "application/octet-stream";
  return res.type(mime).send(bytes);
};

export const uploadPrescriptionPhoto = async (req, res) => {
  const record = await ownedPrescription(req, res);
  if (!record) return;
  if (String(record.patientId) !== String(req.user._id)) return res.status(403).json({ error: "Only the patient can upload their photo" });
  if (!req.file) return res.status(400).json({ error: "Patient photo is required" });
  record.patientPhoto = { data: req.file.buffer, mimeType: req.file.mimetype, name: req.file.originalname };
  record.identityVerification = { status: "pending", rejectionReason: "", reviewedAt: null, reviewedBy: null };
  await record.save();
  return res.json({ success: true });
};

export const getPrescriptionFile = async (req, res) => {
  const record = await ownedPrescription(req, res);
  if (!record) return;
  const url = record.pdf?.url;
  if (!url) return res.status(404).json({ error: "Prescription PDF not found" });
  if (/^https:\/\//i.test(url)) return res.redirect(url);
  const relative = String(url).replace(/^\/?uploads[\\/]/, "");
  const target = path.resolve(uploadsRoot, relative);
  const withinUploads = path.relative(uploadsRoot, target);
  if (!withinUploads || withinUploads.startsWith("..") || path.isAbsolute(withinUploads)) {
    return res.status(404).json({ error: "Prescription PDF not found" });
  }
  return res.sendFile(target, (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: "Prescription PDF not found" });
  });
};
