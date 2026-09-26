import express from "express";
import {
  loginUser,
  deleteUser,
  getUser,
  getAlluser,
  logout,
  getAllCounsellors,
  getCounsellorById,
  getMyProfile,
  getDoctorQr,
  getDoctorQrStats,
  recordDoctorQrVisit,
  verifyEmailOTP,
  sendEmailOTP,
  sendPhoneOTP,
  verifyPhoneOTP,
  completeRegistration,
  forgotPassword,
  setPassword,
  changePassword,
  verifyPasswordOtp,
  setPasswordByOtp,
  resetPassword,
  refreshAccessTokenHandler,
  logoutAllDevices,
  getMySessions,
  updateUserById,
  logoutOtherDevicesAndSendOTP,
  verifyLoginOTP,
  googleAuth,
  relinkGoogleAccount,
  sendUnlinkGoogleOtp,
  unlinkGoogleAccount,
  sendProfileChangeOTP,
  verifyProfileChangeOTP,
  debugCounsellorByEmail,
  sessionHeartbeat,
  getLandingStats,
} from "../controllers/authController.js";
import { body } from "express-validator";
import { authorizeRoles } from "../middleware/authorizeRoles.js";
import { verifyOtp } from "../middleware/verifyOtp.js";
// refreshToken middleware import removed — route uses refreshAccessTokenHandler from authController
import { authMiddleware } from "../middleware/authMiddleware.js";
import { generateOtp } from "../utils/generateOtp.js";
import { resendOtp } from "../utils/resendOtp.js";
import {
  handleUserUpload,
  uploadProfilePhoto,
} from "../middleware/multerConfig.js";

export const authRoutes = express.Router();

// OTP & REGISTRATION FLOW
authRoutes.post("/send-email-otp", sendEmailOTP);
authRoutes.post("/verify-email-otp", verifyEmailOTP);
authRoutes.post("/send-phone-otp", sendPhoneOTP);
authRoutes.post("/verify-phone-otp", verifyPhoneOTP);
authRoutes.post("/complete-registration",uploadProfilePhoto,completeRegistration,);

// AUTHENTICATION ROUTES
authRoutes.post("/login", loginUser);
// Google OAuth (signup + login in one endpoint — handles both new and existing users)
authRoutes.post("/google", googleAuth);
authRoutes.post("/google/relink", authMiddleware, relinkGoogleAccount);
authRoutes.post("/google/unlink/send-otp", authMiddleware, sendUnlinkGoogleOtp);
authRoutes.post("/google/unlink", authMiddleware, unlinkGoogleAccount);
// NEW routes for the one‑device flow
authRoutes.post("/logout-other-devices", logoutOtherDevicesAndSendOTP);
authRoutes.post("/verify-login-otp", verifyLoginOTP);

authRoutes.post("/logout", authMiddleware, logout);
authRoutes.post("/session-heartbeat", authMiddleware, sessionHeartbeat);
// Password management for both users and counsellors
authRoutes.post("/setPassword", authMiddleware, setPassword);
authRoutes.post("/changePassword", authMiddleware, changePassword);
// Password OTP endpoints do not create login sessions during settings flows.
authRoutes.post("/verify-password-otp", verifyPasswordOtp);
authRoutes.post("/set-password-by-otp", setPasswordByOtp);
authRoutes.post("/refresh-token", refreshAccessTokenHandler);
authRoutes.post("/logout-all", authMiddleware, logoutAllDevices);

authRoutes.get(
  "/my-sessions",
  authMiddleware,
  authorizeRoles("counsellor"),
  getMySessions,
);

// OTP ROUTES For Login
authRoutes.post("/generateOtp", generateOtp);
authRoutes.post("/verifyOtp", verifyOtp);
authRoutes.post("/resendOtp", resendOtp);

// PUBLIC COUNSELLOR ROUTES
authRoutes.get("/landing-stats", getLandingStats);
authRoutes.get("/counsellors", getAllCounsellors);
authRoutes.get("/counsellors/:counsellorId", getCounsellorById);
authRoutes.get("/debug/counsellor", debugCounsellorByEmail);

// PROTECTED ROUTES
authRoutes.get(
  "/me",
  authMiddleware,
  authorizeRoles("user", "counsellor", "doctor"), // all allowed
  getMyProfile,
);
authRoutes.get("/getUser/:userId", getUser);
authRoutes.get("/doctor-qr/:doctorId", getDoctorQr);
authRoutes.get("/doctor-qr/:doctorId/stats", getDoctorQrStats);
authRoutes.post("/doctor-qr/:doctorId/visits", recordDoctorQrVisit);

authRoutes.get(
  "/getAllUser",
  authMiddleware,
  authorizeRoles("counsellor", "doctor"),
  getAlluser,
);

// UPDATE ROUTE - Uses handleUserUpload for both profile photo and certifications
authRoutes.patch(
  "/update/:userId",
  authMiddleware,
  handleUserUpload,
  updateUserById,
);

// Profile-change OTP flow — gates email/phone changes from the dashboard.
// Both endpoints require the user to be logged in.
authRoutes.post(
  "/profile-change/send-otp",
  authMiddleware,
  sendProfileChangeOTP,
);
authRoutes.post(
  "/profile-change/verify-otp",
  authMiddleware,
  verifyProfileChangeOTP,
);

authRoutes.delete("/delete", authMiddleware, deleteUser);

// PASSWORD RESET ROUTES
authRoutes.post(
  "/forgotPassword",
  [body("email").isEmail().withMessage("Please provide a valid email")],
  forgotPassword,
);

authRoutes.post(
  "/resetPassword/:token",
  [
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("confirmPassword").custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error("Passwords do not match");
      }
      return true;
    }),
  ],
  resetPassword,
);

export default authRoutes;
