import { generateObjectId } from "../models/mysql/BaseModel.js";
import { query } from "../config/mysql.js";
import { doctorQrStats } from "../services/doctorQrStatsService.js";
import User from "../models/userModel.js";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import OTP from "../models/otpModel.js";
import LoginOTP from "../models/loginOtpModel.js";
import bcrypt from "bcryptjs";
import { formatCertifications } from "../utils/certificationFormatter.js";
import Session from "../models/sessionModel.js";
import { generateAccessToken, generateRefreshToken } from "../utils/token.js";
// import { saveLocalFile, deleteLocalFile } from "../utils/uploadHelper.js";
import otpService from "../services/otpService.js";
import { reverseGeocode } from "../services/geocodingService.js";
import { validationResult } from "express-validator";
import { sendResetPasswordEmail } from "../utils/emailService.js";
import cloudinary from "../config/cloudinary.js";
import {
  uploadToCloudinary,
  deleteFromCloudinary,
} from "../utils/uploadHelper.js";
// import User from "../models/userModel.js";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Twilio client is not used in this controller; removed to reduce bundle size.

// ================= TEMPORARY STORAGE =================
const verifiedUsersStore = new Map();
const emailOTPStore = new Map();
const phoneOTPStore = new Map();
const EMAIL_VERIFICATION_PURPOSE = "registration_email_verified";

// Public aggregate counters used by the landing page. Only totals are exposed.
export const getLandingStats = async (_req, res) => {
  try {
    const [patientsHelped, medicalPartners, activeSupports, completedPatients] =
      await Promise.all([
        User.countDocuments({ role: "user" }),
        User.countDocuments({ role: "counsellor" }),
        User.countDocuments({ role: "counsellor", isOnline: true }),
        Chat.countDocuments({ status: "closed", closedAt: { $ne: null } }),
      ]);

    return res.json({
      success: true,
      data: {
        patientsHelped,
        medicalPartners,
        activeSupports,
        completedPatients,
      },
    });
  } catch (error) {
    console.error("Landing stats error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load landing statistics",
    });
  }
};
// Store OTPs used for unlinking Google accounts (requires confirm)
const unlinkGoogleOTPStore = new Map();

// Profile-change OTP flow (dashboard "edit email / phone"). Keyed by
// `${userId}:${field}` so a user can have at most one pending change per
// field at a time. Each entry holds the OTP + the new value the user wants
// to switch to. Once verified, the entry is moved to verifiedProfileChanges
// and consumed by updateUserById on the next PATCH /update/:userId call.
const profileChangeOTPStore = new Map();
const verifiedProfileChanges = new Map();
const PROFILE_CHANGE_OTP_TTL_MS = 10 * 60 * 1000; // 10 min to enter the OTP
const PROFILE_CHANGE_VERIFIED_TTL_MS = 15 * 60 * 1000; // 15 min to hit Save

const normalizeEmail = (email = "") => String(email).trim().toLowerCase();
const normalizeOtp = (otp = "") => String(otp).trim();
const normalizeRole = (role = "") => {
  const normalized = String(role).trim().toLowerCase();
  if (["counselor", "counsellor", "counsellour"].includes(normalized)) {
    return "counsellor";
  }
  return normalized;
};
const getAgeFromDateOfBirth = (value) => {
  if (!value) return { date: null, age: null, valid: true };

  const raw = value instanceof Date ? value.toISOString() : String(value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return { date: null, age: null, valid: false };

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { date: null, age: null, valid: false };
  }

  const today = new Date();
  const todayUtc = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  ));
  if (date > todayUtc) return { date: null, age: null, valid: false };

  let age = todayUtc.getUTCFullYear() - year;
  const birthdayThisYear = new Date(Date.UTC(todayUtc.getUTCFullYear(), month - 1, day));
  if (todayUtc < birthdayThisYear) age -= 1;

  return { date, age, valid: age >= 0 };
};
const isGeneratedUserAvatarUrl = (value = "") => {
  const url = String(value || "").trim();
  if (!url) return false;
  return (
    url.startsWith("data:image/") ||
    /^https:\/\/api\.dicebear\.com\//i.test(url)
  );
};
const DEFAULT_PHONE_COUNTRY_CODE = "91";
const LOCAL_PHONE_NUMBER_LENGTH = 10;
const normalizePhoneNumber = (value = "", fallbackCountryCode = DEFAULT_PHONE_COUNTRY_CODE) => {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  const fallbackDigits = String(fallbackCountryCode || DEFAULT_PHONE_COUNTRY_CODE).replace(/\D/g, "") || DEFAULT_PHONE_COUNTRY_CODE;
  const countryCode = `+${fallbackDigits}`;

  if (!digits) {
    return {
      digits: "",
      formatted: "",
      smsFormatted: "",
      countryCode,
      isValid: false,
      duplicateValues: [],
    };
  }

  let localDigits = digits;
  if (localDigits.length > LOCAL_PHONE_NUMBER_LENGTH) {
    const prefixes = Array.from(
      new Set([fallbackDigits, DEFAULT_PHONE_COUNTRY_CODE].filter(Boolean)),
    );
    const matchingPrefix = prefixes.find(
      (prefix) =>
        localDigits.startsWith(prefix) &&
        localDigits.length - prefix.length === LOCAL_PHONE_NUMBER_LENGTH,
    );
    if (matchingPrefix) {
      localDigits = localDigits.slice(matchingPrefix.length);
    }
  }

  const formatted = localDigits;
  const smsFormatted = `+${fallbackDigits}${localDigits}`;
  const duplicateValues = Array.from(
    new Set([
      formatted,
      smsFormatted,
      `${fallbackDigits}${localDigits}`,
      `+${DEFAULT_PHONE_COUNTRY_CODE}${localDigits}`,
      `${DEFAULT_PHONE_COUNTRY_CODE}${localDigits}`,
      digits,
    ].filter(Boolean)),
  );

  return {
    digits: localDigits,
    formatted,
    smsFormatted,
    countryCode,
    isValid: localDigits.length === LOCAL_PHONE_NUMBER_LENGTH,
    duplicateValues,
  };
};
const LOGIN_OTP_TTL_MS = 10 * 60 * 1000;

const saveLoginOTP = async ({ userId, email, otp }) => {
  const normalizedEmail = normalizeEmail(email);
  await LoginOTP.deleteMany({ userId });
  return LoginOTP.create({
    userId,
    email: normalizedEmail,
    otp: String(otp),
    expiresAt: new Date(Date.now() + LOGIN_OTP_TTL_MS),
  });
};

const getPendingLoginOTP = async (email) => {
  const normalizedEmail = normalizeEmail(email);
  return LoginOTP.findOne({ email: normalizedEmail }).sort({ createdAt: -1 });
};

const clearLoginOTP = async (userId) => {
  await LoginOTP.deleteMany({ userId });
};

setInterval(() => {
  const now = Date.now();
  for (const [key, data] of profileChangeOTPStore.entries()) {
    if (data.expiresAt < now) profileChangeOTPStore.delete(key);
  }
  for (const [key, data] of verifiedProfileChanges.entries()) {
    if (data.expiresAt < now) verifiedProfileChanges.delete(key);
  }
}, 60 * 1000).unref?.();

const MAX_LOCATION_HISTORY = 20;
const MAX_COUNSELLOR_DOCUMENTS = 5;

const getClientIp = (req) =>
  (req.headers["x-forwarded-for"]?.split(",")[0] || req.socket?.remoteAddress || "").trim();

const markUserOnline = async (userOrId) => {
  const userId = userOrId?._id || userOrId;
  if (!userId) return;

  await User.findByIdAndUpdate(userId, {
    $set: { isOnline: true, lastSeen: null },
  });

  if (userOrId?._id) {
    userOrId.isOnline = true;
    userOrId.lastSeen = null;
  }
};

const markUserOfflineIfNoActiveSessions = async (userId) => {
  if (!userId) return;

  const activeSessionCount = await Session.countDocuments({
    userId,
    isActive: true,
  });

  if (activeSessionCount > 0) return;

  await User.findByIdAndUpdate(userId, {
    $set: { isOnline: false, lastSeen: new Date() },
  });
};

const saveLoginLocationIfProvided = async ({ req, userId }) => {
  const lat = Number(req.body?.latitude);
  const lng = Number(req.body?.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

  let geo = { address: "", city: "", state: "", country: "" };
  try {
    geo = await reverseGeocode(lat, lng);
  } catch (err) {
    // keep empty address; coords still saved
  }

  const now = new Date();
  const ip = getClientIp(req);

  const current = {
    type: "Point",
    coordinates: [lng, lat], // GeoJSON [lng, lat]
    address: geo.address,
    city: geo.city,
    state: geo.state,
    country: geo.country,
    capturedAt: now,
    ipAddress: ip,
  };

  const historyEntry = {
    coordinates: [lng, lat],
    address: geo.address,
    capturedAt: now,
    event: "login",
    ipAddress: ip,
  };

  await User.findByIdAndUpdate(userId, {
    $set: {
      "locationData.current": current,
      locationConsent: true,
    },
    $push: {
      "locationData.history": {
        $each: [historyEntry],
        $slice: -MAX_LOCATION_HISTORY,
      },
    },
  });
};

// Clean up expired data every hour
setInterval(
  () => {
    const now = Date.now();
    for (const [email, data] of verifiedUsersStore.entries()) {
      if (data.expiresAt < now) verifiedUsersStore.delete(email);
    }
    for (const [email, data] of emailOTPStore.entries()) {
      if (data.expiresAt < now) emailOTPStore.delete(email);
    }
    for (const [email, data] of phoneOTPStore.entries()) {
      if (data.expiresAt < now) phoneOTPStore.delete(email);
    }
  },
  60 * 60 * 1000,
);

// Clean up unlink OTPs every hour
setInterval(
  () => {
    const now = Date.now();
    for (const [key, data] of unlinkGoogleOTPStore.entries()) {
      if (data.expiresAt < now) unlinkGoogleOTPStore.delete(key);
    }
  },
  60 * 60 * 1000,
).unref?.();

export const updateUserById = async (req, res) => {
  try {
    const { userId } = req.params;

    // Removed verbose console logs for production

    // Log all files with their paths
    if (req.files) {
      Object.keys(req.files).forEach((field) => {
        // Removed per-file console logging to reduce noise
      });
    }

    // Find existing user
    const currentUser = await User.findById(userId);
    if (!currentUser) {
      return res.status(404).json({
        message: "User not found",
        success: false,
      });
    }
    const isPatientUser = normalizeRole(currentUser.role) === "user";

    // Prepare updates object
    const updates = {};

    // 1. Handle profile image. Patient users are avatar-only: direct photo
    // uploads and Google profile pictures must never become their profile image.
    if (
      req.files &&
      req.files["profilePhoto"] &&
      req.files["profilePhoto"][0]
    ) {
      const profileFile = req.files["profilePhoto"][0];
      if (isPatientUser) {
        if (profileFile?.filename) {
          try {
            await cloudinary.uploader.destroy(profileFile.filename);
          } catch (err) {
            console.error("Error deleting rejected user profile photo:", err);
          }
        }
        return res.status(400).json({
          message: "Users can update only a generated avatar, not a profile photo.",
          success: false,
        });
      }
      // console.log(
      //   "Processing profile photo:",
      //   profileFile.originalname,
      //   "URL:",
      //   profileFile.path,
      // );

      // Delete old photo if exists
      if (
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET &&
        currentUser.profilePhoto &&
        currentUser.profilePhoto.publicId
      ) {
        try {
          await cloudinary.uploader.destroy(currentUser.profilePhoto.publicId);
          console.log("Deleted old profile photo");
        } catch (err) {
          console.error("Error deleting old photo:", err);
        }
      }

      updates.profilePhoto = {
        url: profileFile.path,
        publicId: profileFile.filename,
        format: profileFile.format || null,
        bytes: profileFile.bytes || null,
      };
    } else if (
      req.body.avatarUrl &&
      typeof req.body.avatarUrl === "string" &&
      (req.body.avatarUrl.startsWith("http") || req.body.avatarUrl.startsWith("data:image/"))
    ) {
      if (isPatientUser && !isGeneratedUserAvatarUrl(req.body.avatarUrl)) {
        return res.status(400).json({
          message: "Users can update only a generated avatar.",
          success: false,
        });
      }
      // Avatar URL from generator (DiceBear etc.) — store directly, no file upload
      if (
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET &&
        currentUser.profilePhoto &&
        currentUser.profilePhoto.publicId
      ) {
        try {
          await cloudinary.uploader.destroy(currentUser.profilePhoto.publicId);
        } catch (err) {
          console.error("Error deleting old photo on avatar switch:", err);
        }
      }
      updates.profilePhoto = { url: String(req.body.avatarUrl).trim(), publicId: null };
    } else if (req.body.removeProfilePhoto === "true") {
      if (
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET &&
        currentUser.profilePhoto &&
        currentUser.profilePhoto.publicId
      ) {
        try {
          await cloudinary.uploader.destroy(currentUser.profilePhoto.publicId);
        } catch (err) {
          console.error("Error deleting photo on remove:", err);
        }
      }
      updates.profilePhoto = null;
    }

    // 2. Handle Certifications - FIXED: Properly handle document URLs and DELETION
    let processedCertifications = [];

    // Check for certifications to delete
    let certificationsToDelete = [];
    if (req.body.deleteCertificationIds) {
      try {
        certificationsToDelete =
          typeof req.body.deleteCertificationIds === "string"
            ? JSON.parse(req.body.deleteCertificationIds)
            : req.body.deleteCertificationIds;
        console.log("Certifications to delete:", certificationsToDelete);
      } catch (e) {
        console.error("Error parsing deleteCertificationIds:", e);
      }
    }

    // Check for certification files in different formats
    const certificationFiles = [];

    // Check for nested certification files (certifications[0][document] format)
    if (req.files) {
      Object.keys(req.files).forEach((field) => {
        if (field.includes("certifications") && field.includes("document")) {
          // Extract index from field name like "certifications[0][document]"
          const match = field.match(/certifications\[(\d+)\]\[document\]/);
          if (match) {
            const index = parseInt(match[1]);
            certificationFiles[index] = req.files[field][0];
            console.log(
              `Found nested certification file at index ${index}:`,
              req.files[field][0].originalname,
            );
          }
        } else if (field === "certificationDocuments") {
          // Handle flat certificationDocuments array
          req.files[field].forEach((file, idx) => {
            certificationFiles[idx] = file;
            // console.log(
            //   `Found certification file at index ${idx}:`,
            //   file.originalname,
            // );
          });
        }
      });
    }

    // console.log(`Total certification files found: ${certificationFiles.length}`);

    // First, delete the certifications that are marked for deletion
    if (certificationsToDelete.length > 0 && currentUser.certifications) {
      // Find certifications to delete and remove their files from Cloudinary
      const certsToRemove = currentUser.certifications.filter((cert) =>
        certificationsToDelete.includes(cert._id.toString()),
      );

      // Delete files from Cloudinary
      for (const cert of certsToRemove) {
        if (cert.documentPublicId) {
          try {
            await cloudinary.uploader.destroy(cert.documentPublicId);
            // console.log(`Deleted certification file: ${cert.documentPublicId}`);
          } catch (err) {
            // console.error(
            //   `Error deleting certification file ${cert.documentPublicId}:`,
            //   err,
            // );
          }
        }
      }

      // Keep only certifications that are NOT marked for deletion
      const remainingCerts = currentUser.certifications.filter(
        (cert) => !certificationsToDelete.includes(cert._id.toString()),
      );

      // console.log(
      //   `Deleted ${certsToRemove.length} certifications, ${remainingCerts.length} remaining`,
      // );
      processedCertifications = [...remainingCerts];
    }

    // Parse certifications from request body (new/updated certifications)
    if (req.body.certifications) {
      try {
        let certificationsData = req.body.certifications;

        // Parse if it's a JSON string
        if (typeof certificationsData === "string") {
          try {
            certificationsData = JSON.parse(certificationsData);
            // console.log('Parsed certifications from JSON string');
          } catch (e) {
            console.log("Failed to parse as JSON, checking nested format");
          }
        }

        // Handle nested format (certifications[0][name], etc.)
        const hasNestedFormat = Object.keys(req.body).some((key) =>
          key.startsWith("certifications["),
        );

        if (hasNestedFormat) {
          // console.log("Processing nested certifications format");
          const certMap = new Map();

          Object.keys(req.body).forEach((key) => {
            const match = key.match(/certifications\[(\d+)\]\[(\w+)\]/);
            if (match) {
              const index = parseInt(match[1]);
              const field = match[2];
              const value = req.body[key];

              if (!certMap.has(index)) {
                certMap.set(index, {});
              }
              certMap.get(index)[field] = value;
            }
          });

          // Convert map to array with file URLs
          const newCertifications = [];
          certMap.forEach((cert, index) => {
            // Skip if this certification is marked as deleted
            if (cert._id && certificationsToDelete.includes(cert._id)) {
              // console.log(
              //   `Skipping deleted certification with ID: ${cert._id}`,
              // );
              return;
            }

            const certFile = certificationFiles[index];
            const certification = {
              name: cert.name || "",
              issuedBy: cert.issuedBy || "",
              issueDate: cert.issueDate || null,
              expiryDate: cert.expiryDate || null,
              _id: cert._id || undefined,
            };

            if (certFile && certFile.path) {
              console.log(
                `Adding document for certification ${index}:`,
                certFile.originalname,
                "URL:",
                certFile.path,
              );
              certification.documentName = certFile.originalname;
              certification.documentUrl = certFile.path;
              certification.documentPublicId = certFile.filename;
            } else if (
              cert.documentUrl &&
              cert.documentUrl !== "null" &&
              cert.documentUrl !== ""
            ) {
              // Keep existing document
              certification.documentName = cert.documentName || "";
              certification.documentUrl = cert.documentUrl;
              certification.documentPublicId = cert.documentPublicId || null;
              // console.log(
              //   `Keeping existing document for certification ${index}:`,
              //   certification.documentUrl,
              // );
            }

            newCertifications.push(certification);
          });

          // Merge with existing certifications that weren't deleted
          // Filter out any certifications that might be duplicates
          const existingCerts = processedCertifications.filter(
            (existing) =>
              !newCertifications.some(
                (newCert) => newCert._id && newCert._id === existing._id,
              ),
          );

          processedCertifications = [...existingCerts, ...newCertifications];
        }
        // Handle array format
        else if (Array.isArray(certificationsData)) {
          // console.log("Processing array format certifications");
          const newCertifications = certificationsData
            .map((cert, index) => {
              // Skip if this certification is marked as deleted
              if (cert._id && certificationsToDelete.includes(cert._id)) {
                // console.log(
                //   `Skipping deleted certification with ID: ${cert._id}`,
                // );
                return null;
              }

              const certFile = certificationFiles[index];

              if (certFile && certFile.path) {
                // console.log(
                //   `Adding document for certification ${index}:`,
                //   certFile.originalname,
                //   "URL:",
                //   certFile.path,
                // );
                return {
                  ...cert,
                  documentName: certFile.originalname,
                  documentUrl: certFile.path,
                  documentPublicId: certFile.filename,
                };
              }

              // Keep existing document if no new file
              if (
                cert.documentUrl &&
                cert.documentUrl !== "null" &&
                cert.documentUrl !== ""
              ) {
                // console.log(
                //   `Keeping existing document for certification ${index}:`,
                //   cert.documentUrl,
                // );
                return cert;
              }

              // Return certification without document
              return {
                ...cert,
                documentName: cert.documentName || "",
                documentUrl: null,
                documentPublicId: null,
              };
            })
            .filter((cert) => cert !== null); // Remove null entries (deleted certs)

          // Merge with existing certifications that weren't deleted
          const existingCerts = processedCertifications.filter(
            (existing) =>
              !newCertifications.some(
                (newCert) => newCert._id && newCert._id === existing._id,
              ),
          );

          processedCertifications = [...existingCerts, ...newCertifications];
        }
        // Handle object with arrays format
        else if (
          certificationsData.name &&
          Array.isArray(certificationsData.name)
        ) {
          // console.log("Processing object with arrays format");
          let fileIndex = 0;
          const newCertifications = [];

          for (let i = 0; i < certificationsData.name.length; i++) {
            if (
              certificationsData.name[i] &&
              certificationsData.name[i].trim()
            ) {
              // Skip if this certification is marked as deleted
              if (
                certificationsData._id?.[i] &&
                certificationsToDelete.includes(certificationsData._id[i])
              ) {
                // console.log(
                //   `Skipping deleted certification with ID: ${certificationsData._id[i]}`,
                // );
                continue;
              }

              const certFile = certificationFiles[fileIndex];

              const certification = {
                name: certificationsData.name[i],
                issuedBy: certificationsData.issuedBy?.[i] || "",
                issueDate: certificationsData.issueDate?.[i] || null,
                expiryDate: certificationsData.expiryDate?.[i] || null,
                _id: certificationsData._id?.[i] || undefined,
              };

              if (certFile && certFile.path) {
                // console.log(
                //   `Adding document for certification ${i}:`,
                //   certFile.originalname,
                // );
                certification.documentName = certFile.originalname;
                certification.documentUrl = certFile.path;
                certification.documentPublicId = certFile.filename;
                fileIndex++;
              } else if (
                certificationsData.documentUrl?.[i] &&
                certificationsData.documentUrl[i] !== "null" &&
                certificationsData.documentUrl[i] !== ""
              ) {
                // Keep existing document
                certification.documentName =
                  certificationsData.documentName?.[i] || "";
                certification.documentUrl = certificationsData.documentUrl[i];
                certification.documentPublicId =
                  certificationsData.documentPublicId?.[i] || null;
              } else {
                certification.documentName = "";
                certification.documentUrl = null;
                certification.documentPublicId = null;
              }

              newCertifications.push(certification);
            }
          }

          // Merge with existing certifications that weren't deleted
          const existingCerts = processedCertifications.filter(
            (existing) =>
              !newCertifications.some(
                (newCert) => newCert._id && newCert._id === existing._id,
              ),
          );

          processedCertifications = [...existingCerts, ...newCertifications];
        }

        // console.log(
        //   `Processed ${processedCertifications.length} certifications total after deletion and updates`,
        // );

        // Apply certifications update
        updates.certifications = processedCertifications;
        // console.log(
        //   `Added ${processedCertifications.length} certifications to update`,
        // );
      } catch (error) {
        console.error("Error processing certifications:", error);
      }
    } else if (
      req.body.certifications === null ||
      req.body.certifications === ""
    ) {
      updates.certifications = [];
    } else if (certificationsToDelete.length > 0 && !req.body.certifications) {
      // If only deletions happened (no new/updated certifications)
      updates.certifications = processedCertifications;
    }

    const hasCertificationPayload =
      req.body.certifications !== undefined ||
      Object.keys(req.files || {}).some(
        (field) => field.includes("certifications") || field === "certificationDocuments",
      );

    if (["counsellor", "doctor"].includes(currentUser.role) && hasCertificationPayload) {
      const existingCertificationIds = new Set(
        (currentUser.certifications || [])
          .map((cert) => cert?._id?.toString())
          .filter(Boolean),
      );

      if (updates.certifications?.length > MAX_COUNSELLOR_DOCUMENTS) {
        return res.status(400).json({
          success: false,
          message: `You can upload a maximum of ${MAX_COUNSELLOR_DOCUMENTS} certification documents.`,
        });
      }

      const missingDocumentEntries = (updates.certifications || []).filter((cert) => {
        const certId = cert?._id?.toString();
        const isExistingCertification = certId && existingCertificationIds.has(certId);
        return !isExistingCertification && !cert?.documentUrl && !cert?.documentPublicId;
      });

      if (missingDocumentEntries.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Please upload a document image for each new certification before updating your profile.",
        });
      }
    }

    // Log final certifications before update
    if (updates.certifications) {
      console.log("Final certifications to save:");
      updates.certifications.forEach((cert, idx) => {
        console.log(`  Cert ${idx}:`, {
          name: cert.name,
          documentUrl: cert.documentUrl,
          documentName: cert.documentName,
          _id: cert._id,
        });
      });
    }

    // 3. Handle basic user fields.
    //
    // Email changes from the dashboard must be gated by the profile-change
    // OTP flow. Phone changes are validated below and protected by the
    // database unique index, matching the registration flow.
    const basicFields = [
      "fullName",
      "anonymous",
      "phoneNumber",
      "age",
      "gender",
      "dateOfBirth",
      "bloodGroup",
      "isActive",
      "isVerified",
      "profileCompleted",
      "email",
    ];

    for (const field of basicFields) {
      if (req.body[field] === undefined || req.body[field] === "") continue;

      // Gate email changes through the OTP flow.
      if (field === "email") {
        const incoming = String(req.body.email).trim().toLowerCase();
        const current = String(currentUser.email || "").toLowerCase();
        if (incoming !== current) {
          const check = consumeVerifiedProfileChange(userId, "email", incoming);
          if (!check.ok) {
            return res.status(403).json({
              success: false,
              message: check.message,
              field: "email",
            });
          }
          updates.email = incoming;
          updates.isEmailVerified = true;

          // Changing the account email should detach the existing Google link.
          // The profile data stays intact, but future Google sign-in must be
          // performed again against the new email/account state.
          updates.googleEmail = null;
          updates.googleId = undefined;
          updates.authProvider = "local";
        }
        continue;
      }

      if (field === "phoneNumber") {
        const incomingPhone = normalizePhoneNumber(
          req.body.phoneNumber,
          req.body.phoneCountryCode,
        );
        if (!incomingPhone.isValid) {
          return res.status(400).json({
            success: false,
            message: "Enter a valid phone number",
            field: "phoneNumber",
          });
        }
        const currentPhone = normalizePhoneNumber(currentUser.phoneNumber || "");
        if (incomingPhone.formatted !== currentPhone.formatted) {
          const phoneOwner = await User.findOne({
            phoneNumber: { $in: incomingPhone.duplicateValues },
            _id: { $ne: userId },
          })
            .select("_id")
            .lean();
          if (phoneOwner) {
            return res.status(409).json({
              success: false,
              message: "This phone number already exists. Please use another phone number.",
              field: "phoneNumber",
            });
          }
          updates.phoneNumber = incomingPhone.formatted;
        }
        updates.phoneCountryCode = incomingPhone.countryCode;
        continue;
      }

      if (field === "age") {
        if (req.body.dateOfBirth || currentUser.dateOfBirth) {
          continue;
        }
        updates.age = req.body.age;
        continue;
      }

      if (field === "dateOfBirth") {
        const dob = getAgeFromDateOfBirth(req.body.dateOfBirth);
        if (!dob.valid || dob.age === null) {
          return res.status(400).json({
            success: false,
            message: "Select a valid date of birth.",
            field: "dateOfBirth",
          });
        }
        updates.dateOfBirth = dob.date;
        updates.age = dob.age;
        continue;
      }

      if (field === "bloodGroup") {
        const bloodGroup = String(req.body[field]).trim().toUpperCase();
        const validBloodGroups = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];

        if (!validBloodGroups.includes(bloodGroup)) {
          return res.status(400).json({
            success: false,
            message: "Invalid blood group.",
            field: "bloodGroup",
            allowedValues: validBloodGroups,
          });
        }

        updates.bloodGroup = bloodGroup;
        continue;
      }

      updates[field] = req.body[field];
    }

    // 4. Handle nested objects
    if (req.body.address) {
      try {
        updates.address =
          typeof req.body.address === "string"
            ? JSON.parse(req.body.address)
            : req.body.address;
      } catch (e) {
        updates.address = req.body.address;
      }
    }

    if (req.body.emergencyContact) {
      try {
        updates.emergencyContact =
          typeof req.body.emergencyContact === "string"
            ? JSON.parse(req.body.emergencyContact)
            : req.body.emergencyContact;
      } catch (e) {
        updates.emergencyContact = req.body.emergencyContact;
      }
    }

    // 5. Handle medicalInfo field (NEW)
    if (req.body.medicalInfo) {
      try {
        updates.medicalInfo =
          typeof req.body.medicalInfo === "string"
            ? JSON.parse(req.body.medicalInfo)
            : req.body.medicalInfo;
      } catch (e) {
        updates.medicalInfo = req.body.medicalInfo;
      }
    }

    // 6. Handle insuranceInfo field (NEW)
    if (req.body.insuranceInfo) {
      try {
        updates.insuranceInfo =
          typeof req.body.insuranceInfo === "string"
            ? JSON.parse(req.body.insuranceInfo)
            : req.body.insuranceInfo;
      } catch (e) {
        updates.insuranceInfo = req.body.insuranceInfo;
      }
    }

    // 7. Handle counsellor-specific fields
    if (["counsellor", "doctor"].includes(currentUser.role)) {
      const counsellorFields = [
        "qualification",
        "specialization",
        "experience",
        "location",
        "consultationMode",
        "languages",
        "aboutMe",
        "education",
        "rating",
        "totalSessions",
        "activeClients",
      ];

      counsellorFields.forEach((field) => {
        if (req.body[field] !== undefined && req.body[field] !== "") {
          // Parse JSON strings for array fields
          if (
            ["specialization", "languages", "consultationMode"].includes(
              field,
            ) &&
            typeof req.body[field] === "string"
          ) {
            try {
              updates[field] = JSON.parse(req.body[field]);
            } catch (e) {
              updates[field] = req.body[field].split(",").map((s) => s.trim());
            }
          } else {
            updates[field] = req.body[field];
          }
        }
      });
    }

    // 8a. Auto-set profileCompleted for counsellors when required fields are present
    if (["counsellor", "doctor"].includes(currentUser.role)) {
      const mergedSpec = updates.specialization ?? currentUser.specialization;
      const mergedExp = updates.experience ?? currentUser.experience;
      const mergedQual = updates.qualification ?? currentUser.qualification ?? updates.education ?? currentUser.education;
      const mergedLoc = updates.location ?? currentUser.location;
      const specOk = Array.isArray(mergedSpec) ? mergedSpec.length > 0 : !!mergedSpec;
      const hasAllRequired = specOk && !!mergedExp && !!mergedQual && !!mergedLoc;
      updates.profileCompleted = hasAllRequired;
    }

    // 8. Validate phone number
    if (updates.phoneNumber && !normalizePhoneNumber(updates.phoneNumber).isValid) {
      return res.status(400).json({
        message: "Enter a valid phone number",
        success: false,
      });
    }

    // 9. Update user
    // console.log("Applying updates...");

    const unsetUpdates = {};
    if (
      Object.prototype.hasOwnProperty.call(updates, "googleEmail") &&
      updates.googleEmail === null
    ) {
      unsetUpdates.googleEmail = "";
      delete updates.googleEmail;
    }
    if (
      Object.prototype.hasOwnProperty.call(updates, "googleId") &&
      updates.googleId === undefined
    ) {
      unsetUpdates.googleId = "";
      delete updates.googleId;
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $set: updates,
        ...(Object.keys(unsetUpdates).length > 0 ? { $unset: unsetUpdates } : {}),
      },
      { returnDocument: "after", runValidators: true },
    ).select("-password -emailOTP -phoneOTP");

    if (!updatedUser) {
      return res.status(404).json({
        message: "User not found after update",
        success: false,
      });
    }

    const updatedAgeFromDateOfBirth = getAgeFromDateOfBirth(updatedUser.dateOfBirth);
    // 10. Format response with all fields matching frontend structure
    const formattedUser = {
      _id: updatedUser._id,
      fullName: updatedUser.fullName,
      anonymous: updatedUser.anonymous,
      email: updatedUser.email,
      phoneNumber: updatedUser.phoneNumber,
      phoneCountryCode: updatedUser.phoneCountryCode,
      age: updatedAgeFromDateOfBirth.age ?? updatedUser.age,
      gender: updatedUser.gender,
      role: updatedUser.role,
      profilePhoto: updatedUser.profilePhoto,
      isActive: updatedUser.isActive,
      profileCompleted: updatedUser.profileCompleted,
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt,
      dateOfBirth: updatedUser.dateOfBirth
        ? new Date(updatedUser.dateOfBirth).toISOString().split("T")[0]
        : null,
      bloodGroup: updatedUser.bloodGroup,
      address: updatedUser.address,
      emergencyContact: updatedUser.emergencyContact,
      medicalInfo: updatedUser.medicalInfo,
      insuranceInfo: updatedUser.insuranceInfo,
    };

    // Add counsellor fields if applicable
    if (["counsellor", "doctor"].includes(updatedUser.role)) {
      Object.assign(formattedUser, {
        qualification: updatedUser.qualification,
        specialization: updatedUser.specialization,
        experience: updatedUser.experience,
        location: updatedUser.location,
        consultationMode: updatedUser.consultationMode,
        languages: updatedUser.languages,
        aboutMe: updatedUser.aboutMe,
        education: updatedUser.education,
        certifications: updatedUser.certifications,
        rating: updatedUser.rating,
        totalSessions: updatedUser.totalSessions,
        activeClients: updatedUser.activeClients,
        uniqueCode: updatedUser.uniqueCode,
      });
    }

    // console.log(
    //   "Update successful! Certifications saved:",
    //   formattedUser.certifications?.length,
    // );

    return res.status(200).json({
      message: "User updated successfully",
      success: true,
      user: formattedUser,
    });
  } catch (error) {
    console.error("Update user error:", error);

    // A concurrent update can still win between the duplicate check above
    // and MongoDB's write. Convert that unique-index error into the same
    // user-facing validation response instead of exposing raw E11000 data.
    if (error?.code === 11000 && error?.keyPattern?.phoneNumber) {
      return res.status(409).json({
        success: false,
        message: "This phone number already exists. Please use another phone number.",
        field: "phoneNumber",
      });
    }

    // Rollback: Delete any uploaded files if error occurred
    if (req.files && req.files["profilePhoto"]) {
      try {
        await cloudinary.uploader.destroy(
          req.files["profilePhoto"][0].filename,
        );
        console.log("Rollback: Deleted profile photo");
      } catch (e) {}
    }
    if (req.files) {
      Object.keys(req.files).forEach((field) => {
        if (
          field.includes("certifications") ||
          field === "certificationDocuments"
        ) {
          req.files[field].forEach(async (file) => {
            try {
              await cloudinary.uploader.destroy(file.filename);
              // console.log(
              //   `Rollback: Deleted certification file ${file.filename}`,
              // );
            } catch (e) {}
          });
        }
      });
    }

    return res.status(500).json({
      message: "Error updating user",
      success: false,
      error: error.message,
    });
  }
};

export const sendEmailOTP = async (req, res) => {
  try {
    const normalizedEmail = String(req.body.email || "").trim().toLowerCase();
    if (!normalizedEmail) {
      return res
        .status(400)
        .json({ message: "Email is required", success: false });
    }

    const existingUser = await User.findOne({ email: normalizedEmail })
      .select("role")
      .lean();
    if (existingUser) {
      const accountType =
        existingUser.role === "counsellor" ? "Counselor" : "User";
      return res.status(409).json({
        message: `${accountType} account already exists with this email`,
        success: false,
      });
    }

    const otp = otpService.generateOTP(normalizedEmail);

    try {
      await otpService.sendEmailOTP(normalizedEmail, otp, "User");
      emailOTPStore.set(normalizedEmail, {
        otp,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      return res.status(200).json({
        message: "Email OTP sent successfully",
        success: true,
        email: normalizedEmail,
      });
    } catch (sendError) {
      console.error("OTP sending error:", sendError);
      return res.status(500).json({
        message: sendError?.message || "Failed to send OTP. Please try again.",
        success: false,
      });
    }
  } catch (error) {
    console.error("Send email OTP error:", error);
    return res.status(500).json({
      message: "Error sending OTP",
      success: false,
      error: error.message,
    });
  }
};

// ================= STEP 2: VERIFY EMAIL OTP =================
export const verifyEmailOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const normalizedOtp = normalizeOtp(otp);

    if (!email || !normalizedOtp) {
      return res
        .status(400)
        .json({ message: "Email and OTP are required", success: false });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!/^\d{6}$/.test(normalizedOtp)) {
      return res.status(400).json({ message: "Invalid OTP", success: false });
    }

    const storedData = emailOTPStore.get(normalizedEmail);

    if (!storedData) {
      return res.status(400).json({
        message: "No OTP found. Please request a new OTP.",
        success: false,
      });
    }

    if (Date.now() > storedData.expiresAt) {
      emailOTPStore.delete(normalizedEmail);
      return res.status(400).json({
        message: "OTP has expired. Please request a new OTP.",
        success: false,
      });
    }

    if (String(storedData.otp) !== normalizedOtp) {
      return res.status(400).json({ message: "Invalid OTP", success: false });
    }

    let userVerification = verifiedUsersStore.get(normalizedEmail);
    if (!userVerification) {
      userVerification = {
        isEmailVerified: true,
        isPhoneVerified: false,
        expiresAt: Date.now() + 60 * 60 * 1000,
      };
    } else {
      userVerification.isEmailVerified = true;
    }

    verifiedUsersStore.set(normalizedEmail, userVerification);
    emailOTPStore.delete(normalizedEmail);

    const emailVerificationToken = jwt.sign(
      { email: normalizedEmail, purpose: EMAIL_VERIFICATION_PURPOSE },
      process.env.ACCESS_SECRET,
      { expiresIn: "1h" },
    );

    return res.status(200).json({
      message: "Email verified successfully. You can now complete registration.",
      success: true,
      email: normalizedEmail,
      emailVerificationToken,
      nextStep: "complete_registration",
    });
  } catch (error) {
    console.error("Verify email OTP error:", error);
    return res.status(500).json({
      message: "Error verifying OTP",
      success: false,
      error: error.message,
    });
  }
};

// ================= STEP 3: SEND PHONE OTP =================
export const sendPhoneOTP = async (req, res) => {
  try {
    const { phoneNumber, email, phoneCountryCode } = req.body;

    if (!phoneNumber) {
      return res
        .status(400)
        .json({ message: "Phone number is required", success: false });
    }

    let userEmail = email;
    let userVerification = null;

    if (userEmail) {
      userVerification = verifiedUsersStore.get(userEmail);
    } else {
      for (const [email, data] of verifiedUsersStore.entries()) {
        if (data.isEmailVerified && !data.isPhoneVerified) {
          userEmail = email;
          userVerification = data;
          break;
        }
      }
    }

    if (!userVerification || !userVerification.isEmailVerified) {
      return res.status(400).json({
        message: "Please verify your email first.",
        success: false,
        requiresEmailFirst: true,
      });
    }

    const normalizedPhone = normalizePhoneNumber(phoneNumber, phoneCountryCode);

    if (!normalizedPhone.isValid) {
      return res
        .status(400)
        .json({ message: "Enter a valid phone number", success: false });
    }

    const existingUser = await User.findOne({
      phoneNumber: { $in: normalizedPhone.duplicateValues },
    });
    if (existingUser) {
      return res
        .status(409)
        .json({ message: "Phone number already registered", success: false });
    }

    const formattedPhone = normalizedPhone.formatted;
    const smsPhone = normalizedPhone.smsFormatted;
    const otp = otpService.generateOTP();

    console.log(`📱 Sending Phone OTP to ${smsPhone}: ${otp}`);

    userVerification.phoneNumber = formattedPhone;
    userVerification.formattedPhone = formattedPhone;
    userVerification.phoneCountryCode = normalizedPhone.countryCode;
    verifiedUsersStore.set(userEmail, userVerification);

    phoneOTPStore.set(userEmail, {
      otp,
      phoneNumber: formattedPhone,
      formattedPhone,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
    const isTwilioConfigured = Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      twilioPhoneNumber,
    );

    if (!isTwilioConfigured && process.env.NODE_ENV !== "production") {
      console.warn(
        "Twilio is not configured. Returning OTP in development response only.",
      );
      return res.status(200).json({
        message: "Phone OTP generated in development mode",
        success: true,
        phoneNumber: formattedPhone,
        phoneCountryCode: normalizedPhone.countryCode,
        email: userEmail,
        devOtp: otp,
      });
    }

    if (!isTwilioConfigured) {
      phoneOTPStore.delete(userEmail);
      userVerification.phoneNumber = undefined;
      userVerification.formattedPhone = undefined;
      verifiedUsersStore.set(userEmail, userVerification);

      return res.status(503).json({
        message: "SMS service is not configured. Please contact support.",
        success: false,
      });
    }

    try {
      const twilioModule = await import("twilio");
      const twilio = twilioModule.default || twilioModule;
      const twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN,
      );

      await twilioClient.messages.create({
        body: `Your verification code is: ${otp}. This code will expire in 10 minutes.`,
        from: twilioPhoneNumber,
        to: smsPhone,
      });

      return res.status(200).json({
        message: "Phone OTP sent successfully",
        success: true,
        phoneNumber: formattedPhone,
        phoneCountryCode: normalizedPhone.countryCode,
        email: userEmail,
      });
    } catch (sendError) {
      phoneOTPStore.delete(userEmail);
      userVerification.phoneNumber = undefined;
      userVerification.formattedPhone = undefined;
      verifiedUsersStore.set(userEmail, userVerification);

      console.error("Phone OTP sending error:", {
        code: sendError?.code,
        message: sendError?.message,
        moreInfo: sendError?.moreInfo,
      });

      if (sendError?.code === 21211) {
        return res.status(400).json({
          message: "Invalid phone number format.",
          success: false,
        });
      }

      if (sendError?.code === 21608) {
        return res.status(400).json({
          message:
            "Phone number is not verified for your Twilio trial account. Verify this number in Twilio console or use a paid account.",
          success: false,
        });
      }

      if (sendError?.code === 20003) {
        return res.status(502).json({
          message:
            "Twilio authentication failed. Please verify SMS credentials.",
          success: false,
        });
      }

      return res.status(502).json({
        message: "Failed to send phone OTP via SMS provider.",
        success: false,
      });
    }
  } catch (error) {
    console.error("Send phone OTP error:", error);
    return res.status(500).json({
      message: "Error sending phone OTP",
      success: false,
      error: error.message,
    });
  }
};

// ================= STEP 4: VERIFY PHONE OTP =================
// export const verifyPhoneOTP = async (req, res) => {
//     try {
//         const { phoneNumber, otp, email } = req.body;

//         if (!phoneNumber || !otp) {
//             return res.status(400).json({ message: "Phone number and OTP are required", success: false });
//         }

//         const cleanedPhone = phoneNumber.replace(/\D/g, '');
//         let foundEmail = email;
//         let storedData = null;

//         if (foundEmail) {
//             storedData = phoneOTPStore.get(foundEmail);
//             if (storedData && storedData.phoneNumber !== cleanedPhone) storedData = null;
//         }

//         if (!storedData) {
//             for (const [email, data] of phoneOTPStore.entries()) {
//                 if (data.phoneNumber === cleanedPhone && Date.now() <= data.expiresAt) {
//                     foundEmail = email;
//                     storedData = data;
//                     break;
//                 }
//             }
//         }

//         if (!storedData) {
//             return res.status(400).json({ message: "No OTP found. Please request a new OTP.", success: false });
//         }

//         if (Date.now() > storedData.expiresAt) {
//             phoneOTPStore.delete(foundEmail);
//             return res.status(400).json({ message: "OTP has expired. Please request a new OTP.", success: false });
//         }

//         if (storedData.otp !== otp) {
//             return res.status(400).json({ message: "Invalid OTP", success: false });
//         }

//         const userVerification = verifiedUsersStore.get(foundEmail);
//         if (userVerification) {
//             userVerification.isPhoneVerified = true;
//             userVerification.phoneNumber = cleanedPhone;
//             userVerification.formattedPhone = storedData.formattedPhone;
//             verifiedUsersStore.set(foundEmail, userVerification);
//         }

//         phoneOTPStore.delete(foundEmail);

//         return res.status(200).json({
//             message: "Phone verified successfully. You can now complete your registration.",
//             success: true,
//             email: foundEmail,
//             nextStep: "complete_registration"
//         });

//     } catch (error) {
//         console.error("Verify phone OTP error:", error);
//         return res.status(500).json({ message: "Error verifying phone OTP", success: false, error: error.message });
//     }
// };

// ================= STEP 4: VERIFY PHONE OTP =================
export const verifyPhoneOTP = async (req, res) => {
  try {
    const { phoneNumber, otp, email, phoneCountryCode } = req.body;

    if (!phoneNumber || !otp) {
      return res
        .status(400)
        .json({ message: "Phone number and OTP are required", success: false });
    }

    const normalizedPhone = normalizePhoneNumber(phoneNumber, phoneCountryCode);
    if (!normalizedPhone.isValid) {
      return res
        .status(400)
        .json({ message: "Enter a valid phone number", success: false });
    }
    const cleanedPhone = normalizedPhone.formatted;
    let foundEmail = email;
    let storedData = null;

    if (foundEmail) {
      storedData = phoneOTPStore.get(foundEmail);
      if (storedData && storedData.phoneNumber !== cleanedPhone)
        storedData = null;
    }

    if (!storedData) {
      for (const [email, data] of phoneOTPStore.entries()) {
        if (data.phoneNumber === cleanedPhone && Date.now() <= data.expiresAt) {
          foundEmail = email;
          storedData = data;
          break;
        }
      }
    }

    if (!storedData) {
      return res.status(400).json({
        message: "No OTP found. Please request a new OTP.",
        success: false,
      });
    }

    if (Date.now() > storedData.expiresAt) {
      phoneOTPStore.delete(foundEmail);
      return res.status(400).json({
        message: "OTP has expired. Please request a new OTP.",
        success: false,
      });
    }

    if (storedData.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP", success: false });
    }

    const userVerification = verifiedUsersStore.get(foundEmail);
    if (userVerification) {
      userVerification.isPhoneVerified = true;
      userVerification.phoneNumber = cleanedPhone;
      userVerification.formattedPhone = storedData.formattedPhone;
      userVerification.phoneCountryCode = normalizedPhone.countryCode;
      verifiedUsersStore.set(foundEmail, userVerification);

      // DEBUG: Log the verification status
      console.log(`✅ Phone verified for ${foundEmail}`);
      console.log(`Verification data:`, {
        isEmailVerified: userVerification.isEmailVerified,
        isPhoneVerified: userVerification.isPhoneVerified,
        expiresAt: new Date(userVerification.expiresAt),
      });
    } else {
      // If no verification entry exists, create one
      verifiedUsersStore.set(foundEmail, {
        isEmailVerified: false, // This should have been set in email verification
        isPhoneVerified: true,
        phoneNumber: cleanedPhone,
        formattedPhone: storedData.formattedPhone,
        phoneCountryCode: normalizedPhone.countryCode,
        expiresAt: Date.now() + 60 * 60 * 1000,
      });
      console.log(
        `⚠️ Created new verification entry for ${foundEmail} (email verification missing)`,
      );
    }

    phoneOTPStore.delete(foundEmail);

    return res.status(200).json({
      message:
        "Phone verified successfully. You can now complete your registration.",
      success: true,
      email: foundEmail,
      nextStep: "complete_registration",
    });
  } catch (error) {
    console.error("Verify phone OTP error:", error);
    return res.status(500).json({
      message: "Error verifying phone OTP",
      success: false,
      error: error.message,
    });
  }
};
// controllers/authController.js

// ================= STEP 5: COMPLETE REGISTRATION =================
export const completeRegistration = async (req, res) => {
  try {
    // The role selector is authoritative; professional fields cannot distinguish
    // doctors from counsellors and must never decide the account's role.
    const role = normalizeRole(req.body.role ?? req.body.accountRole ?? "");
    if (!["user", "counsellor", "doctor"].includes(role)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ROLE",
        message: "Select a valid registration role: user, counsellor or doctor.",
      });
    }
    if (req.body.accountRole != null && normalizeRole(req.body.accountRole) !== role) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ROLE",
        message: "Registration roles do not match. Please select your role again.",
      });
    }
    const {
      fullName,
      anonymous,
      email,
      phoneNumber,
      phoneCountryCode,
      password,
      age,
      gender,
      qualification,
      specialization,
      experience,
      location,
      consultationMode,
      languages,
      aboutMe,
      // NEW: Patient profile fields (optional)
      dateOfBirth,
      bloodGroup,
      address,
      emergencyContact,
      medicalInfo,
      insuranceInfo,
      emailVerificationToken,
    } = req.body;

    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!fullName || !normalizedEmail || !phoneNumber || !password) {
      return res.status(400).json({
        message: "Full name, email, phone number, and password are required",
        success: false,
      });
    }

    const cleanedPhone = normalizePhoneNumber(phoneNumber, phoneCountryCode);
    if (!cleanedPhone.isValid) {
      return res.status(400).json({
        message: "Enter a valid phone number",
        success: false,
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters",
        success: false,
      });
    }

    // DEBUG: Check what's in verifiedUsersStore
    console.log(`🔍 Checking verification for email: ${email}`);
    // console.log(`All verified users:`, Array.from(verifiedUsersStore.keys()));

    const userVerification = verifiedUsersStore.get(normalizedEmail);
    let hasVerifiedEmailToken = false;

    if (emailVerificationToken) {
      try {
        const decoded = jwt.verify(
          emailVerificationToken,
          process.env.ACCESS_SECRET,
        );
        hasVerifiedEmailToken =
          decoded?.purpose === EMAIL_VERIFICATION_PURPOSE &&
          decoded?.email === normalizedEmail;
      } catch (_error) {
        hasVerifiedEmailToken = false;
      }
    }

    // DEBUG: Log verification status
    if (userVerification) {
      console.log(`Verification data for ${email}:`, {
        isEmailVerified: userVerification.isEmailVerified,
        isPhoneVerified: userVerification.isPhoneVerified,
        expiresAt: new Date(userVerification.expiresAt),
        now: new Date(),
        isExpired: Date.now() > userVerification.expiresAt,
      });
    } else {
      console.log(`❌ No verification data found for ${email}`);
    }

    // Check if verification exists and is complete
    if (!hasVerifiedEmailToken && !userVerification) {
      return res.status(400).json({
        message: "Please verify your email first. No verification session found.",
        success: false,
      });
    }

    // Check if verification has expired
    if (
      !hasVerifiedEmailToken &&
      Date.now() > userVerification.expiresAt
    ) {
      verifiedUsersStore.delete(normalizedEmail);
      return res.status(400).json({
        message:
          "Verification session has expired. Please restart the registration process.",
        success: false,
      });
    }

    // Phone OTP is intentionally not required. The submitted phone number is
    // validated here and protected by the database unique index.
    if (!hasVerifiedEmailToken && !userVerification.isEmailVerified) {
      return res.status(400).json({
        message: "Please verify your email first",
        success: false,
        missingVerifications: ["email"],
        status: {
          isEmailVerified: userVerification.isEmailVerified,
        },
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { email: normalizedEmail },
        { phoneNumber: { $in: cleanedPhone.duplicateValues } },
      ],
    });

    if (existingUser) {
      verifiedUsersStore.delete(normalizedEmail);
      return res.status(409).json({
        message: "User already exists with this email or phone number",
        success: false,
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const dob = getAgeFromDateOfBirth(dateOfBirth);
    if (!dob.valid) {
      return res.status(400).json({
        message: "Select a valid date of birth.",
        success: false,
        field: "dateOfBirth",
      });
    }
    const derivedAge = dob.age ?? (age !== undefined && age !== "" ? Number(age) : null);

    // Base user data (common for both roles)
    const userData = {
      fullName,
      anonymous,
      email: normalizedEmail,
      password: hashedPassword,
      phoneNumber: cleanedPhone.formatted,
      phoneCountryCode: cleanedPhone.countryCode,
      age: Number.isFinite(derivedAge) ? derivedAge : null,
      gender: gender || "male",
      role,
      profileCompleted: true,
      isEmailVerified: true,
      isPhoneVerified: false,
      isActive: true,
      // The 2dsphere index requires a complete GeoJSON Point. Without this,
      // the schema default creates { type: "Point" } without coordinates and
      // MongoDB rejects the insert during registration.
      locationData: {
        current: { type: "Point", coordinates: [0, 0] },
        history: [],
      },
      // NEW: Add patient profile fields (will be null/empty for counsellors initially)
      dateOfBirth: dob.date,
      bloodGroup: bloodGroup || null,
      address: address || {
        line1: "",
        line2: "",
        city: "",
        state: "",
        pincode: "",
        country: "India",
      },
      emergencyContact: emergencyContact || {
        name: "",
        relation: "",
        phone: "",
      },
      medicalInfo: medicalInfo || {
        height: "",
        weight: "",
        allergies: [],
        chronicConditions: [],
        currentMedications: [],
      },
      insuranceInfo: insuranceInfo || {
        provider: "",
        policyNumber: "",
        groupNumber: "",
        coverageAmount: "",
        validityDate: null,
        nominee: "",
        relationship: "",
        insuranceType: "",
      },
    };

    // Profile photo handling.
    //
    // Multer + CloudinaryStorage already uploaded the file to Cloudinary by
    // the time we reach this controller — req.file.path is the secure URL
    // and req.file.filename is the public_id. We just need to persist them
    // on the user. (Old code re-uploaded via req.file.buffer, which doesn't
    // exist with CloudinaryStorage, so the upload always failed silently or
    // returned "Invalid file data".)
    //
    // Photo is allowed for BOTH roles — patients can add one too if the UI
    // collects it; we just don't require it.
    if (req.file && req.file.path) {
      userData.profilePhoto = {
        url: req.file.path,
        publicId: req.file.filename,
      };
      console.log(
        `[completeRegistration] Profile photo saved for ${role}: ${req.file.path}`,
      );
    }

    // Both professional roles retain their submitted professional profile.
    if (["counsellor", "doctor"].includes(role)) {
      userData.qualification = qualification;
      userData.specialization =
        typeof specialization === "string"
          ? specialization.split(",").map((s) => s.trim())
          : specialization;
      userData.experience = Number(experience);
      userData.location = location;
      userData.consultationMode =
        typeof consultationMode === "string"
          ? consultationMode.split(",").map((m) => m.trim())
          : consultationMode || ["online"];
      userData.languages =
        typeof languages === "string"
          ? languages.split(",").map((l) => l.trim())
          : languages || [];
      userData.aboutMe = aboutMe || "";
    }

    const newUser = await User.create(userData);

    // Clean up verification data
    verifiedUsersStore.delete(normalizedEmail);
    emailOTPStore.delete(normalizedEmail);
    phoneOTPStore.delete(normalizedEmail);

    return res.status(201).json({
      message: "Registration completed successfully. Please log in.",
      success: true,
      user: newUser.toJSON(),
      role: newUser.role,
      requiresLogin: true,
    });
  } catch (error) {
    console.error("Complete registration error:", error);

    if (error?.code === 11000) {
      const duplicateField = error?.keyPattern?.phoneNumber
        ? "phone number"
        : "email";
      return res.status(409).json({
        message: `User already exists with this ${duplicateField}`,
        success: false,
      });
    }

    // Rollback: Delete uploaded photo from Cloudinary if registration fails
    if (req.file && profilePhotoData && profilePhotoData.publicId) {
      try {
        await deleteFromCloudinary(profilePhotoData.publicId);
        console.log(
          `Rollback: Deleted uploaded photo ${profilePhotoData.publicId}`,
        );
      } catch (deleteError) {
        console.error("Error rolling back photo upload:", deleteError);
      }
    }

    return res.status(500).json({
      message: "Error completing registration",
      success: false,
      error: error.message,
    });
  }
};

/// ================= LOGIN USER (One‑device policy – now only *detect*) =================
const WEB_SESSION_STALE_MS = Math.max(
  60_000,
  Number(process.env.WEB_SESSION_STALE_MS) || 120_000,
);

const expireStaleLoginSessions = async (userId) => {
  const staleBefore = new Date(Date.now() - WEB_SESSION_STALE_MS);
  return Session.updateMany(
    {
      userId,
      isActive: true,
      $or: [
        { lastActivityAt: { $lt: staleBefore } },
        {
          lastActivityAt: { $exists: false },
          updatedAt: { $lt: staleBefore },
        },
      ],
    },
    { $set: { isActive: false, logoutAt: new Date() } },
  );
};

export const loginUser = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const { password } = req.body;
    // "auto" means the frontend does not want to enforce a role — use DB role.
    const rawRole = req.body?.role;
    const requestedRole =
      rawRole && rawRole !== "auto" ? normalizeRole(rawRole) : null;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
        success: false,
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password",
        success: false,
      });
    }

    if (requestedRole && normalizeRole(user.role) !== requestedRole) {
      return res.status(403).json({
        message:
          normalizeRole(user.role) === "counsellor"
            ? "This account is registered as a counsellor. Please use counsellor login."
            : "This account is registered as a user. Please use user login.",
        success: false,
        roleMismatch: true,
        code: "ROLE_MISMATCH",
        actualRole: user.role,
        requestedRole,
      });
    }

    if (!user.isActive) {
      return res
        .status(401)
        .json({ message: "Account is deactivated", success: false });
    }

    if (!user.password || typeof user.password !== "string") {
      return res.status(401).json({
        message: "No password set for this account. Please use OTP or Google login.",
        success: false,
      });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res
        .status(401)
        .json({ message: "Invalid password", success: false });
    }

    // A browser may close without completing /logout. Expire sessions whose
    // heartbeat stopped before applying the one-device policy.
    await expireStaleLoginSessions(user._id);

    // ---- One-device policy: detect any *live* active session ----
    const activeSession = await Session.findOne({
      userId: user._id,
      isActive: true,
    });

    if (activeSession) {
      // Do NOT log the user out here – just tell the client what to do
      return res.status(409).json({
        message: "Already login",
        needLogout: true, // client can use this flag to show the modal
        success: false,
      });
    }

    // ---- No other session → normal login ----
    const sessionId = generateObjectId();
    const accessToken = generateAccessToken(
      user._id,
      sessionId,
      user.role,
    );
    const refreshToken = generateRefreshToken(
      user._id,
      sessionId,
      user.role,
    );

    // Persist the new session with the same id embedded in JWTs
    await Session.create({
      _id: sessionId,
      userId: user._id,
      refreshToken,
      isActive: true,
      lastActivityAt: new Date(),
    });
    await markUserOnline(user);

    // Optional: if client sends GPS on login, store it (and append history event=login)
    await saveLoginLocationIfProvided({ req, userId: user._id });

    // Set cookies (keep your existing options)
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 15 * 60 * 1000,
    });
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      message: "Login successful",
      success: true,
      accessToken,
      refreshToken,
      user: user.toJSON(),
      role: user.role,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      message: "Error in login",
      success: false,
      error: error.message,
    });
  }
};

// ================= GOOGLE OAUTH (Sign-up + Login in one endpoint) =================
// Frontend sends Google ID token (from Google Sign-In SDK).
// Flow:
//   1. Verify token with Google
//   2. If user with email exists → auto-merge (set googleId if missing, log them in)
//   3. If new email → create account (email auto-verified, phone optional, profile incomplete)
//   4. Enforce one-device policy (same as /login)
export const googleAuth = async (req, res) => {
  try {
    const { idToken, role } = req.body;

    if (!idToken) {
      return res.status(400).json({
        message: "Google idToken is required",
        success: false,
      });
    }

    // Every Google signup/login must identify its portal before any account or
    // session is created. Missing/auto roles must not bypass this boundary.
    const rawRole = role == null ? "" : normalizeRole(role);
    const requestedRole = rawRole === "consultant" ? "counsellor" : rawRole;
    if (!["user", "counsellor", "doctor"].includes(requestedRole)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ROLE",
        message: "Select a valid login role: user, counsellor or doctor.",
      });
    }

    // 1. Verify the Google ID token
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (verifyErr) {
      console.error("Google token verify failed:", verifyErr.message);
      return res.status(401).json({
        message: "Invalid Google token",
        success: false,
      });
    }

    if (!payload || !payload.email || !payload.sub) {
      return res.status(401).json({
        message: "Google token did not contain a valid identity and email",
        success: false,
      });
    }

    if (!payload.email_verified) {
      return res.status(401).json({
        message: "Google email is not verified",
        success: false,
      });
    }

    const email = payload.email.trim().toLowerCase();
    const googleId = payload.sub;
    const fullName = payload.name || email.split("@")[0];
    const picture = payload.picture || null;

    // 2. Look up existing user.
    //
    // SECURITY: Google identity is the `sub` (googleId), NOT the email. A
    // user can change their backend email from the dashboard, which means
    // the email in our DB and the email from this Google payload can drift.
    // If we used `$or: [{ email }, { googleId }]` naively, two failure modes
    // appear:
    //   (a) User signs up via Google as a@gmail.com, later changes their
    //       backend email to b@yahoo.com. Signing in again with the same
    //       Google account works (googleId matches) — but their backend
    //       email is no longer the Google email. That's expected.
    //   (b) Worse: a stranger owns a Google account for b@yahoo.com. They
    //       click "Sign in with Google" and Google sends us their sub
    //       (some other googleId) with email=b@yahoo.com. The naive query
    //       matches our existing record by email and we silently log the
    //       stranger into someone else's account.
    //
    // Fix: resolve by googleId first. Only fall back to email match when no
    // googleId record exists, and even then refuse if the matched record is
    // already bound to a *different* googleId.
    let user = await User.findOne({ googleId });

    if (!user) {
      const byEmail = await User.findOne({ email });
      if (byEmail) {
        if (byEmail.googleId && byEmail.googleId !== googleId) {
          // The email belongs to an account already linked to a different
          // Google identity. Do not merge — that would let any Google user
          // who happens to know this email take over the account.
          return res.status(409).json({
            message:
              "This email is associated with a different Google account. Please sign in with the original Google account.",
            success: false,
            code: "GOOGLE_ID_MISMATCH",
          });
        }
        user = byEmail;
      }
    }

    if (user) {
      // Reject cross-role login before linking Google or changing any sessions.
      if (normalizeRole(user.role) !== requestedRole) {
        return res.status(403).json({
          message: `This Google account is registered as ${user.role}. Please pick the ${user.role} role and try again.`,
          success: false,
          code: "ROLE_MISMATCH",
          actualRole: user.role,
          requestedRole,
        });
      }

      // Auto-merge: existing local account (no googleId yet), link Google.
      if (!user.googleId) {
        user.googleId = googleId;
        // Don't overwrite authProvider for existing local users — they can use both.
        // Patient users stay avatar-only, so Google pictures are never copied.
        if (user.role !== "user" && !user.profilePhoto?.url && picture) {
          user.profilePhoto = { url: picture, publicId: null };
        }
        await user.save();
      }

      // Track the last-seen Google email for this identity.
      // If the user previously mirrored their Google email in their profile,
      // keep it synced when Google changes. If they manually customized their
      // profile email, don't overwrite it on login.
      const currentEmail = String(user.email || "").toLowerCase();
      const previousGoogleEmail = String(user.googleEmail || "").toLowerCase();
      const shouldSyncProfileEmail =
        user.authProvider === "google" &&
        (!previousGoogleEmail || currentEmail === previousGoogleEmail);

      if (user.googleId === googleId && email) {
        user.googleEmail = email;

        if (shouldSyncProfileEmail && currentEmail !== email) {
          const taken = await User.findOne({ email, _id: { $ne: user._id } });
          if (taken) {
            return res.status(409).json({
              success: false,
              code: "EMAIL_IN_USE",
              message:
                "Your Google email is already in use by another account. Please contact support.",
            });
          }
          user.email = email;
          user.isEmailVerified = true;
        }

        await user.save();
      }

      if (!user.isActive) {
        return res
          .status(401)
          .json({ message: "Account is deactivated", success: false });
      }
    } else {
      // 3. Create new account from Google profile
      const newUserData = {
        fullName,
        email,
        googleEmail: email,
        googleId,
        authProvider: "google",
        role: requestedRole,
        isEmailVerified: true,
        isActive: true,
        profileCompleted: false, // user still needs to add phone, age, etc.
        // The geo index rejects a Point subdoc without coordinates, but the
        // schema sets type="Point" by default. Initialize with [0,0] so insert
        // succeeds; real coordinates land here when the client sends GPS.
        locationData: {
          current: { type: "Point", coordinates: [0, 0] },
          history: [],
        },
      };

      if (requestedRole !== "user" && picture) {
        newUserData.profilePhoto = { url: picture, publicId: null };
      }

      user = await User.create(newUserData);
    }

    // 4. One-device policy — Google variant.
    //
    // For local /login we return 409 "Already login" and force the user
    // through an email-OTP confirmation before killing the other device's
    // session, because email+password alone shouldn't let someone bump an
    // existing session (the password could be stolen).
    //
    // Google auth is different: Google has already cryptographically
    // verified the user's identity (we just verified the ID token above).
    // Requiring an extra OTP on top of that is redundant friction. So
    // here we silently terminate any other active sessions and proceed
    // to issue a fresh one — same end state as local login + OTP, just
    // without the extra round-trip.
    await Session.updateMany(
      { userId: user._id, isActive: true },
      { $set: { isActive: false, logoutAt: new Date() } },
    );

    // 5. Create new session + tokens
    const sessionId = generateObjectId();
    const accessToken = generateAccessToken(
      user._id,
      sessionId,
      user.role,
    );
    const refreshToken = generateRefreshToken(
      user._id,
      sessionId,
      user.role,
    );

    await Session.create({
      _id: sessionId,
      userId: user._id,
      refreshToken,
      isActive: true,
    });
    await markUserOnline(user);

    // Optional: capture login location if GPS sent in body
    await saveLoginLocationIfProvided({ req, userId: user._id });

    // 6. Cookies (same options as /login)
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 15 * 60 * 1000,
    });
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      message: user.profileCompleted
        ? "Login successful"
        : "Account created. Please complete your profile.",
      success: true,
      accessToken,
      refreshToken,
      user: user.toJSON(),
      role: user.role,
      profileCompleted: user.profileCompleted,
      isNewUser: !user.profileCompleted,
    });
  } catch (error) {
    console.error("Google auth error:", error);
    return res.status(500).json({
      message: "Error during Google authentication",
      success: false,
      error: error.message,
    });
  }
};

// ================= GOOGLE RE-LINK (Change linked Google account) =================
// Requires the user to be logged in already (old account). Client sends a NEW
// Google ID token; we verify it and re-bind googleId (sub) to this user.
export const relinkGoogleAccount = async (req, res) => {
  try {
    const currentUser = req.user;
    if (!currentUser) {
      return res
        .status(401)
        .json({ success: false, message: "User not authenticated" });
    }

    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: "Google idToken is required",
      });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (verifyErr) {
      console.error("Google token verify failed (relink):", verifyErr.message);
      return res.status(401).json({
        success: false,
        message: "Invalid Google token",
      });
    }

    if (!payload?.sub || !payload?.email) {
      return res.status(401).json({
        success: false,
        message: "Google token did not contain required fields",
      });
    }

    if (!payload.email_verified) {
      return res.status(401).json({
        success: false,
        message: "Google email is not verified",
      });
    }

    const newGoogleId = String(payload.sub);
    const newGoogleEmail = String(payload.email).trim().toLowerCase();

    // If this Google identity is already linked to some other account, block.
    const alreadyLinked = await User.findOne({
      googleId: newGoogleId,
      _id: { $ne: currentUser._id },
    }).select("_id");

    if (alreadyLinked) {
      return res.status(409).json({
        success: false,
        code: "GOOGLE_ALREADY_LINKED",
        message:
          "This Google account is already linked to another user. Please sign in to that account instead.",
      });
    }

    // Update bindings for this user.
    const user = await User.findById(currentUser._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const previousGoogleEmail = String(user.googleEmail || "").toLowerCase();
    const currentEmail = String(user.email || "").toLowerCase();
    const shouldSyncProfileEmail =
      user.authProvider === "google" &&
      (!previousGoogleEmail || currentEmail === previousGoogleEmail);

    user.googleId = newGoogleId;
    user.googleEmail = newGoogleEmail;

    if (shouldSyncProfileEmail && currentEmail !== newGoogleEmail) {
      const taken = await User.findOne({
        email: newGoogleEmail,
        _id: { $ne: user._id },
      }).select("_id");
      if (taken) {
        return res.status(409).json({
          success: false,
          code: "EMAIL_IN_USE",
          message:
            "Your Google email is already in use by another account. Please contact support.",
        });
      }
      user.email = newGoogleEmail;
      user.isEmailVerified = true;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Google account linked successfully",
      user: user.toJSON(),
    });
  } catch (error) {
    console.error("relinkGoogleAccount error:", error);
    return res.status(500).json({
      success: false,
      message: "Error linking Google account",
      error: error.message,
    });
  }
};

export const sendUnlinkGoogleOtp = async (req, res) => {
  try {
    const currentUser = req.user;
    if (!currentUser) {
      return res
        .status(401)
        .json({ success: false, message: "User not authenticated" });
    }

    const user = await User.findById(currentUser._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (!user.googleId) {
      return res.status(400).json({
        success: false,
        code: "NOT_LINKED",
        message: "This account is not linked to Google.",
      });
    }

    // Safety: unlinking would lock out users who don't have a password.
    if (!user.password) {
      return res.status(400).json({
        success: false,
        code: "PASSWORD_REQUIRED",
        message:
          "Set a password first before unlinking Google, otherwise you may not be able to log in.",
      });
    }
    if (!user.phoneNumber) {
      return res.status(400).json({
        success: false,
        code: "PHONE_REQUIRED",
        message:
          "Add a phone number first before unlinking Google, otherwise you may not be able to log in.",
      });
    }

    const email = String(user.email || "").toLowerCase();
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required on the account to send OTP",
      });
    }

    const otp = otpService.generateOTP(email);
    unlinkGoogleOTPStore.set(String(user._id), {
      otp,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    await otpService.sendLoginOTP(email, otp);

    const devOtp =
      process.env.NODE_ENV !== "production" ? { devOtp: otp } : {};

    return res.status(200).json({
      success: true,
      message: `OTP sent to ${email}`,
      ...devOtp,
    });
  } catch (err) {
    console.error("sendUnlinkGoogleOtp error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const unlinkGoogleAccount = async (req, res) => {
  try {
    const currentUser = req.user;
    if (!currentUser) {
      return res
        .status(401)
        .json({ success: false, message: "User not authenticated" });
    }

    const { otp } = req.body;
    if (!otp) {
      return res.status(400).json({ success: false, message: "OTP is required" });
    }

    const user = await User.findById(currentUser._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (!user.googleId) {
      return res.status(400).json({
        success: false,
        code: "NOT_LINKED",
        message: "This account is not linked to Google.",
      });
    }

    if (!user.password) {
      return res.status(400).json({
        success: false,
        code: "PASSWORD_REQUIRED",
        message:
          "Set a password first before unlinking Google, otherwise you may not be able to log in.",
      });
    }
    if (!user.phoneNumber) {
      return res.status(400).json({
        success: false,
        code: "PHONE_REQUIRED",
        message:
          "Add a phone number first before unlinking Google, otherwise you may not be able to log in.",
      });
    }

    const stored = unlinkGoogleOTPStore.get(String(user._id));
    if (!stored) {
      return res.status(400).json({
        success: false,
        message: "No OTP found — request a new one",
      });
    }
    if (Date.now() > stored.expiresAt) {
      unlinkGoogleOTPStore.delete(String(user._id));
      return res.status(400).json({ success: false, message: "OTP expired" });
    }
    if (String(stored.otp) !== String(otp)) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    // Unlink
    user.googleId = undefined;
    user.googleEmail = null;
    user.authProvider = "local";
    await user.save();
    unlinkGoogleOTPStore.delete(String(user._id));

    return res.status(200).json({
      success: true,
      message: "Google account unlinked successfully",
      user: user.toJSON(),
    });
  } catch (err) {
    console.error("unlinkGoogleAccount error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ================= LOGOUT OTHER DEVICES & SEND EMAIL OTP =================
export const logoutOtherDevicesAndSendOTP = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      return res
        .status(400)
        .json({ message: "Email is required", success: false });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(404)
        .json({ message: "User not found", success: false });
    }

    // 1. Generate a short-lived OTP (6 digits)
    const otp = otpService.generateOTP(email);
    console.log(`Generated OTP for ${email}: ${otp} (valid for 10 minutes);`);

    await saveLoginOTP({ userId: user._id, email, otp });

    try {
      await otpService.sendLoginOTP(email, otp);
      console.log(`✅ OTP email sent successfully to ${email}`);
    } catch (emailError) {
      await clearLoginOTP(user._id);
      console.error(
        `❌ Failed to send OTP email to ${email}:`,
        emailError.message,
      );
      return res.status(500).json({
        message: "OTP generated but failed to send email. Please try again.",
        success: false,
        error: emailError.message,
      });
    }

    return res.status(200).json({
      message:
        "OTP sent to your email. Sessions will be logged out after OTP verification.",
      success: true,
      needOtpVerification: true,
      email,
    });
  } catch (err) {
    console.error("❌ logoutOtherDevices error:", err);
    return res
      .status(500)
      .json({ message: "Server error", success: false, error: err.message });
  }
};

// ================= VERIFY LOGIN OTP & CREATE NEW SESSION =================
export const verifyLoginOTP = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || "").trim();
    if (!email || !otp) {
      return res
        .status(400)
        .json({ message: "Email and OTP required", success: false });
    }

    const stored = await getPendingLoginOTP(email);
    if (!stored) {
      return res
        .status(400)
        .json({ message: "No OTP found – request a new one", success: false });
    }

    if (Date.now() > stored.expiresAt.getTime()) {
      await clearLoginOTP(stored.userId);
      return res.status(400).json({ message: "OTP expired", success: false });
    }

    if (String(stored.otp) !== otp) {
      return res.status(400).json({ message: "Invalid OTP", success: false });
    }

    const user = await User.findById(stored.userId);
    if (!user) {
      return res
        .status(404)
        .json({ message: "User not found", success: false });
    }

    // Logout all existing sessions ONLY after OTP verification succeeds
    await Session.updateMany(
      { userId: user._id, isActive: true },
      { $set: { isActive: false, logoutAt: new Date() } },
    );

    // OTP is valid → create a **new** session for this device
    const sessionId = generateObjectId();
    const accessToken = generateAccessToken(
      user._id,
      sessionId,
      user.role,
    );
    const refreshToken = generateRefreshToken(
      user._id,
      sessionId,
      user.role,
    );

    await Session.create({
      _id: sessionId,
      userId: user._id,
      refreshToken,
      isActive: true,
    });
    await markUserOnline(user);

    // Clean up the OTP entry
    await clearLoginOTP(user._id);

    // Optional: if client sends GPS on OTP-login, store it (and append history event=login)
    await saveLoginLocationIfProvided({ req, userId: user._id });

    // Set cookies (same options you use elsewhere)
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 15 * 60 * 1000,
    });
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Return the tokens and user info (useful for Postman or SPA)
    return res.status(200).json({
      message: "Login successful",
      success: true,
      accessToken,
      refreshToken,
      user: user.toJSON(),
      role: user.role,
    });
  } catch (err) {
    console.error("verifyLoginOTP error:", err);
    return res.status(500).json({ message: "Server error", success: false });
  }
};

// ================= REFRESH ACCESS TOKEN =================
export const refreshAccessToken = async (req, res) => {
  try {
    const incomingRefreshToken =
      req.cookies?.refreshToken || req.body?.refreshToken;

    if (!incomingRefreshToken) {
      return res.status(401).json({ message: "No refresh token" });
    }

    let decoded;
    try {
      decoded = jwt.verify(incomingRefreshToken, process.env.REFRESH_SECRET);
    } catch (err) {
      return res.status(401).json({ message: "Invalid refresh token" });
    }

    if (!decoded.sessionId || typeof decoded.sessionId !== "string" || decoded.sessionId.length < 12) {
      return res.status(401).json({ message: "Invalid session" });
    }

    // Find session using sessionId from refresh token
    const session = await Session.findById(decoded.sessionId);

    if (!session || !session.isActive) {
      return res.status(401).json({ message: "Session expired" });
    }

    if (session.refreshToken !== incomingRefreshToken) {
      return res.status(401).json({ message: "Token mismatch" });
    }

    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({ message: "User not found" });
    }

    // ✅ FIXED: Pass sessionId to generateAccessToken
    const newAccessToken = generateAccessToken(user._id, session._id, user.role);
    const newRefreshToken = generateRefreshToken(user._id, session._id, user.role);

    // Update session with new refresh token
    session.refreshToken = newRefreshToken;
    await session.save();
    await markUserOnline(user);

    // Set cookies (for browser clients)
    res.cookie("accessToken", newAccessToken, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    });

    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    });

    // Return both tokens for Postman/frontend
    return res.json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken, // Also return this
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// ================= WEB SESSION HEARTBEAT =================
export const sessionHeartbeat = async (req, res) => {
  try {
    const sessionId = req.sessionId;
    const userId = req.userId || req.user?._id;

    if (!sessionId || !userId) {
      return res.status(401).json({
        success: false,
        message: "Active session not found",
      });
    }

    const result = await Session.updateOne(
      { _id: sessionId, userId, isActive: true },
      { $set: { lastActivityAt: new Date() } },
    );

    if (result.matchedCount === 0) {
      return res.status(401).json({
        success: false,
        message: "Session expired",
      });
    }

    return res.status(204).send();
  } catch (error) {
    console.error("Session heartbeat error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not update session heartbeat",
    });
  }
};

// ================= LOGOUT (FIXED - Properly invalidates session) =================
export const logout = async (req, res) => {
  try {
    // Get userId from request (set by auth middleware)
    let userId = req.userId || req.user?._id;
    const refreshToken = req.cookies?.refreshToken;

    // console.log("🔓 Logout - UserId from request:", userId);
    // console.log("🔓 Logout - Refresh token present:", !!refreshToken);

    // If no userId but we have refresh token, try to decode it
    if (!userId && refreshToken) {
      try {
        const decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET);
        userId = decoded.userId;
        console.log(
          "✅ Got userId from refresh token in logout function:",
          userId,
        );
      } catch (error) {
        console.log("⚠️ Could not decode refresh token:", error.message);
      }
    }

    // Invalidate session(s)
    if (userId) {
      if (refreshToken) {
        // Invalidate the specific session with this refresh token
        const result = await Session.updateOne(
          { userId, refreshToken, isActive: true },
          { isActive: false, logoutAt: new Date() },
        );

        if (result.modifiedCount === 0) {
          // If no specific session found, invalidate all active sessions for this user
          const allResult = await Session.updateMany(
            { userId, isActive: true },
            { isActive: false, logoutAt: new Date() },
          );
          console.log(
            `✅ All ${allResult.modifiedCount} sessions invalidated for user: ${userId}`,
          );
        } else {
          console.log(`✅ Specific session invalidated for user: ${userId}`);
        }
      } else {
        // No refresh token provided, invalidate ALL active sessions
        const result = await Session.updateMany(
          { userId, isActive: true },
          { isActive: false, logoutAt: new Date() },
        );
        console.log(
          `✅ All ${result.modifiedCount} sessions invalidated for user: ${userId}`,
        );
      }
    } else {
      console.log("⚠️ No userId found, skipping session invalidation");
    }

    await markUserOfflineIfNoActiveSessions(userId);

    // Clear cookies regardless
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
    };

    res.clearCookie("accessToken", cookieOptions);
    res.clearCookie("refreshToken", cookieOptions);

    console.log("✅ Cookies cleared successfully");

    return res.status(200).json({
      message: "Logged out successfully",
      success: true,
    });
  } catch (error) {
    console.error("Logout error:", error);

    // Even on error, try to clear cookies
    try {
      res.clearCookie("accessToken", { path: "/" });
      res.clearCookie("refreshToken", { path: "/" });
    } catch (cookieError) {
      console.error("Error clearing cookies:", cookieError);
    }

    return res.status(500).json({
      message: "Error in logout",
      success: false,
      error: error.message,
    });
  }
};

// ================= LOGOUT =================

// ================= LOGOUT FROM ALL DEVICES =================
export const logoutAllDevices = async (req, res) => {
  try {
    const userId = req.userId || req.user?._id;

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "User not authenticated" });
    }

    await Session.updateMany(
      { userId, isActive: true },
      { isActive: false, logoutAt: new Date() },
    );
    await markUserOfflineIfNoActiveSessions(userId);

    res.clearCookie("accessToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    return res
      .status(200)
      .json({ message: "Logged out from all devices", success: true });
  } catch (error) {
    console.error("Logout all error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error logging out" });
  }
};

// ================= GET ALL SESSIONS =================
export const getMySessions = async (req, res) => {
  try {
    const userId = req.userId || req.user?._id;

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "User not authenticated" });
    }

    const sessions = await Session.find({ userId, isActive: true })
      .select("-refreshToken")
      .sort({ createdAt: -1 });

    return res
      .status(200)
      .json({ success: true, sessions, count: sessions.length });
  } catch (error) {
    console.error("Get sessions error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error fetching sessions" });
  }
};

// ================= GET ALL COUNSELLORS =================
export const getAllCounsellors = async (req, res) => {
  try {
    const { specialization, location, consultationMode, minExperience } =
      req.query;
    let filter = {
      role: { $in: ["counsellor", "doctor"] },
      isActive: true,
      profileCompleted: true,
      "specialization.0": { $exists: true },
      experience: { $gt: 0 },
      location: { $nin: ["", null] },
      $or: [
        { qualification: { $nin: ["", null] } },
        { education: { $nin: ["", null] } },
      ],
    };

    if (specialization) filter.specialization = { $in: [specialization] };
    if (location) filter.location = { $regex: location, $options: "i" };
    if (consultationMode) filter.consultationMode = { $in: [consultationMode] };
    if (minExperience) filter.experience = { $gte: Number(minExperience) };

    const counsellors = await User.find(filter)
      .select("-password")
      .sort({ createdAt: -1 })
      .lean();

    const counsellorIds = counsellors.map((counsellor) => counsellor._id);
    const patientConversationCounts = await Message.aggregate([
      {
        $match: {
          senderId: { $in: counsellorIds },
          senderRole: { $in: ["counsellor", "doctor"] },
        },
      },
      {
        $group: {
          _id: {
            counsellorId: "$senderId",
            chatId: "$chatId",
          },
        },
      },
      {
        $group: {
          _id: "$_id.counsellorId",
          patientConversationCount: { $sum: 1 },
        },
      },
    ]);
    const patientConversationCountByCounsellor = new Map(
      patientConversationCounts.map((item) => [
        String(item._id),
        item.patientConversationCount,
      ]),
    );

    const counsellorsWithLoginStatus = counsellors.map((counsellor) => {
      // A saved login session is not presence. Only a currently connected
      // authenticated socket makes a counselor online in the directory.
      const liveOnline = global.socketHandler?.isUserOnline(counsellor._id) === true;
      return {
        ...counsellor,
        patientConversationCount:
          patientConversationCountByCounsellor.get(String(counsellor._id)) || 0,
        isOnline: liveOnline,
        isLoggedIn: liveOnline,
        hasActiveSession: liveOnline,
        socketOnline: liveOnline,
        presenceStatus: liveOnline ? "online" : "offline",
      };
    });

    return res.status(200).json({
      message: "Counsellors fetched successfully",
      success: true,
      counsellors: counsellorsWithLoginStatus,
      count: counsellorsWithLoginStatus.length,
    });
  } catch (error) {
    console.log("Get counsellors error:", error);
    return res
      .status(500)
      .json({ message: "Error fetching counsellors", success: false });
  }
};

// ================= TEMP DEBUG: check counsellor by email =================
export const debugCounsellorByEmail = async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ message: 'email query required' });
    const user = await User.findOne({ email }).select('fullName email role isActive profileCompleted specialization experience qualification education location googleId');
    if (!user) return res.status(404).json({ message: 'not found' });
    return res.status(200).json({ user });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

// ================= GET SINGLE COUNSELLOR =================
export const getCounsellorById = async (req, res) => {
  try {
    const { counsellorId } = req.params;
    const counsellor = await User.findOne({
      _id: counsellorId,
      role: { $in: ["counsellor", "doctor"] },
      isActive: true,
      profileCompleted: true,
      "specialization.0": { $exists: true },
      experience: { $gt: 0 },
      location: { $nin: ["", null] },
      $or: [
        { qualification: { $nin: ["", null] } },
        { education: { $nin: ["", null] } },
      ],
    });

    if (!counsellor) {
      return res
        .status(404)
        .json({ message: "Counsellor not found", success: false });
    }

    return res.status(200).json({
      message: "Counsellor fetched successfully",
      success: true,
      counsellor: counsellor.toJSON(),
    });
  } catch (error) {
    console.log("Get counsellor error:", error);
    return res
      .status(500)
      .json({ message: "Error fetching counsellor", success: false });
  }
};

// ================= GET MY PROFILE =================

// controllers/profileController.js

// ================= GET COMPLETE PROFILE =================
export const getMyProfile = async (req, res) => {
  try {
    const userId = req.userId || req.user?._id;
    const user = await User.findById(userId).select(
      "-password -emailOTP -phoneOTP",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found",
        success: false,
      });
    }

    const ageFromDateOfBirth = getAgeFromDateOfBirth(user.dateOfBirth);
    // Format the response with all fields including new patient profile fields
    const formattedProfile = {
      // Basic Info
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      phoneCountryCode: user.phoneCountryCode,
      age: ageFromDateOfBirth.age ?? user.age,
      gender: user.gender,
      role: user.role,
      profilePhoto: user.profilePhoto,
      isActive: user.isActive,
      profileCompleted: user.profileCompleted,

      // New Patient Profile Fields
      dateOfBirth: user.dateOfBirth
        ? new Date(user.dateOfBirth).toISOString().split("T")[0]
        : null,
      bloodGroup: user.bloodGroup || null,

      address: user.address || {
        line1: "",
        line2: "",
        city: "",
        state: "",
        pincode: "",
        country: "India",
      },

      emergencyContact: user.emergencyContact || {
        name: "",
        relation: "",
        phone: "",
      },

      medicalInfo: user.medicalInfo || {
        height: "",
        weight: "",
        allergies: [],
        chronicConditions: [],
        currentMedications: [],
      },

      insuranceInfo: user.insuranceInfo || {
        provider: "",
        policyNumber: "",
        groupNumber: "",
        coverageAmount: "",
        validityDate: null,
        nominee: "",
        relationship: "",
        insuranceType: "",
      },
    };

    // Add counsellor-specific fields if user is counsellor
    if (["counsellor", "doctor"].includes(user.role)) {
      formattedProfile.qualification = user.qualification;
      formattedProfile.specialization = user.specialization;
      formattedProfile.experience = user.experience;
      formattedProfile.location = user.location;
      formattedProfile.consultationMode = user.consultationMode;
      formattedProfile.languages = user.languages;
      formattedProfile.aboutMe = user.aboutMe;
      formattedProfile.education = user.education;
      formattedProfile.certifications = user.certifications || [];
      formattedProfile.rating = user.rating || 0;
      formattedProfile.totalSessions = user.totalSessions || 0;
      formattedProfile.activeClients = user.activeClients || 0;
    }

    return res.status(200).json({
      message: "Profile fetched successfully",
      success: true,
      user: formattedProfile,
    });
  } catch (error) {
    console.log("Get profile error:", error);
    return res.status(500).json({
      message: "Error fetching profile",
      success: false,
    });
  }
};

// ================= UPLOAD PROFILE PHOTO =================
export const uploadProfilePhoto = async (req, res) => {
  try {
    const userId = req.user?._id || req.userId;
    const currentUser = await User.findById(userId);

    if (!currentUser) {
      return res.status(404).json({
        message: "User not found",
        success: false,
      });
    }

    // Only counsellors can upload photos (as per your original logic)
    if (currentUser.role !== "counsellor") {
      if (req.file) deleteLocalFile(saveLocalFile(req.file));
      return res.status(403).json({
        message: "Only counsellors can upload photos",
        success: false,
      });
    }

    if (!req.file) {
      return res.status(400).json({
        message: "No file uploaded",
        success: false,
      });
    }

    // Delete old photo if exists
    if (currentUser.profilePhoto) {
      deleteLocalFile(currentUser.profilePhoto);
    }

    // Save new photo
    const photoPath = saveLocalFile(req.file);

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: { profilePhoto: photoPath } },
      { returnDocument: "after" },
    ).select("-password");

    return res.status(200).json({
      message: "Profile photo updated successfully",
      success: true,
      profilePhoto: photoPath,
      user: updatedUser.toJSON(),
    });
  } catch (error) {
    console.error("Photo upload error:", error);
    if (req.file) deleteLocalFile(saveLocalFile(req.file));
    return res.status(500).json({
      message: "Error uploading photo",
      success: false,
      error: error.message,
    });
  }
};

// ================= FORGOT PASSWORD =================
export const forgotPassword = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "No account found with this email" });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");
    user.resetPasswordExpire = Date.now() + 10 * 60 * 1000;
    await user.save();

    const resetUrl = `${req.protocol}://${req.get("host")}/reset-password/${resetToken}`;

    try {
      await sendResetPasswordEmail(user.email, resetUrl, user.fullName);
    } catch (emailError) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save();
      return res
        .status(500)
        .json({ success: false, message: "Error sending reset email" });
    }

    res.status(200).json({
      success: true,
      message: "Password reset instructions sent to your email",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res
      .status(500)
      .json({ success: false, message: "Error processing request" });
  }
};

// ================= RESET PASSWORD =================
export const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
      return res
        .status(400)
        .json({ success: false, message: "Passwords do not match" });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    const resetPasswordToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");
    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired reset token" });
    }

    const isSamePassword = await bcrypt.compare(password, user.password);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: "New password cannot be the same as old password",
      });
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    await Session.updateMany(
      { userId: user._id, isActive: true },
      { isActive: false, logoutAt: new Date() },
    );

    res
      .status(200)
      .json({ success: true, message: "Password reset successful" });
  } catch (error) {
    console.error("Reset password error:", error);
    res
      .status(500)
      .json({ success: false, message: "Error resetting password" });
  }
};

// ================= SET PASSWORD (for accounts without a password, e.g. Google accounts)
export const setPassword = async (req, res) => {
  try {
    const user = req.user;
    const { password } = req.body;

    if (!user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    const freshUser = await User.findById(user._id);
    if (!freshUser) return res.status(404).json({ success: false, message: "User not found" });

    if (freshUser.password) {
      return res.status(400).json({ success: false, message: "Password already set for this account" });
    }

    freshUser.password = await bcrypt.hash(password, 10);
    // Ensure local auth provider is set so user can login with password later
    freshUser.authProvider = "local";
    await freshUser.save();

    return res.status(200).json({ success: true, message: "Password set successfully" });
  } catch (error) {
    console.error("setPassword error:", error);
    return res.status(500).json({ success: false, message: "Error setting password" });
  }
};

// ================= VERIFY PASSWORD OTP (no login/session side effects) =================
export const verifyPasswordOtp = async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    const normalizedEmail = normalizeEmail(email);
    const normalizedOtp = String(otp || "").trim();

    if (!normalizedEmail || !normalizedOtp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required",
      });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const otpDoc = await OTP.findOne({ userId: user._id, otp: normalizedOtp });
    if (!otpDoc) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    if (otpDoc.expiresAt < Date.now()) {
      await OTP.deleteMany({ userId: user._id });
      return res.status(400).json({ success: false, message: "OTP expired" });
    }

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully",
    });
  } catch (error) {
    console.error("verifyPasswordOtp error:", error);
    return res.status(500).json({
      success: false,
      message: "Error verifying OTP",
    });
  }
};

// ================= CHANGE PASSWORD (authenticated) =================
export const changePassword = async (req, res) => {
  try {
    const user = req.user;
    const { oldPassword, newPassword } = req.body;

    if (!user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "New password must be at least 6 characters" });
    }

    const freshUser = await User.findById(user._id).select('+password');
    if (!freshUser) return res.status(404).json({ success: false, message: "User not found" });

    if (!freshUser.password) {
      return res.status(400).json({ success: false, message: "No password set on this account. Use set-password first." });
    }

    const match = await bcrypt.compare(String(oldPassword || ''), freshUser.password);
    if (!match) {
      return res.status(401).json({ success: false, message: "Old password is incorrect" });
    }

    const isSame = await bcrypt.compare(newPassword, freshUser.password);
    if (isSame) {
      return res.status(400).json({ success: false, message: "New password cannot be the same as the old password" });
    }

    freshUser.password = await bcrypt.hash(newPassword, 10);
    await freshUser.save();

    // Invalidate all other active sessions for security
    await Session.updateMany({ userId: freshUser._id, isActive: true }, { isActive: false, logoutAt: new Date() });

    return res.status(200).json({ success: true, message: "Password changed successfully. Please log in again." });
  } catch (error) {
    console.error("changePassword error:", error);
    return res.status(500).json({ success: false, message: "Error changing password" });
  }
};

// ================= SET PASSWORD BY OTP (unauthenticated, uses verifiedUsersStore)
export const setPasswordByOtp = async (req, res) => {
  try {
    const { email, password, otp } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    const normalizedEmail = normalizeEmail(email);
    const verification = verifiedUsersStore.get(normalizedEmail);
    let otpDoc = null;

    if (!verification?.isEmailVerified) {
      if (!otp) {
        return res.status(400).json({ success: false, message: "Email not verified or verification session missing" });
      }

      const otpUser = await User.findOne({ email: normalizedEmail });
      if (!otpUser) {
        return res.status(404).json({ success: false, message: "No user found with this email" });
      }

      otpDoc = await OTP.findOne({ userId: otpUser._id, otp: String(otp) });
      if (!otpDoc) {
        return res.status(400).json({ success: false, message: "Invalid OTP" });
      }
      if (otpDoc.expiresAt < Date.now()) {
        await OTP.deleteMany({ userId: otpUser._id });
        return res.status(400).json({ success: false, message: "OTP expired" });
      }
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ success: false, message: "No user found with this email" });
    }

    const wasPasswordSet = Boolean(user.password);
    if (wasPasswordSet) {
      const isSamePassword = await bcrypt.compare(password, user.password);
      if (isSamePassword) {
        return res.status(400).json({ success: false, message: "New password cannot be the same as the current password" });
      }
    }

    user.password = await bcrypt.hash(password, 10);
    user.authProvider = "local";
    await user.save();

    // Invalidate any active sessions for safety
    await Session.updateMany({ userId: user._id, isActive: true }, { isActive: false, logoutAt: new Date() });
    if (otpDoc) {
      await OTP.deleteMany({ userId: user._id });
    }

    // Optionally consume verification so it can't be reused for other actions
    verifiedUsersStore.delete(normalizedEmail);

    return res.status(200).json({
      success: true,
      message: wasPasswordSet
        ? "Password reset successfully. Please log in."
        : "Password set successfully. Please log in.",
    });
  } catch (error) {
    console.error("setPasswordByOtp error:", error);
    return res.status(500).json({ success: false, message: "Error setting password" });
  }
};

// ================= HELPER FUNCTIONS =================
export const registerUserOnly = async (req, res) => {
  return res.status(400).json({
    message: "Please use the new registration flow",
    success: false,
    instructions: {
      step1: "POST /api/auth/send-email-otp",
      step2: "POST /api/auth/verify-email-otp",
      step3: "POST /api/auth/send-phone-otp",
      step4: "POST /api/auth/verify-phone-otp",
      step5: "POST /api/auth/complete-registration",
    },
  });
};

export const registerCounsellor = async (req, res) => {
  return res.status(400).json({
    message: "Please use the new registration flow",
    success: false,
    instructions: {
      step1: "POST /api/auth/send-email-otp",
      step2: "POST /api/auth/verify-email-otp",
      step3: "POST /api/auth/send-phone-otp",
      step4: "POST /api/auth/verify-phone-otp",
      step5: "POST /api/auth/complete-registration with counsellor fields",
    },
  });
};

export const getAlluser = async (req, res) => {
  try {
    const users = await User.find().select("-password");
    return res.status(200).json({
      message: "Got all users",
      success: true,
      users,
      count: users.length,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Error getting users", success: false });
  }
};

export const getUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    return res.status(200).json({
      message: "User fetched successfully",
      success: true,
      user: user.toJSON(),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Error fetching user", success: false });
  }
};

export const deleteUser = async (req, res) => {
  try {
    // Never trust a caller-supplied account ID for self-service deletion.
    // authMiddleware attaches the verified account to the request.
    const id = req.userId || req.user?._id;
    if (!id) {
      return res
        .status(401)
        .json({ message: "Authentication required", success: false });
    }
    const user = await User.findById(id);
    if (!user)
      return res
        .status(404)
        .json({ message: "User not found", success: false });
    await Session.deleteMany({ userId: id });
    await User.findByIdAndDelete(id);
    // Uploaded photos are stored in Cloudinary; external avatars have no publicId.
    // A media-service outage must not turn a successful account deletion into a 500.
    if (user.profilePhoto?.publicId) {
      try {
        await deleteFromCloudinary(user.profilePhoto.publicId);
      } catch (error) {
        console.error("Deleted account photo cleanup failed:", error.message);
      }
    }
    return res
      .status(200)
      .json({ message: "User deleted successfully", success: true });
  } catch (error) {
    console.error("Account deletion failed:", error.message);
    return res
      .status(500)
      .json({ message: "Error deleting user", success: false });
  }
};

export const checkRegistrationStatus = async (req, res) => {
  try {
    const { email } = req.params;
    const userVerification = verifiedUsersStore.get(email);

    if (!userVerification) {
      return res.status(404).json({
        success: false,
        exists: false,
        message: "No active registration session",
      });
    }

    return res.status(200).json({
      success: true,
      exists: true,
      email: email,
      isEmailVerified: userVerification.isEmailVerified,
      isPhoneVerified: userVerification.isPhoneVerified,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Error checking status" });
  }
};

export const resendEmailOTP = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email)
      return res
        .status(400)
        .json({ message: "Email required", success: false });

    const userVerification = verifiedUsersStore.get(email);
    if (!userVerification)
      return res
        .status(404)
        .json({ message: "No pending verification", success: false });

    const otp = otpService.generateOTP(email);
    await otpService.sendEmailOTP(email, otp, "User");

    emailOTPStore.set(email, { otp, expiresAt: Date.now() + 10 * 60 * 1000 });

    return res
      .status(200)
      .json({ message: "Email OTP resent successfully", success: true });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Error resending OTP", success: false });
  }
};

export const resendPhoneOTP = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email)
      return res
        .status(400)
        .json({ message: "Email required", success: false });

    const userVerification = verifiedUsersStore.get(email);
    if (!userVerification || !userVerification.phoneNumber) {
      return res
        .status(404)
        .json({ message: "No phone number found", success: false });
    }

    const otp = otpService.generateOTP();
    const normalizedPhone = normalizePhoneNumber(
      userVerification.phoneNumber,
      userVerification.phoneCountryCode,
    );
    const formattedPhone = normalizedPhone.formatted;
    const smsPhone = normalizedPhone.smsFormatted;

    await twilioClient.messages.create({
      body: `Your verification code is: ${otp}. This code will expire in 10 minutes.`,
      from: TWILIO_PHONE_NUMBER,
      to: smsPhone,
    });

    phoneOTPStore.set(email, {
      otp,
      phoneNumber: formattedPhone,
      formattedPhone,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    return res
      .status(200)
      .json({ message: "Phone OTP resent successfully", success: true });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Error resending phone OTP", success: false });
  }
};

// Aliases
export const refreshAccessTokenHandler = refreshAccessToken;
export const resendOTPS = resendEmailOTP;
export const checkVerificationStatus = checkRegistrationStatus;

// ──────────────────────────────────────────────────────────────────────────
// PROFILE-CHANGE OTP FLOW
//
// When a logged-in user edits their email or phone in the dashboard, we
// require them to prove ownership of the NEW value before the change is
// persisted. Flow:
//   1. Client calls POST /send-profile-change-otp { field, newValue }
//   2. Server sends OTP to NEW email/phone, stores it keyed on userId+field
//   3. Client calls POST /verify-profile-change-otp { field, newValue, otp }
//   4. On success, server moves the entry into verifiedProfileChanges
//   5. Client calls the existing PATCH /update/:userId with the new value
//   6. updateUserById refuses to persist email/phone changes unless a
//      verified entry exists in verifiedProfileChanges; on success the
//      entry is consumed (delete-once semantics)
//
// Auth middleware guarantees req.user is populated.
// ──────────────────────────────────────────────────────────────────────────

const profileChangeKey = (userId, field) => `${String(userId)}:${field}`;

const sendProfileChangeOtpViaEmail = async (toEmail, otp) => {
  await otpService.sendEmailOTP(toEmail, otp, "User");
};

const sendProfileChangeOtpViaSMS = async (formattedPhone, otp) => {
  const isTwilioConfigured = Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER,
  );

  if (!isTwilioConfigured) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[profile-change] Twilio not configured; dev OTP for ${formattedPhone}: ${otp}`,
      );
      return { devOtp: otp };
    }
    throw new Error("SMS service is not configured");
  }

  const twilioModule = await import("twilio");
  const twilio = twilioModule.default || twilioModule;
  const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN,
  );
  await twilioClient.messages.create({
    body: `Your Humaeli verification code is: ${otp}. Use it to confirm your new phone number. Expires in 10 minutes.`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: formattedPhone,
  });
  return {};
};

export const sendProfileChangeOTP = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Authentication required" });
    }

    const { field, newValue, phoneCountryCode } = req.body || {};
    if (!["email", "phone"].includes(field)) {
      return res
        .status(400)
        .json({ success: false, message: "field must be 'email' or 'phone'" });
    }
    if (typeof newValue !== "string" || !newValue.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "newValue is required" });
    }

    const currentUser = await User.findById(userId);
    if (!currentUser) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (field === "email") {
      const normalized = newValue.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid email format" });
      }
      if (normalized === String(currentUser.email || "").toLowerCase()) {
        return res.status(400).json({
          success: false,
          message: "New email is the same as the current one",
        });
      }
      const taken = await User.findOne({
        email: normalized,
        _id: { $ne: userId },
      });
      if (taken) {
        return res.status(409).json({
          success: false,
          message: "This email is already in use by another account",
        });
      }

      const otp = otpService.generateOTP(normalized);
      profileChangeOTPStore.set(profileChangeKey(userId, "email"), {
        otp,
        newValue: normalized,
        expiresAt: Date.now() + PROFILE_CHANGE_OTP_TTL_MS,
      });

      try {
        await sendProfileChangeOtpViaEmail(normalized, otp);
      } catch (err) {
        profileChangeOTPStore.delete(profileChangeKey(userId, "email"));
        console.error("[profile-change] email send failed:", err.message);
        return res
          .status(500)
          .json({ success: false, message: "Failed to send OTP email" });
      }

      const devOtp =
        process.env.NODE_ENV !== "production" ? { devOtp: otp } : {};
      return res.status(200).json({
        success: true,
        message: `OTP sent to ${normalized}`,
        ...devOtp,
      });
    }

    // field === "phone"
    const cleaned = normalizePhoneNumber(newValue, phoneCountryCode);
    if (!cleaned.isValid) {
      return res
        .status(400)
        .json({ success: false, message: "Enter a valid phone number" });
    }
    const currentPhone = normalizePhoneNumber(currentUser.phoneNumber || "");
    if (cleaned.formatted === currentPhone.formatted) {
      return res.status(400).json({
        success: false,
        message: "New phone is the same as the current one",
      });
    }
    const taken = await User.findOne({
      phoneNumber: { $in: cleaned.duplicateValues },
      _id: { $ne: userId },
    });
    if (taken) {
      return res.status(409).json({
        success: false,
        message: "This phone number is already in use by another account",
      });
    }

    const otp = otpService.generateOTP();
    const formattedPhone = cleaned.formatted;
    const smsPhone = cleaned.smsFormatted;
    profileChangeOTPStore.set(profileChangeKey(userId, "phone"), {
      otp,
      newValue: formattedPhone,
      expiresAt: Date.now() + PROFILE_CHANGE_OTP_TTL_MS,
    });

    try {
      const result = await sendProfileChangeOtpViaSMS(smsPhone, otp);
      const devOtp =
        result.devOtp && process.env.NODE_ENV !== "production"
          ? { devOtp: result.devOtp }
          : {};
      return res.status(200).json({
        success: true,
        message: `OTP sent to ${formattedPhone}`,
        ...devOtp,
      });
    } catch (err) {
      profileChangeOTPStore.delete(profileChangeKey(userId, "phone"));
      console.error("[profile-change] SMS send failed:", err.message);
      return res.status(503).json({
        success: false,
        message: err.message || "Failed to send OTP SMS",
      });
    }
  } catch (err) {
    console.error("sendProfileChangeOTP error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const verifyProfileChangeOTP = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Authentication required" });
    }

    const { field, newValue, otp, phoneCountryCode } = req.body || {};
    if (!["email", "phone"].includes(field)) {
      return res
        .status(400)
        .json({ success: false, message: "field must be 'email' or 'phone'" });
    }
    if (!otp || !newValue) {
      return res
        .status(400)
        .json({ success: false, message: "newValue and otp are required" });
    }

    const key = profileChangeKey(userId, field);
    const stored = profileChangeOTPStore.get(key);
    if (!stored) {
      return res.status(400).json({
        success: false,
        message: "No OTP found. Please request a new one.",
      });
    }
    if (Date.now() > stored.expiresAt) {
      profileChangeOTPStore.delete(key);
      return res
        .status(400)
        .json({ success: false, message: "OTP expired. Request a new one." });
    }

    const normalisedNew =
      field === "email"
        ? String(newValue).trim().toLowerCase()
        : normalizePhoneNumber(newValue, phoneCountryCode).formatted;

    if (stored.newValue !== normalisedNew) {
      return res.status(400).json({
        success: false,
        message:
          "The value you're verifying doesn't match the one OTP was sent for. Please re-send the OTP.",
      });
    }
    if (String(stored.otp) !== String(otp)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid OTP" });
    }

    // Mark as verified — updateUserById will consume this on Save.
    verifiedProfileChanges.set(key, {
      newValue: normalisedNew,
      expiresAt: Date.now() + PROFILE_CHANGE_VERIFIED_TTL_MS,
    });
    profileChangeOTPStore.delete(key);

    return res.status(200).json({
      success: true,
      message: `${field === "email" ? "Email" : "Phone"} verified. Hit Save within 15 minutes to apply.`,
    });
  } catch (err) {
    console.error("verifyProfileChangeOTP error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Internal helper used by updateUserById. Returns { ok, message } and
// consumes the verified entry on success so it can't be re-used.
export const consumeVerifiedProfileChange = (userId, field, attemptedValue) => {
  const key = profileChangeKey(userId, field);
  const verified = verifiedProfileChanges.get(key);
  if (!verified) {
    return {
      ok: false,
      message: `Please verify your new ${field === "email" ? "email" : "phone"} via OTP before saving.`,
    };
  }
  if (Date.now() > verified.expiresAt) {
    verifiedProfileChanges.delete(key);
    return {
      ok: false,
      message: `Verification for the new ${field} expired. Please verify again.`,
    };
  }
  const attempt =
    field === "email"
      ? String(attemptedValue).trim().toLowerCase()
      : normalizePhoneNumber(attemptedValue).formatted;
  if (verified.newValue !== attempt) {
    return {
      ok: false,
      message: `The ${field} you're saving doesn't match the one you verified.`,
    };
  }
  verifiedProfileChanges.delete(key);
  return { ok: true };
};

export const getDoctorQr = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const doctor = await User.findById(doctorId).select("-password -emailOTP -phoneOTP");
    if (!doctor) {
      return res.status(404).json({ success: false, message: "Doctor not found" });
    }
    return res.status(200).json({
      success: true,
      data: {
        doctor: {
          id: doctor.id || doctor._id,
          _id: doctor.id || doctor._id,
          full_name: doctor.fullName,
          fullName: doctor.fullName,
          name: doctor.fullName,
          email: doctor.email,
          phone: doctor.phoneNumber || doctor.phone || "",
          speciality: doctor.specialization || "Doctor",
          specialization: doctor.specialization || "Doctor",
          profile_image: doctor.profilePhoto || doctor.profilePicture || "",
          profileImage: doctor.profilePhoto || doctor.profilePicture || "",
        },
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

export const getDoctorQrStats = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const stats = await doctorQrStats.getStats(doctorId);

    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

export const recordDoctorQrVisit = async (req, res) => {
  const { doctorId } = req.params;
  const { visitId, source } = req.body || {};
  if (typeof visitId !== "string" || !/^[a-zA-Z0-9-]{16,64}$/.test(visitId)) {
    return res.status(400).json({ success: false, message: "Invalid visit ID" });
  }
  try {
    const doctor = await User.findById(doctorId);
    if (!doctor || !["doctor", "counsellor"].includes(doctor.role)) {
      return res.status(404).json({ success: false, message: "Doctor not found" });
    }
    await doctorQrStats.recordVisit(doctorId, visitId, source === "qr");
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to record QR visit" });
  }
};
