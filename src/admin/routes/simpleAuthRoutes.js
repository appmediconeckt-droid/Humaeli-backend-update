import express from "express";
import rateLimit from "express-rate-limit";
import { createAdmin, adminLogin, getAdminProfile, adminLogout, changePassword } from "../controllers/simpleAuthController.js";
import { verifyAdminToken } from "../middleware/simpleAdminAuth.js";

const router = express.Router();

router.post("/login", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  message: "Too many login attempts, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
}), adminLogin);
router.post("/create-admin", verifyAdminToken, createAdmin);
router.get("/profile", verifyAdminToken, getAdminProfile);
router.post("/logout", verifyAdminToken, adminLogout);
router.post("/change-password", verifyAdminToken, changePassword);

export default router;
