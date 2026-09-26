// src/middleware/adminAuth.js
// Admin authentication middleware for the merged admin panel
import jwt from "jsonwebtoken";
import bcryptjs from "bcryptjs";

export const getAdminRole = (email) =>
  typeof email === "string" &&
  email.trim().toLowerCase() === process.env.ADMIN_EMAIL?.trim().toLowerCase()
    ? "superadmin"
    : "admin";

export const generateAdminToken = (email) => {
  return jwt.sign(
    { email, role: getAdminRole(email) },
    process.env.ADMIN_JWT_SECRET,
    { expiresIn: "24h" }
  );
};

export const verifyAdminToken = (req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ success: false, message: "No token provided" });
  }
  try {
    const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
    req.user = { email: decoded.email, id: decoded.id || null, role: getAdminRole(decoded.email) };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};

export const requireSuperadmin = (req, res, next) => {
  if (req.user?.role !== "superadmin") {
    return res.status(403).json({ success: false, message: "Only the Superadmin can perform this action" });
  }
  next();
};

export const verifyAdminPassword = async (password) => {
  return await bcryptjs.compare(password, process.env.ADMIN_PASSWORD_HASH);
};

export const hashPassword = async (password) => {
  return await bcryptjs.hash(password, 10);
};
