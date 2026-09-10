
// models/userModel.js
import mongoose from "mongoose";
import { type } from "os";

const userSchema = new mongoose.Schema({
    fullName: {
        type: String,
        trim: true,
        required: true
    },
    email: {
        type: String,
        trim: true,
        required: true,
        unique: true,
        lowercase: true
    },
    anonymous: {
        type: String,
    },
    phoneNumber: {
        type: String,
        required: function() { return !this.googleId; }
    },
    phoneCountryCode: {
        type: String,
        trim: true,
        default: "+91"
    },
    password: {
        type: String,
        required: function() { return !this.googleId; }
    },
    googleId: {
        type: String,
        unique: true,
        sparse: true
        // No `default: null` — sparse index ignores docs where the field is
        // ABSENT, but counts docs where field === null. With default:null,
        // every local-signup user would collide on null.
    },
    googleEmail: {
        type: String,
        trim: true,
        lowercase: true,
        default: null
    },
    authProvider: {
        type: String,
        enum: ["local", "google"],
        default: "local"
    },
    sessionId: {
        type: String,
        default: null
    },
    // Internal idempotency ledger for wallet top-ups. Payment IDs are never
    // exposed to public profile responses.
    walletCreditPaymentIds: {
        type: [String],
        default: [],
        select: false
    },
    age: {
        type: Number,
    },
    gender: {
        type: String,
        enum: ["male", "female", "other"],
        default: "male"
    },
    role: {
        type: String,
        enum: ["user", "counsellor", "admin"],
        default: "user"
    },
    profileCompleted: {
        type: Boolean,
        default: false
    },

    // Chat-session situational context, refreshed by the AI extractor.
    // These change moment-to-moment (where user is, who's with them) so the
    // AI can give relevant tips (e.g. "outside alone" vs "home with family").
    chatContext: {
        currentSurrounding: {
            type: String,
            enum: ["home", "work", "school", "outside", null],
            default: null,
        },
        currentCompany: {
            type: String,
            enum: ["alone", "family", "friends", "partner", "colleagues", null],
            default: null,
        },
        safetyFlags: {
            type: [String],
            default: [],
        },
        updatedAt: {
            type: Date,
            default: null,
        },
    },

    // OTP Verification Fields
    isEmailVerified: {
        type: Boolean,
        default: false
    },
    isPhoneVerified: {
        type: Boolean,
        default: false
    },
    emailOTP: {
        code: String,
        expiresAt: Date
    },
    phoneOTP: {
        code: String,
        expiresAt: Date
    },
    
    // Patient Profile Fields (for regular users)
    dateOfBirth: {
        type: Date,
        default: null
    },
    bloodGroup: {
        type: String,
        enum: ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-", ""],
        set: (value) => {
            if (value === null || value === undefined) return value;
            return String(value).trim().toUpperCase();
        },
        default: null
    },
    address: {
        line1: { type: String, default: "" },
        line2: { type: String, default: "" },
        city: { type: String, default: "" },
        state: { type: String, default: "" },
        pincode: { type: String, default: "" },
        country: { type: String, default: "India" }
    },
    emergencyContact: {
        name: { type: String, default: "" },
        relation: { type: String, default: "" },
        phone: { type: String, default: "" }
    },
    medicalInfo: {
        height: { type: String, default: "" },
        weight: { type: String, default: "" },
        allergies: { type: [String], default: [] },
        chronicConditions: { type: [String], default: [] },
        currentMedications: { type: [String], default: [] }
    },
    insuranceInfo: {
        provider: { type: String, default: "" },
        policyNumber: { type: String, default: "" },
        groupNumber: { type: String, default: "" },
        coverageAmount: { type: String, default: "" },
        validityDate: { type: Date, default: null },
        nominee: { type: String, default: "" },
        relationship: { type: String, default: "" },
        insuranceType: { type: String, default: "" }
    },
    
    // Counsellor-specific fields
    // Required only when role === "counsellor" AND user signed up via local flow
    // (Google signup users complete these fields later via profile update)
    qualification: {
        type: String,
        required: function() { return this.role === "counsellor" && !this.googleId; }
    },
    specialization: {
        type: [String],
        required: function() { return this.role === "counsellor" && !this.googleId; }
    },
    experience: {
        type: Number,
        required: function() { return this.role === "counsellor" && !this.googleId; }
    },
    location: {
        type: String,
        required: function() { return this.role === "counsellor" && !this.googleId; }
    },
    consultationMode: {
        type: [String],
        enum: ["online", "offline", "both"],
        default: ["online"],
        required: function() { return this.role === "counsellor" && !this.googleId; }
    },
    languages: {
        type: [String],
        default: [],
        required: function() { return this.role === "counsellor" && !this.googleId; }
    },
    aboutMe: {
        type: String,
        trim: true,
        maxlength: 2000
    },
    
    education: {
        type: String,
        default: ""
    },
    
    certifications: [{
        name: {
            type: String,
            required: true
        },
        issuedBy: {
            type: String,
            default: ""
        },
        issueDate: {
            type: Date,
            default: null
        },
        expiryDate: {
            type: Date,
            default: null
        },
        documentUrl: {
            type: String,
            default: null
        },
        documentPublicId: {
            type: String,
            default: null
        },
        documentName: {
            type: String,
            default: ""
        }
    }],
    
    uniqueCode: {
        type: String,
        unique: true,
        sparse: true,
      
    },
    
    rating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
    },
    ratingCount: {
        type: Number,
        default: 0,
        min: 0
    },
    totalSessions: {
        type: Number,
        default: 0
    },
    activeClients: {
        type: Number,
        default: 0
    },
    profilePhoto: {
        url: String,
        publicId: String,
        format: String,
        bytes: Number
    },
    profilePhotoPublicId: {
        type: String,
        default: null
    },
    
    chatPermission: {
        enabled: { type: Boolean, default: true },
        disabledReason: { type: String, default: null },
        disabledBy: { type: String, enum: ["admin", "system"], default: null },
        disabledAt: { type: Date, default: null },
        notes: { type: String, default: "" },
    },

    isActive: {
        type: Boolean,
        default: true
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    isOnline: {
        type: Boolean,
        default: false
    },
    lastSeen: {
        type: Date,
        default: null
    },
    refreshToken:{
        type: String
    },
    walletBalance: {
      type: Number,
      default: 0
    },
    activeWalletRefundRequest: {
      type: Boolean,
      default: false,
      select: false,
    },
    fcmToken: {
  type: String,
  default: null,
},

devicePlatform: {
  type: String,
  default: null,
},
    instantPayoutCount: {
      type: Number,
      default: 0,
      min: 0
    },
    payoutAccount: {
        accountName: { type: String, default: "" },
        accountNumber: { type: String, default: "" },
        ifsc: { type: String, default: "" },
        bankName: { type: String, default: "" },
        isVerified: { type: Boolean, default: false },
        verifiedAt: { type: Date, default: null }
    },

    // ── Geolocation / fraud verification ──────────────────────────
    locationConsent: {
        type: Boolean,
        default: false
    },
    locationData: {
        current: {
            type: {
                type: String,
                enum: ["Point"],
                default: "Point"
            },
            coordinates: {
                type: [Number],   // [longitude, latitude]
                default: undefined
            },
            address: { type: String, default: "" },
            city: { type: String, default: "" },
            state: { type: String, default: "" },
            country: { type: String, default: "" },
            capturedAt: { type: Date },
            ipAddress: { type: String, default: "" }
        },
        history: [{
            coordinates: { type: [Number] },
            address: { type: String, default: "" },
            capturedAt: { type: Date },
            event: { type: String, enum: ["signup", "login", "booking", "manual"], default: "manual" },
            ipAddress: { type: String, default: "" },
            _id: false
        }],
        isVerified: { type: Boolean, default: false },
        verifiedAt: { type: Date, default: null },
        verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        verificationNotes: { type: String, default: "" }
    }
}, { timestamps: true });

// Geospatial index for "find nearby counsellors" queries
userSchema.index({ "locationData.current": "2dsphere" });

// Phone number is required for local accounts, but Google accounts can be
// created before the user completes their profile. A partial unique index keeps
// real phone numbers unique while ignoring absent/null OAuth phone values.
userSchema.index(
    { phoneNumber: 1 },
    {
        unique: true,
        name: "phoneNumber_1",
        partialFilterExpression: { phoneNumber: { $type: "string" } }
    }
);

const calculateAgeFromDateOfBirth = (value) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    const today = new Date();
    let age = today.getUTCFullYear() - date.getUTCFullYear();
    const birthdayThisYear = new Date(Date.UTC(
        today.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
    ));
    const todayUtc = new Date(Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate()
    ));

    if (todayUtc < birthdayThisYear) age -= 1;
    return age >= 0 ? age : null;
};

// ✅ NO PRE-SAVE HOOK - We'll generate uniqueCode in the controller

// Remove sensitive data when converting to JSON
userSchema.methods.toJSON = function() {
    const user = this.toObject();
    const ageFromDateOfBirth = calculateAgeFromDateOfBirth(user.dateOfBirth);
    if (ageFromDateOfBirth !== null) {
        user.age = ageFromDateOfBirth;
    }
    user.hasPassword = Boolean(user.password);
    delete user.password;
    delete user.profilePhotoPublicId;
    delete user.emailOTP;
    delete user.phoneOTP;
    return user;
};

// Prevent duplicate model compilation
let User;
try {
    User = mongoose.model('User');
} catch (error) {
    User = mongoose.model('User', userSchema);
}

export default User;
