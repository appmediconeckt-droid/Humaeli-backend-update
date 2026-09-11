import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";

export const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status } = req.query;
    const skip = (page - 1) * limit;

    let filter = { role: "user" };

    if (search) {
      filter.$or = [
        { fullName: new RegExp(search, "i") },
        { email: new RegExp(search, "i") }
      ];
    }

    if (status === "verified") filter.isVerified = true;
    if (status === "unverified") filter.isVerified = false;
    if (status === "active") filter.isActive = true;
    if (status === "inactive") filter.isActive = false;

    const users = await User.find(filter)
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await User.countDocuments(filter);

    res.json({
      success: true,
      data: users,
      pagination: { page: parseInt(page), limit: parseInt(limit), total }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json({ success: true, message: "User deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getUserStats = async (req, res) => {
  try {
    const total = await User.countDocuments({ role: "user" });
    const verified = await User.countDocuments({ role: "user", isVerified: true });
    const active = await User.countDocuments({ role: "user", isActive: true });
    const newThisMonth = await User.countDocuments({
      role: "user",
      createdAt: { $gte: new Date(new Date().setDate(1)) }
    });

    res.json({
      success: true,
      data: { total, verified, active, newThisMonth }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const toggleAccountStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminEmail = req.user?.email;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const previousStatus = user.isActive;
    const newStatus = !previousStatus;

    user.isActive = newStatus;
    await user.save();

    try {
      await AuditLog.create({
        adminEmail,
        action: newStatus ? "ACTIVATE" : "DEACTIVATE",
        entityType: "USER",
        entityId: user._id,
        entityName: user.fullName,
        reason: reason || "Admin action",
        changes: { isActive: { from: previousStatus, to: newStatus } },
        ipAddress: req.ip
      });
    } catch (logErr) {
      console.error("AuditLog write failed:", logErr.message);
    }

    res.json({
      success: true,
      message: `User ${newStatus ? "activated" : "deactivated"} successfully`,
      data: { userId: user._id, isActive: newStatus }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const bulkToggleStatus = async (req, res) => {
  try {
    const { userIds, status } = req.body;
    const adminEmail = req.user?.email;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid user IDs" });
    }

    const result = await User.updateMany(
      { _id: { $in: userIds } },
      { isActive: status }
    );

    try {
      await AuditLog.create({
        adminEmail,
        action: status ? "ACTIVATE" : "DEACTIVATE",
        entityType: "USER",
        details: `Bulk ${status ? "activation" : "deactivation"} of ${userIds.length} users`,
        ipAddress: req.ip
      });
    } catch (logErr) {
      console.error("AuditLog write failed:", logErr.message);
    }

    res.json({
      success: true,
      message: `${result.modifiedCount} users ${status ? "activated" : "deactivated"}`,
      data: { modifiedCount: result.modifiedCount }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
