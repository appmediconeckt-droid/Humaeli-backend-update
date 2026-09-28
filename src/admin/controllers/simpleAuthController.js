import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { generateAdminToken, verifyAdminPassword, hashPassword } from "../middleware/simpleAdminAuth.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    let admin = null;
    let valid = false;
    if (process.env.ADMIN_EMAIL && normalizedEmail === process.env.ADMIN_EMAIL.trim().toLowerCase()) {
      valid = Boolean(process.env.ADMIN_PASSWORD_HASH) && await verifyAdminPassword(password);
    } else {
      admin = await User.findOne({ email: normalizedEmail, role: "admin", isActive: true });
      valid = Boolean(admin?.password) && await bcrypt.compare(password, admin.password);
    }
    if (!valid) return res.status(401).json({ success: false, message: "Invalid email or password" });
    const token = generateAdminToken(admin?.email || process.env.ADMIN_EMAIL, admin?._id);
    res.json({ success: true, message: "Login successful", token,
      admin: admin ? adminResponse(admin) : { email: process.env.ADMIN_EMAIL, role: "admin" } });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Login failed",
      error: err.message
    });
  }
};

export const getAdminProfile = async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    res.json({
      success: true,
      admin: { ...req.user },
      token
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to get profile"
    });
  }
};

export const adminLogout = (req, res) => {
  res.json({
    success: true,
    message: "Logout successful"
  });
};

export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};

    if (![currentPassword, newPassword, confirmPassword].every(value => typeof value === "string" && value.length > 0)) {
      return res.status(400).json({
        success: false,
        message: "All fields are required"
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 8 characters long"
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "New passwords do not match"
      });
    }

    const dbAdmin = req.user?.id ? await User.findOne({ _id: req.user.id, role: "admin", isActive: true }) : null;
    const isCurrentPasswordValid = req.user?.id
      ? Boolean(dbAdmin?.password) && await bcrypt.compare(currentPassword, dbAdmin.password)
      : await verifyAdminPassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect"
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from current password"
      });
    }

    const hashedPassword = await hashPassword(newPassword);

    if (dbAdmin) {
      dbAdmin.password = hashedPassword;
      await dbAdmin.save();
      return res.json({ success: true, message: "Password changed successfully" });
    }

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const envPath = process.env.DOTENV_PATH
      ? path.resolve(process.env.DOTENV_PATH)
      : path.resolve(__dirname, "../../../.env");
    let envContent = fs.readFileSync(envPath, "utf8");
    const entry = `ADMIN_PASSWORD_HASH=${hashedPassword}`;
    envContent = /^ADMIN_PASSWORD_HASH=.*$/m.test(envContent)
      ? envContent.replace(/^ADMIN_PASSWORD_HASH=.*$/m, () => entry)
      : `${envContent.trimEnd()}\n${entry}\n`;
    fs.writeFileSync(envPath, envContent, "utf8");

    process.env.ADMIN_PASSWORD_HASH = hashedPassword;

    res.json({
      success: true,
      message: "Password changed successfully"
    });
  } catch (err) {
    console.error("Password change error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to change password"
    });
  }
};

const adminResponse = (admin) => ({
  _id: admin._id, fullName: admin.fullName, email: admin.email,
  role: admin.role, isActive: admin.isActive, createdAt: admin.createdAt,
});

export const createAdmin = async (req, res) => {
  const body = req.body || {};
  const fullName = typeof (body.fullName ?? body.name) === "string" ? (body.fullName ?? body.name).trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const { password, confirmPassword } = body;
  if (!fullName || fullName.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ success: false, message: "Valid name and email are required" });
  }
  if (typeof password !== "string" || password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    return res.status(400).json({ success: false, message: "Password must be at least 8 characters and no more than 72 UTF-8 bytes" });
  }
  if (password !== confirmPassword) return res.status(400).json({ success: false, message: "Passwords do not match" });
  try {
    if (email === process.env.ADMIN_EMAIL?.trim().toLowerCase() || await User.exists({ email })) {
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }
    const admin = await User.create({ fullName, email, password: await hashPassword(password), role: "admin", isActive: true, locationData: { current: { type: "Point", coordinates: [0, 0] } } });
    return res.status(201).json({ success: true, message: "Admin created successfully", admin: adminResponse(admin) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: "An account with this email already exists" });
    console.error("Admin creation failed:", error.message);
    return res.status(500).json({ success: false, message: "Failed to create admin" });
  }
};
