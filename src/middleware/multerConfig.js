import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsRoot = path.resolve(__dirname, "../../uploads");

const isCloudinaryConfigured = () =>
  Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  );

const getUploadFolder = (file) => {
  if (file.fieldname === "profilePhoto") return "profile-photos";
  if (file.fieldname === "prescriptionSignature") return "prescription-assets";
  if (file.fieldname === "prescriptionSeal") return "prescription-assets";
  return "certifications";
};

const localStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = getUploadFolder(file);
    const destination = path.join(uploadsRoot, folder);
    fs.mkdirSync(destination, { recursive: true });
    cb(null, destination);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const base = path
      .basename(file.originalname || "upload", ext)
      .replace(/[^a-z0-9_-]/gi, "-")
      .replace(/-+/g, "-")
      .slice(0, 80);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${base}${ext}`);
  },
});

// Storage for profile photos
const profileStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "profile-photos",
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
    transformation: [{ width: 500, height: 500, crop: "limit" }],
  },
});

// Storage for certification documents
const certificationStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "certifications",
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp", "pdf"],
    transformation: [{ width: 1000, height: 1000, crop: "limit" }],
  },
});

// Dynamic storage based on field name
// Dynamic storage based on field name
const dynamicStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (req, file) => {
    console.log("Processing file:", file.fieldname, file.originalname);

    // Check if it's a profile photo
    if (file.fieldname === "profilePhoto") {
      return {
        folder: "profile-photos",
        allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
        transformation: [{ width: 500, height: 500, crop: "limit" }],
      };
    }
    if (file.fieldname === "prescriptionSignature" || file.fieldname === "prescriptionSeal") {
      return {
        folder: "prescription-assets",
        allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
        transformation: [{ width: 1000, height: 500, crop: "limit" }],
      };
    }
    // Check if it's a certification document (matches certifications[0][document], etc.)
    else if (
      file.fieldname.includes("certifications") &&
      file.fieldname.includes("document")
    ) {
      return {
        folder: "certifications",
        allowed_formats: ["jpg", "jpeg", "png", "gif", "webp", "pdf"],
        transformation: [{ width: 1000, height: 1000, crop: "limit" }],
      };
    }
    // Check if it's certificationDocuments field
    else if (file.fieldname === "certificationDocuments") {
      return {
        folder: "certifications",
        allowed_formats: ["jpg", "jpeg", "png", "gif", "webp", "pdf"],
        transformation: [{ width: 1000, height: 1000, crop: "limit" }],
      };
    }
    return {};
  },
});

// File filter for uploaded files
// File filter for uploaded files
const fileFilter = (req, file, cb) => {
  // Check if it's a profile photo
  if (
    file.fieldname === "profilePhoto" ||
    file.fieldname === "prescriptionSignature" ||
    file.fieldname === "prescriptionSeal"
  ) {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    if (allowedTypes.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Only image files (jpeg, jpg, png, gif, webp) are allowed",
        ),
      );
    }
  }
  // Check if it's a certification document - FIXED: Accept certificationDocuments
  else if (file.fieldname === "certificationDocuments") {
    const allowedTypes = /jpeg|jpg|png|gif|webp|pdf|ai/;
    if (allowedTypes.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only images and PDF files are allowed for certifications"));
    }
  }
  // Check if it's a nested certification document (backward compatibility)
  else if (
    file.fieldname.includes("certifications") &&
    file.fieldname.includes("document")
  ) {
    const allowedTypes = /jpeg|jpg|png|gif|webp|pdf|ai/;
    if (allowedTypes.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only images and PDF files are allowed for certifications"));
    }
  } else {
    // For any other file field, reject
    cb(new Error(`Unexpected file field: ${file.fieldname}`));
  }
};

// Create multer instance that accepts any fields
// Create multer instance that accepts any fields
const upload = multer({
  storage: isCloudinaryConfigured() ? dynamicStorage : localStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: fileFilter,
});

const chatAttachmentStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "chat-attachments",
    resource_type: "auto",
    allowed_formats: [
      "jpg",
      "jpeg",
      "png",
      "gif",
      "webp",
      "pdf",
      "doc",
      "docx",
      "txt",
      "mp3",
      "wav",
      "mp4",
      "mov",
    ],
  },
});

const chatAttachmentFilter = (req, file, cb) => {
  if (file.fieldname !== "attachment") {
    cb(new Error(`Unexpected file field: ${file.fieldname}`));
    return;
  }

  const mimeType = (file.mimetype || "").toLowerCase();
  const allowedMimeTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
  ];

  const isAllowed =
    mimeType.startsWith("image/") ||
    mimeType.startsWith("audio/") ||
    mimeType.startsWith("video/") ||
    allowedMimeTypes.includes(mimeType);

  if (!isAllowed) {
    cb(new Error("Unsupported file type for chat attachment"));
    return;
  }

  cb(null, true);
};

const chatAttachmentUpload = multer({
  storage: isCloudinaryConfigured() ? chatAttachmentStorage : localStorage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: chatAttachmentFilter,
});

// Handle user upload - accept all fields
export const handleUserUpload = (req, res, next) => {
  const contentType = req.headers["content-type"] || "";

  // Skip if not multipart
  if (!contentType.includes("multipart/form-data")) {
    return next();
  }

  // Use .any() to accept all fields (both files and text)
  upload.any()(req, res, (err) => {
    if (err) {
      console.error("Multer Error:", err);
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    if (!isCloudinaryConfigured() && req.files?.length > 0) {
      const origin = `${req.protocol}://${req.get("host")}`;
      req.files = req.files.map((file) => {
        const relativePath = path
          .relative(uploadsRoot, file.path)
          .replace(/\\/g, "/");
        return {
          ...file,
          path: `${origin}/uploads/${relativePath}`,
          localPath: file.path,
        };
      });
    }

    // Organize files by field name
    if (req.files && req.files.length > 0) {
      req.filesByField = {};

      req.files.forEach((file) => {
        if (!req.filesByField[file.fieldname]) {
          req.filesByField[file.fieldname] = [];
        }
        req.filesByField[file.fieldname].push(file);
      });

      // Set req.files for backward compatibility
      req.files = req.filesByField;

      console.log("Files processed:");
      Object.keys(req.filesByField).forEach((field) => {
        console.log(`  ${field}: ${req.filesByField[field].length} file(s)`);
      });
    }

    next();
  });
};

export const uploadChatAttachment = (req, res, next) => {
  const contentType = req.headers["content-type"] || "";

  if (!contentType.includes("multipart/form-data")) {
    next();
    return;
  }

  chatAttachmentUpload.single("attachment")(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        error: err.message,
      });
    }

    if (!isCloudinaryConfigured() && req.file?.path) {
      const origin = `${req.protocol}://${req.get("host")}`;
      const relativePath = path
        .relative(uploadsRoot, req.file.path)
        .replace(/\\/g, "/");
      req.file = {
        ...req.file,
        path: `${origin}/uploads/${relativePath}`,
        localPath: req.file.path,
      };
    }

    next();
  });
};

const prescriptionPdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname !== "attachment") return cb(new Error("Unexpected prescription file field"));
    if (String(file.mimetype).toLowerCase() !== "application/pdf") {
      return cb(new Error("Only PDF prescriptions are allowed"));
    }
    return cb(null, true);
  },
});

export const uploadPrescriptionPdf = (req, res, next) => {
  prescriptionPdfUpload.single("attachment")(req, res, (error) => {
    if (error) return res.status(400).json({ success: false, error: error.message });
    return next();
  });
};

const prescriptionPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (file.fieldname !== "photo") return cb(new Error("Unexpected photo field"));
    if (!allowed.has(String(file.mimetype).toLowerCase())) {
      return cb(new Error("Only JPG, PNG, or WebP photos are allowed"));
    }
    return cb(null, true);
  },
});

export const uploadPrescriptionPhoto = (req, res, next) => {
  prescriptionPhotoUpload.single("photo")(req, res, (error) => {
    if (error) return res.status(400).json({ success: false, error: error.message });
    return next();
  });
};

// Handle user upload - accept all fields

// Export individual middlewares for backward compatibility
export const uploadProfilePhoto = upload.single("profilePhoto");
export const uploadCertificationFiles = upload.array(
  "certificationDocuments",
  10,
);
export const uploadUserData = handleUserUpload;
export { upload };
