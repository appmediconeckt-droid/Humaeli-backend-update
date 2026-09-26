// src/controllers/admin/adminCounselorController.js
import User from "../../models/userModel.js";
import AuditLog from "../../models/mysql/AuditLogModel.js";

const PROFESSIONAL_ROLES = ["doctor", "consultant", "counselor", "counsellor", "counsellour"];
const isProfessionalRole = (role) =>
  PROFESSIONAL_ROLES.includes(String(role || "").trim().toLowerCase());

export const getAllCounselors = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, specialization, status } = req.query;
    const skip = (page - 1) * limit;

    let filter = { role: { $in: PROFESSIONAL_ROLES } };

    if (search) {
      filter.$or = [
        { fullName: new RegExp(search, "i") },
        { email: new RegExp(search, "i") },
      ];
    }

    if (specialization) {
      filter.specialization = { $regex: specialization, $options: "i" };
    }

    if (status === "verified") filter.isVerified = true;
    if (status === "unverified") filter.isVerified = false;
    if (status === "active") filter.isActive = true;
    if (status === "inactive") filter.isActive = false;

    const [counselors, total] = await Promise.all([
      User.find(filter).skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 }),
      User.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: counselors,
      pagination: { page: parseInt(page), limit: parseInt(limit), total },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getCounselorById = async (req, res) => {
  try {
    const counselor = await User.findById(req.params.id);
    if (!counselor || !isProfessionalRole(counselor.role)) {
      return res.status(404).json({ success: false, message: "Counselor not found" });
    }
    res.json({ success: true, data: counselor });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateCounselor = async (req, res) => {
  try {
    const counselor = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!counselor) {
      return res.status(404).json({ success: false, message: "Counselor not found" });
    }
    res.json({ success: true, data: counselor });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteCounselor = async (req, res) => {
  try {
    const counselor = await User.findByIdAndDelete(req.params.id);
    if (!counselor) {
      return res.status(404).json({ success: false, message: "Counselor not found" });
    }
    res.json({ success: true, message: "Counselor deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const approveCounselors = async (req, res) => {
  try {
    const { ids } = req.body;
    const result = await User.updateMany(
      { _id: { $in: ids } },
      { isVerified: true }
    );
    res.json({ success: true, message: `${result.modifiedCount} counselors approved` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const rejectCounselors = async (req, res) => {
  try {
    const { ids } = req.body;
    const result = await User.updateMany(
      { _id: { $in: ids } },
      { isVerified: false, isActive: false }
    );
    res.json({ success: true, message: `${result.modifiedCount} counselors rejected` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getCounselorStats = async (req, res) => {
  try {
    const [total, verified, active, newThisMonth] = await Promise.all([
      User.countDocuments({ role: { $in: PROFESSIONAL_ROLES } }),
      User.countDocuments({ role: { $in: PROFESSIONAL_ROLES }, isVerified: true }),
      User.countDocuments({ role: { $in: PROFESSIONAL_ROLES }, isActive: true }),
      User.countDocuments({
        role: { $in: PROFESSIONAL_ROLES },
        createdAt: { $gte: new Date(new Date().setDate(1)) },
      }),
    ]);

    const topRated = await User.find({ role: { $in: PROFESSIONAL_ROLES } })
      .sort({ rating: -1 })
      .limit(5);

    res.json({ success: true, data: { total, verified, active, newThisMonth, topRated } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateChatPermission = async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled, reason, notes } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ success: false, message: "enabled (boolean) is required" });
    }

    const existing = await User.findById(id);
    if (!existing || !isProfessionalRole(existing.role)) {
      return res.status(404).json({ success: false, message: "Counselor not found" });
    }

    const newPermission = {
      enabled,
      disabledReason: enabled ? null : reason || "admin_decision",
      disabledBy: enabled ? null : "admin",
      disabledAt: enabled ? null : new Date(),
      notes: notes || "",
    };

    await User.updateOne({ _id: id }, { $set: { chatPermission: newPermission } });

    try {
      await AuditLog.create({
        adminEmail: req.user?.email || "admin",
        action: enabled ? "ACTIVATE" : "DEACTIVATE",
        entityType: "COUNSELOR",
        entityId: String(existing.id),
        entityName: existing.fullName,
        changes: JSON.stringify({ chatPermission: newPermission }),
        reason: reason || null,
        ipAddress: req.ip,
        status: "SUCCESS",
        details: `Chat permission ${enabled ? "granted" : "revoked"}`,
      });
    } catch (logErr) {
      console.error("AuditLog write failed:", logErr.message);
    }

    res.json({
      success: true,
      message: `Chat ${enabled ? "enabled" : "disabled"} for ${existing.fullName}`,
      data: { chatPermission: newPermission },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getChatPermission = async (req, res) => {
  try {
    const counselor = await User.findById(req.params.id);
    if (!counselor || !isProfessionalRole(counselor.role)) {
      return res.status(404).json({ success: false, message: "Counselor not found" });
    }
    res.json({
      success: true,
      data: {
        _id: counselor._id,
        fullName: counselor.fullName,
        email: counselor.email,
        chatPermission: counselor.chatPermission || null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
