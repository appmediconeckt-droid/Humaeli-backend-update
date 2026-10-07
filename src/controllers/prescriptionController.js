import mongoose from "../persistence/mongoose.js";
import Chat from "../models/Chat.js";
import Appointment from "../models/appointmentModel.js";
import Prescription from "../models/Prescription.js";
import User from "../models/userModel.js";
import { FollowUp } from "../models/clinicModels.js";

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

const bufferFromStoredBinary = (value) => {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value.$binary?.base64) return Buffer.from(value.$binary.base64, "base64");
  if (value.buffer) return Buffer.from(value.buffer);
  if (typeof value.value === "function") return Buffer.from(value.value());
  return Buffer.from(value);
};

const recordId = (record) => String(record?._id || record?.id || "");
const idValue = (value) => String(value?._id || value?.id || value || "");

const toResponse = (record) => ({
  id: recordId(record),
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
  fileName: record.pdf?.name || "",
  fileUrl: record.pdf?.url || "",
  fileSize: record.pdf?.size || null,
  mimeType: record.pdf?.mimeType || "",
  hasPatientPhoto: Boolean(record.patientPhoto?.mimeType),
  verificationStatus: record.identityVerification?.status || "photo_required",
  rejectionReason: record.identityVerification?.rejectionReason || "",
});

const consultationFields = [
  "medicine",
  "medicines",
  "additional_notes",
  "follow_up_required",
  "follow_up_date",
  "testName",
  "completeBy",
  "reason",
  "instructions",
  "recommended_tests",
  "recommendedTests",
];

const expandConsultationDetails = (appointment) => {
  try {
    const notes = JSON.parse(appointment.notes || "");
    if (notes?.__doctorConsultation === 1) {
      const details = Object.fromEntries(
        consultationFields
          .filter((field) => notes.details?.[field] !== undefined)
          .map((field) => [field, notes.details[field]]),
      );
      return { ...appointment, ...details, notes: notes.originalNotes };
    }
  } catch {
    // Non-JSON patient notes are left as-is.
  }
  return appointment;
};

const normalizeAppointmentMedicine = (medicine = {}) => {
  const duration = medicine.duration ||
    [medicine.durationValue, medicine.durationType].filter(Boolean).join(" ").trim();
  return {
    name: String(medicine.name || medicine.medicine || "").trim(),
    dosage: String(medicine.dosage || "").trim(),
    timeOfDay: Array.isArray(medicine.timeOfDay)
      ? medicine.timeOfDay
      : Array.isArray(medicine.timings)
        ? medicine.timings
        : [],
    timing: String(medicine.timing || medicine.when || "").trim(),
    duration,
  };
};

const medicinesFromAppointment = (appointment) => {
  if (Array.isArray(appointment.medicines) && appointment.medicines.length) {
    return appointment.medicines.map(normalizeAppointmentMedicine).filter((medicine) => medicine.name);
  }
  const text = String(appointment.medicine || "").trim();
  if (!text || /^not specified$/i.test(text)) return [];
  return text.split(/\r?\n/).map((line) => ({ name: line.trim(), dosage: "", timeOfDay: [], timing: "", duration: "" })).filter((medicine) => medicine.name);
};

const testsFromAppointment = (appointment) => {
  const tests = appointment.recommended_tests || appointment.recommendedTests;
  if (Array.isArray(tests) && tests.length) return tests.filter((test) => test?.testName || test?.name);
  if (appointment.testName) {
    return [{
      testName: appointment.testName,
      completeBy: appointment.completeBy || null,
      reason: appointment.reason || "",
      instructions: appointment.instructions || "",
    }];
  }
  return [];
};

const getAppointmentWhen = (appointment) => ({
  date: appointment.appointment_date || appointment.date || appointment.consultation_ended_at || appointment.updatedAt || "",
  time: appointment.appointment_time || "",
  tokenNumber: appointment.token_number || null,
  slotKey: appointment.slot_key || "",
});

const followUpToResponse = (followUp) => {
  if (!followUp) return null;
  return {
    id: recordId(followUp),
    date: followUp.follow_up_date || "",
    type: followUp.follow_up_type || "",
    reason: followUp.reason || "",
    notes: followUp.notes || "",
    status: followUp.status || "pending",
  };
};

const getDoctorSnapshot = (doctor, fallbackName = "Doctor") => ({
  id: recordId(doctor),
  name: doctor?.fullName || doctor?.name || fallbackName,
  qualification: doctor?.qualification || "",
  specialization: normalizeSpecializations(doctor),
  photo: getPhotoUrl(doctor),
  prescriptionSignature: getImageUrl(doctor?.prescriptionSignature),
  prescriptionSeal: getImageUrl(doctor?.prescriptionSeal),
});

const appointmentToPrescriptionResponse = (appointment, doctor) => {
  const expanded = expandConsultationDetails(appointment);
  const doctorSnapshot = getDoctorSnapshot(doctor);
  const issuedAt = expanded.consultation_ended_at || expanded.updatedAt || expanded.date;
  const followUpRequired = Boolean(expanded.follow_up_required || expanded.followUpRequired);
  const followUpDate = expanded.follow_up_date || expanded.followUpDate || "";
  const additionalNotes = expanded.additional_notes || expanded.additionalNotes || "";
  return {
    id: `appointment:${recordId(expanded)}`,
    source: "appointment",
    recordType: "completed_appointment",
    appointmentId: recordId(expanded),
    appointmentDate: expanded.appointment_date || "",
    appointmentTime: expanded.appointment_time || "",
    appointmentWhen: getAppointmentWhen(expanded),
    problem: expanded.diagnosis || expanded.symptoms || expanded.notes || "Completed consultation",
    diagnosis: expanded.diagnosis || "",
    medicines: medicinesFromAppointment(expanded),
    advice: expanded.advice || "",
    instructions: [expanded.advice, additionalNotes].filter(Boolean).join("\n\n"),
    additionalNotes,
    recommendedTests: testsFromAppointment(expanded),
    followUpRequired,
    followUpDate,
    issuedAt,
    patient: { id: idValue(expanded.patient) },
    psychiatrist: { id: idValue(expanded.counselor), ...doctorSnapshot },
    prescriptionSignatureUrl: doctorSnapshot.prescriptionSignature,
    prescriptionSealUrl: doctorSnapshot.prescriptionSeal,
    signatureUrl: doctorSnapshot.prescriptionSignature,
    sealUrl: doctorSnapshot.prescriptionSeal,
    fileName: "",
    fileUrl: "",
    fileSize: null,
    mimeType: "",
    hasPatientPhoto: false,
    verificationStatus: "completed",
    rejectionReason: "",
    canViewFile: false,
    canDownload: false,
  };
};

const doctorFromPrescription = (prescription) => ({
  id: idValue(prescription.psychiatrist?.id),
  name: prescription.psychiatrist?.name || "Doctor",
  qualification: prescription.psychiatrist?.qualification || "",
  specialization: prescription.psychiatrist?.specialization || [],
  photo: prescription.psychiatrist?.photo || "",
  prescriptionSignature: prescription.psychiatrist?.prescriptionSignature || prescription.signatureUrl || "",
  prescriptionSeal: prescription.psychiatrist?.prescriptionSeal || prescription.sealUrl || "",
});

const buildDoctorCards = ({ appointments, appointmentRecords, prescriptions, doctorsById, followUpsByAppointment, followUpsByDoctor }) => {
  const cardsByDoctor = new Map();
  const ensureCard = (doctor) => {
    const doctorId = idValue(doctor.id);
    if (!cardsByDoctor.has(doctorId)) {
      cardsByDoctor.set(doctorId, {
        doctor,
        totalAppointments: 0,
        appointments: [],
        prescriptions: [],
      });
    }
    return cardsByDoctor.get(doctorId);
  };

  appointments.forEach((appointment, index) => {
    const expanded = expandConsultationDetails(appointment);
    const doctorId = idValue(expanded.counselor);
    const doctor = getDoctorSnapshot(doctorsById.get(doctorId));
    doctor.id = doctorId;
    const explicitFollowUps = followUpsByAppointment.get(recordId(expanded)) || [];
    const embeddedFollowUp = expanded.follow_up_required || expanded.followUpRequired || expanded.follow_up_date || expanded.followUpDate
      ? {
          id: "",
          date: expanded.follow_up_date || expanded.followUpDate || "",
          type: "appointment",
          reason: expanded.reason || "",
          notes: expanded.additional_notes || expanded.additionalNotes || "",
          status: "pending",
        }
      : null;
    const followUps = explicitFollowUps.length ? explicitFollowUps : [embeddedFollowUp].filter(Boolean);
    const card = ensureCard(doctor);
    card.totalAppointments += 1;
    card.appointments.push({
      id: recordId(expanded),
      source: "appointment",
      status: expanded.status || "completed",
      when: getAppointmentWhen(expanded),
      diagnosis: expanded.diagnosis || "",
      problem: expanded.diagnosis || expanded.symptoms || expanded.notes || "Completed consultation",
      advice: expanded.advice || "",
      additionalNotes: expanded.additional_notes || expanded.additionalNotes || "",
      medicines: appointmentRecords[index]?.medicines || medicinesFromAppointment(expanded),
      recommendedTests: appointmentRecords[index]?.recommendedTests || testsFromAppointment(expanded),
      followUpRequired: followUps.length > 0,
      followUps,
      prescription: appointmentRecords[index],
    });
  });

  prescriptions.forEach((prescription) => {
    const doctor = doctorFromPrescription(prescription);
    const card = ensureCard(doctor);
    card.prescriptions.push(prescription);
  });

  followUpsByDoctor.forEach((followUps, doctorId) => {
    const card = cardsByDoctor.get(doctorId);
    if (!card) return;
    const linkedIds = new Set(card.appointments.flatMap((appointment) => appointment.followUps.map((followUp) => followUp.id).filter(Boolean)));
    const unlinkedFollowUps = followUps.filter((followUp) => !linkedIds.has(followUp.id));
    if (unlinkedFollowUps.length) {
      card.followUps = unlinkedFollowUps;
    }
  });

  return [...cardsByDoctor.values()].sort((left, right) => {
    const leftTime = new Date(left.appointments[0]?.when?.date || left.prescriptions[0]?.issuedAt || 0).getTime();
    const rightTime = new Date(right.appointments[0]?.when?.date || right.prescriptions[0]?.issuedAt || 0).getTime();
    return rightTime - leftTime;
  });
};

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
    let appointments = [];
    try {
      appointments = await Appointment.find({ patient: req.user._id, status: "completed" })
        .sort({ consultation_ended_at: -1, updatedAt: -1 })
        .lean();
    } catch (appointmentError) {
      console.warn("Completed appointment prescriptions could not be loaded:", appointmentError?.message || appointmentError);
    }
    const prescriptionResponses = records.map(toResponse);
    const doctorIds = [...new Set([
      ...appointments.map((appointment) => idValue(appointment.counselor)),
      ...prescriptionResponses.map((prescription) => idValue(prescription.psychiatrist?.id)),
    ].filter(Boolean))];
    let doctors = [];
    if (doctorIds.length) {
      try {
        doctors = await User.find({ _id: { $in: doctorIds } }).lean();
      } catch (doctorError) {
        console.warn("Prescription doctor snapshots could not be loaded:", doctorError?.message || doctorError);
      }
    }
    let followUps = [];
    try {
      followUps = await FollowUp.find({ patient_id: req.user._id })
        .sort({ follow_up_date: -1 })
        .lean();
    } catch (followUpError) {
      console.warn("Prescription follow-up details could not be loaded:", followUpError?.message || followUpError);
    }
    const doctorsById = new Map(doctors.map((doctor) => [recordId(doctor), doctor]));
    const followUpResponses = followUps.map(followUpToResponse);
    const followUpsByAppointment = new Map();
    const followUpsByDoctor = new Map();
    followUps.forEach((followUp, index) => {
      const response = followUpResponses[index];
      const appointmentId = idValue(followUp.appointment_id);
      const doctorId = idValue(followUp.doctor_id);
      if (appointmentId) {
        const list = followUpsByAppointment.get(appointmentId) || [];
        list.push(response);
        followUpsByAppointment.set(appointmentId, list);
      }
      if (doctorId) {
        const list = followUpsByDoctor.get(doctorId) || [];
        list.push(response);
        followUpsByDoctor.set(doctorId, list);
      }
    });
    const appointmentRecords = appointments.map((appointment) =>
      appointmentToPrescriptionResponse(appointment, doctorsById.get(idValue(appointment.counselor))),
    );
    const prescriptions = [...prescriptionResponses, ...appointmentRecords]
      .sort((left, right) => new Date(right.issuedAt || 0) - new Date(left.issuedAt || 0));
    const doctorCards = buildDoctorCards({
      appointments,
      appointmentRecords,
      prescriptions: prescriptionResponses,
      doctorsById,
      followUpsByAppointment,
      followUpsByDoctor,
    });
    return res.json({ success: true, prescriptions, doctorCards });
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
    // stored in MySQL. New records never depend on Cloudinary delivery.
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
      { returnDocument: 'after', runValidators: true },
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
    const photoBuffer = bufferFromStoredBinary(record.patientPhoto.data);
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
