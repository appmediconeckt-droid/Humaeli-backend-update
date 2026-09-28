import User from "../models/User.js";
import jwt from "jsonwebtoken";
import bcryptjs from "bcryptjs";

export const generateAdminToken = (email, id = null) => {
  return jwt.sign({ email, role: "admin", ...(id ? { id: String(id) } : {}) }, process.env.ADMIN_JWT_SECRET, {
    expiresIn: "24h"
  });
};

export const verifyAdminToken = async (req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "No token provided"
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
    if (decoded.id) {
      const admin = await User.findOne({ _id: decoded.id, role: "admin", isActive: true });
      if (!admin || decoded.role !== "admin") throw new Error("Admin access revoked");
      req.user = { email: admin.email, id: String(admin._id), fullName: admin.fullName, role: "admin" };
    } else {
      if (!process.env.ADMIN_EMAIL || decoded.email !== process.env.ADMIN_EMAIL) throw new Error("Invalid admin identity");
      req.user = { email: decoded.email, id: null, role: "admin" };
    }
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token"
    });
  }
};

export const verifyAdminPassword = async (password) => {
  return await bcryptjs.compare(password, process.env.ADMIN_PASSWORD_HASH);
};

export const hashPassword = async (password) => {
  return await bcryptjs.hash(password, 10);
};
