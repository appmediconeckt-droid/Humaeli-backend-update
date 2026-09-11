import mongoose from "../persistence/mongoose.js";
import Chat from "../models/Chat.js";
import Prescription from "../models/Prescription.js";
import User from "../models/userModel.js";

const normalizeSpecializations = (user) => [
  user?.specialization,
  user?.specializations,
  user?.speciality,
  user?.specialty,
].flat(Infinity).filter(Boolean).map((value) => String(value));

const isPsychiatrist = (user) => /psychiatrist|psychiatry/i.test(normalizeSpecializations(user).join(" "));
const isCounselorRole = (role) => ["counsellor", "counselor"].includes(String(role || "").toLowerCase());
const PRESCRIPTION_THEMES = new Set([
  "default_general", "baisakhi", "christmas", "diwali", "dussehra", "eid",
  "ganesh_chaturthi", "holi", "independence_day", "janmashtami",
  "makar_sankranti", "navratri", "new_year", "raksha_bandhan", "republic_day",
]);

const findChat = async (identifier) => {
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    const chat = await Chat.findById(identifier);
    if (chat) return chat;
  }
  return Chat.findOne({ chatId: identifier });
};

const parseMedicines = (value) => {
  let medicines;
  try {
    medicines = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    const error = new Error("Medicines must be valid JSON");
    error.statusCode = 400;
    throw error;
  }
  if (!Array.isArray(medicines) || medicines.length < 1 || medicines.length > 30) {
    const error = new Error("Add between 1 and 30 medicines");
    error.statusCode = 400;
    throw error;
  }
  const allowedTimes = new Set(["Morning", "Afternoon", "Evening", "Night"]);
  return medicines.map((medicine, index) => {
    const normalized = {
      name: String(medicine.name || medicine.medicine || "").trim(),
      dosage: String(medicine.dosage || "").trim(),
      timeOfDay: Array.isArray(medicine.timeOfDay) ? [...new Set(medicine.timeOfDay)] : [],
      timing: String(medicine.timing || "").trim(),
      duration: String(medicine.duration || "").trim(),
    };
    if (!normalized.name || !normalized.dosage || !normalized.timing || !normalized.timeOfDay.length) {
      const error = new Error(`Medicine ${index + 1} is incomplete`);
      error.statusCode = 400;
      throw error;
    }
    if (normalized.timeOfDay.some((time) => !allowedTimes.has(time))) {
      const error = new Error(`Medicine ${index + 1} has an invalid time of day`);
      error.statusCode = 400;
      throw error;
    }
    return normalized;
  });
};

const getPhotoUrl = (user) => {
  const photo = user?.profilePhoto || user?.avatarUrl || user?.avatar;
  return typeof photo === "string" ? photo : photo?.url || photo?.secure_url || "";
};

const getImageUrl = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  return value.secure_url || value.url || value.path || value.uri || "";
};

const toResponse = (record) => ({
  id: record._id,
  problem: record.problem,
  medicines: record.medicines,
  instructions: record.instructions,
  festivalTheme: record.festivalTheme || "default_general",
  issuedAt: record.issuedAt,
  patient: { id: record.patientId, ...record.patientSnapshot },
  psychiatrist: { id: record.psychiatristId, ...record.psychiatristSnapshot },
  prescriptionSignatureUrl: record.psychiatristSnapshot?.prescriptionSignature || "",
  prescriptionSealUrl: record.psychiatristSnapshot?.prescriptionSeal || "",
  signatureUrl: record.psychiatristSnapshot?.prescriptionSignature || "",
  sealUrl: record.psychiatristSnapshot?.prescriptionSeal || "",
  fileName: record.pdf.name,
  fileUrl: record.pdf.url,
  fileSize: record.pdf.size,
  mimeType: record.pdf.mimeType,
  hasPatientPhoto: Boolean(record.patientPhoto?.mimeType),
  verificationStatus: record.identityVerification?.status || "photo_required",
  rejectionReason: record.identityVerification?.rejectionReason || "",
});

export const issuePrescription = async (req, res) => {
  try {
    if (req.user.role !== "counsellor") {
      return res.status(403).json({ success: false, error: "Only psychiatrists can issue prescriptions" });
    }
    const [chat, psychiatrist] = await Promise.all([
      findChat(req.params.chatId),
      User.findById(req.user._id).lean(),
    ]);
    if (!chat) return res.status(404).json({ success: false, error: "Consultation chat not found" });
    if (String(chat.counselorId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, error: "This consultation is not assigned to you" });
    }
    if (!isPsychiatrist(psychiatrist)) {
      return res.status(403).json({ success: false, error: "Prescription access is limited to psychiatrists" });
    }
    if (!req.file || String(req.file.mimetype).toLowerCase() !== "application/pdf") {
      return res.status(400).json({ success: false, error: "A generated PDF prescription is required" });
    }

    const problem = String(req.body.problem || "").trim();
    const instructions = String(req.body.instructions || "").trim();
    if (!problem) return res.status(400).json({ success: false, error: "Patient problem is required" });
    const medicines = parseMedicines(req.body.medicines);
    const patient = await User.findById(chat.userId).lean();
    if (!patient) return res.status(404).json({ success: false, error: "Patient not found" });
    const prescriptionSignature =
      getImageUrl(req.body.prescriptionSignatureUrl) ||
      getImageUrl(req.body.signatureUrl) ||
      getImageUrl(psychiatrist.prescriptionSignature) ||
      getImageUrl(psychiatrist.signature) ||
      getImageUrl(psychiatrist.signatureImage) ||
      getImageUrl(psychiatrist.doctorSignature);
    const prescriptionSeal =
      getImageUrl(req.body.prescriptionSealUrl) ||
      getImageUrl(req.body.sealUrl) ||
      getImageUrl(psychiatrist.prescriptionSeal) ||
      getImageUrl(psychiatrist.seal) ||
      getImageUrl(psychiatrist.stamp) ||
      getImageUrl(psychiatrist.clinicSeal);

    const record = await Prescription.create({
      chatId: chat._id,
      patientId: patient._id,
      psychiatristId: psychiatrist._id,
      patientSnapshot: {
        name: patient.fullName || patient.name || "Patient",
        photo: getPhotoUrl(patient),
      },
      psychiatristSnapshot: {
        name: psychiatrist.fullName || psychiatrist.name || "Psychiatrist",
        qualification: psychiatrist.qualification || "",
        specialization: normalizeSpecializations(psychiatrist),
        prescriptionSignature,
        prescriptionSeal,
      },
      problem,
      medicines,
      instructions,
      pdf: {
        url: "",
        name: req.file.originalname || "Prescription.pdf",
        mimeType: req.file.mimetype,
        size: req.file.size,
        data: req.file.buffer,
      },
    });

    return res.status(201).json({ success: true, prescription: toResponse(record) });
  } catch (error) {
    console.error("Issue prescription error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : "Unable to issue prescription",
    });
  }
};

export const getMyPrescriptions = async (req, res) => {
  try {
    if (req.user.role !== "user") {
      return res.status(403).json({ success: false, error: "This prescription list is available to patients only" });
    }
    const records = await Prescription.find({ patientId: req.user._id }).sort({ issuedAt: -1 }).lean();
    return res.json({ success: true, prescriptions: records.map(toResponse) });
  } catch (error) {
    console.error("Get prescriptions error:", error);
    return res.status(500).json({ success: false, error: "Unable to load prescriptions" });
  }
};

export const getPrescriptionFile = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, error: "Invalid prescription ID" });
    }
    const record = await Prescription.findById(req.params.id).select("+pdf.data").lean();
    if (!record) return res.status(404).json({ success: false, error: "Prescription not found" });

    const isPatient = req.user.role === "user" && String(record.patientId) === String(req.user._id);
    const isPsychiatrist = req.user.role === "counsellor" && String(record.psychiatristId) === String(req.user._id);
    if (!isPatient && !isPsychiatrist) {
      return res.status(403).json({ success: false, error: "You cannot access this prescription" });
    }
    if (isPatient && record.identityVerification?.status !== "verified") {
      return res.status(403).json({ success: false, error: "Your photo must be verified before the final PDF is available" });
    }

    let pdfBuffer = record.pdf?.data ? Buffer.from(record.pdf.data) : null;
    // Backward compatibility for prescriptions created before PDFs were
    // stored in MongoDB. New records never depend on Cloudinary delivery.
    if (!pdfBuffer?.length && record.pdf?.url) {
      const upstream = await fetch(record.pdf.url);
      if (upstream.ok) pdfBuffer = Buffer.from(await upstream.arrayBuffer());
    }
    if (!pdfBuffer?.length) {
      return res.status(404).json({ success: false, error: "This older prescription PDF is unavailable. Please ask the psychiatrist to issue it again." });
    }
    const safeName = String(record.pdf.name || "Prescription.pdf").replace(/[\r\n"]/g, "");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    return res.send(pdfBuffer);
  } catch (error) {
    console.error("Get prescription file error:", error);
    return res.status(500).json({ success: false, error: "Unable to load prescription PDF" });
  }
};

export const uploadPatientPhoto = async (req, res) => {
  try {
    if (req.user.role !== "user") {
      return res.status(403).json({ success: false, error: "Only the patient can upload this photo" });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: "Please select a patient photo" });
    }
    const record = await Prescription.findOneAndUpdate(
      { _id: req.params.id, patientId: req.user._id },
      { $set: {
        "patientPhoto.data": req.file.buffer,
        "patientPhoto.mimeType": req.file.mimetype,
        "patientPhoto.name": req.file.originalname || "patient-photo",
        "identityVerification.status": "pending",
        "identityVerification.reviewedBy": null,
        "identityVerification.reviewedAt": null,
        "identityVerification.rejectionReason": "",
      } },
      { new: true, runValidators: true },
    );
    if (!record) return res.status(404).json({ success: false, error: "Prescription not found" });
    return res.json({ success: true, hasPatientPhoto: true });
  } catch (error) {
    console.error("Upload prescription patient photo error:", error);
    return res.status(500).json({ success: false, error: "Unable to upload patient photo" });
  }
};

export const getPatientPhoto = async (req, res) => {
  try {
    const record = await Prescription.findById(req.params.id).select("+patientPhoto.data").lean();
    if (!record) return res.status(404).json({ success: false, error: "Prescription not found" });
    const allowed =
      (req.user.role === "user" && String(record.patientId) === String(req.user._id)) ||
      (isCounselorRole(req.user.role) && String(record.psychiatristId) === String(req.user._id));
    if (!allowed) return res.status(403).json({ success: false, error: "You cannot access this photo" });
    if (!record.patientPhoto?.data) return res.status(404).json({ success: false, error: "Patient photo not found" });
    const storedPhoto = record.patientPhoto.data;
    const photoBuffer = Buffer.isBuffer(storedPhoto)
      ? storedPhoto
      : Buffer.from(storedPhoto.buffer || storedPhoto.value?.() || storedPhoto);
    if (!photoBuffer.length) return res.status(404).json({ success: false, error: "Patient photo is empty" });
    res.setHeader("Content-Type", record.patientPhoto.mimeType || "image/jpeg");
    res.setHeader("Content-Length", photoBuffer.length);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    return res.send(photoBuffer);
  } catch (error) {
    console.error("Get prescription patient photo error:", error);
    return res.status(500).json({ success: false, error: "Unable to load patient photo" });
  }
};

export const getPrescriptionsForReview = async (req, res) => {
  try {
    if (!isCounselorRole(req.user.role)) return res.status(403).json({ success: false, error: "Counselor access required" });
    const psychiatrist = await User.findById(req.user._id).lean();
    if (!isPsychiatrist(psychiatrist)) return res.status(403).json({ success: false, error: "Psychiatrist access required" });
    const records = await Prescription.find({ psychiatristId: req.user._id })
      .select("+patientPhoto.mimeType +patientPhoto.name")
      .sort({ issuedAt: -1 })
      .lean();
    return res.json({ success: true, prescriptions: records.map(toResponse) });
  } catch {
    return res.status(500).json({ success: false, error: "Unable to load prescription reviews" });
  }
};

export const reviewPatientPhoto = async (req, res) => {
  try {
    if (!isCounselorRole(req.user.role)) return res.status(403).json({ success: false, error: "Counselor access required" });
    const action = String(req.body.action || "").toLowerCase();
    if (!["approve", "reject"].includes(action)) return res.status(400).json({ success: false, error: "Invalid review action" });
    const record = await Prescription.findOne({ _id: req.params.id, psychiatristId: req.user._id });
    if (!record) return res.status(404).json({ success: false, error: "Prescription not found" });
    if (!record.patientPhoto?.mimeType) return res.status(400).json({ success: false, error: "Patient photo has not been uploaded" });
    const reason = String(req.body.reason || "").trim();
    if (action === "reject" && !reason) return res.status(400).json({ success: false, error: "Rejection reason is required" });
    const psychiatrist = await User.findById(req.user._id).lean();
    const prescriptionSignature =
      getImageUrl(req.body.prescriptionSignatureUrl) ||
      getImageUrl(req.body.signatureUrl) ||
      getImageUrl(psychiatrist?.prescriptionSignature);
    const prescriptionSeal =
      getImageUrl(req.body.prescriptionSealUrl) ||
      getImageUrl(req.body.sealUrl) ||
      getImageUrl(psychiatrist?.prescriptionSeal);
    if (prescriptionSignature) record.psychiatristSnapshot.prescriptionSignature = prescriptionSignature;
    if (prescriptionSeal) record.psychiatristSnapshot.prescriptionSeal = prescriptionSeal;
    record.identityVerification = {
      status: action === "approve" ? "verified" : "rejected",
      reviewedBy: req.user._id,
      reviewedAt: new Date(),
      rejectionReason: action === "reject" ? reason : "",
    };
    await record.save();
    return res.json({
      success: true,
      verificationStatus: record.identityVerification.status,
      prescription: toResponse(record),
    });
  } catch {
    return res.status(500).json({ success: false, error: "Unable to review patient photo" });
  }
};

export const updatePrescriptionFestivalTheme = async (req, res) => {
  try {
    if (!isCounselorRole(req.user.role)) {
      return res.status(403).json({ success: false, error: "Psychiatrist access required" });
    }
    const festivalTheme = String(req.body.festivalTheme || "").trim().toLowerCase();
    if (!PRESCRIPTION_THEMES.has(festivalTheme)) {
      return res.status(400).json({ success: false, error: "Invalid prescription festival theme" });
    }
    const record = await Prescription.findOne({ _id: req.params.id, psychiatristId: req.user._id });
    if (!record) return res.status(404).json({ success: false, error: "Prescription not found" });
    const psychiatrist = await User.findById(req.user._id).lean();
    if (!isPsychiatrist(psychiatrist)) {
      return res.status(403).json({ success: false, error: "Psychiatrist access required" });
    }
    record.festivalTheme = festivalTheme;
    await record.save();
    return res.json({ success: true, festivalTheme });
  } catch (error) {
    console.error("Update prescription festival theme error:", error);
    return res.status(500).json({ success: false, error: "Unable to save prescription theme" });
  }
};
