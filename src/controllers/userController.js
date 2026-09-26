// src/controllers/userController.js
import { query } from "../config/mysql.js";
import bcrypt from "bcryptjs";

/**
 * GET /api/users
 * Returns users from MySQL. Supports ?role=doctor|nurse|... and ?clinic_id=...
 */
export const getUsers = async (req, res) => {
  try {
    const { role, clinic_id, doctor_id, limit = 100, offset = 0 } = req.query;

    let sql = `SELECT id, fullName, email, phoneNumber, role, department, shift,
                      gender, isActive, isVerified, lastSeen, profilePhoto,
                      assignedDoctor, specialization, createdAt, updatedAt
               FROM \`users\`
               WHERE 1=1`;
    const params = [];

    if (role) {
      // Allow comma-separated roles e.g. ?role=doctor,nurse
      const roles = role.split(",").map((r) => r.trim()).filter(Boolean);
      if (roles.length === 1) {
        sql += ` AND role = ?`;
        params.push(roles[0]);
      } else if (roles.length > 1) {
        sql += ` AND role IN (${roles.map(() => "?").join(",")})`;
        params.push(...roles);
      }
    }

    if (doctor_id) {
      sql += ` AND (assignedDoctor = ? OR id = ?)`;
      params.push(doctor_id, doctor_id);
    }

    sql += ` ORDER BY createdAt DESC LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    const [rows] = await query(sql, params);

    const users = rows.map((u) => ({
      id: u.id,
      _id: u.id,
      user_id: u.id,
      fullName: u.fullName || "",
      full_name: u.fullName || "",
      name: u.fullName || "",
      email: u.email || "",
      phone: u.phoneNumber || "",
      phoneNumber: u.phoneNumber || "",
      role: u.role || "user",
      department: u.department || "",
      shift: u.shift || "",
      gender: u.gender || "",
      specialization: u.specialization || "",
      isActive: u.isActive,
      isVerified: u.isVerified,
      status: u.isActive !== 0 ? "Active" : "Inactive",
      lastSeen: u.lastSeen,
      profilePhoto: u.profilePhoto || null,
      assignedDoctor: u.assignedDoctor || null,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));

    return res.status(200).json({
      success: true,
      data: users,
      users,
      count: users.length,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch users",
      error: error.message,
    });
  }
};

/**
 * GET /api/users/:id
 */
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await query(
      `SELECT id, fullName, email, phoneNumber, role, department, shift,
              gender, isActive, isVerified, lastSeen, profilePhoto,
              assignedDoctor, specialization, createdAt, updatedAt
       FROM \`users\` WHERE id = ? LIMIT 1`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const u = rows[0];
    return res.status(200).json({
      success: true,
      user: {
        id: u.id,
        _id: u.id,
        fullName: u.fullName,
        name: u.fullName,
        email: u.email,
        phone: u.phoneNumber,
        role: u.role,
        department: u.department,
        specialization: u.specialization,
        isActive: u.isActive,
        profilePhoto: u.profilePhoto,
        createdAt: u.createdAt,
      },
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch user", error: error.message });
  }
};

/**
 * PUT /api/users/:id  - update user
 */
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      fullName, full_name, name, email, phoneNumber, phone,
      role, department, shift, gender, status, isActive,
    } = req.body;

    const resolvedName = fullName || full_name || name;
    const resolvedPhone = phoneNumber || phone;
    const resolvedActive = isActive !== undefined
      ? isActive
      : status === "Active" ? 1 : status === "Inactive" ? 0 : undefined;

    const setClauses = [];
    const params = [];

    if (resolvedName !== undefined) { setClauses.push("fullName = ?"); params.push(resolvedName); }
    if (email !== undefined) { setClauses.push("email = ?"); params.push(email); }
    if (resolvedPhone !== undefined) { setClauses.push("phoneNumber = ?"); params.push(resolvedPhone); }
    if (role !== undefined) { setClauses.push("role = ?"); params.push(role); }
    if (department !== undefined) { setClauses.push("department = ?"); params.push(department); }
    if (shift !== undefined) { setClauses.push("shift = ?"); params.push(shift); }
    if (gender !== undefined) { setClauses.push("gender = ?"); params.push(gender); }
    if (resolvedActive !== undefined) { setClauses.push("isActive = ?"); params.push(resolvedActive); }

    if (!setClauses.length) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    setClauses.push("updatedAt = NOW()");
    params.push(id);

    await query(`UPDATE \`users\` SET ${setClauses.join(", ")} WHERE id = ?`, params);

    const [rows] = await query(`SELECT id, fullName, email, phoneNumber, role, department, isActive FROM \`users\` WHERE id = ?`, [id]);

    return res.status(200).json({
      success: true,
      message: "User updated successfully",
      user: rows[0] || {},
      data: rows[0] || {},
    });
  } catch (error) {
    console.error("Error updating user:", error);
    return res.status(500).json({ success: false, message: "Failed to update user", error: error.message });
  }
};

/**
 * DELETE /api/users/:id
 */
export const deleteUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await query(`SELECT id FROM \`users\` WHERE id = ? LIMIT 1`, [id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    await query(`DELETE FROM \`users\` WHERE id = ?`, [id]);

    return res.status(200).json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    return res.status(500).json({ success: false, message: "Failed to delete user", error: error.message });
  }
};

/**
 * POST /api/users/change-password
 * Body: { userId, currentPassword, newPassword }
 */
export const changePasswordUser = async (req, res) => {
  try {
    const userId = req.userId || req.user?.id || req.body.userId;
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "currentPassword and newPassword are required" });
    }
    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: "Passwords do not match" });
    }

    const [rows] = await query(`SELECT id, password FROM \`users\` WHERE id = ? LIMIT 1`, [userId]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const isMatch = await bcrypt.compare(currentPassword, rows[0].password || "");
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Current password is incorrect" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(newPassword, salt);

    await query(`UPDATE \`users\` SET password = ?, updatedAt = NOW() WHERE id = ?`, [hashed, userId]);

    return res.status(200).json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    console.error("Error changing password:", error);
    return res.status(500).json({ success: false, message: "Failed to change password", error: error.message });
  }
};

/**
 * GET /api/auth/doctor-profile/:doctorId
 * Returns doctor profile from MySQL users table
 */
export const getDoctorProfile = async (req, res) => {
  try {
    const { doctorId } = req.params;

    const [rows] = await query(
      `SELECT id, fullName, email, phoneNumber, role, department, specialization,
              gender, profilePhoto, isActive, isVerified, createdAt, updatedAt,
              experience, qualifications, bio, languages, address
       FROM \`users\` WHERE (id = ? OR email = ?) AND role = 'doctor' LIMIT 1`,
      [doctorId, doctorId]
    );

    // Try without role restriction if not found
    let profile = rows[0];
    if (!profile) {
      const [allRows] = await query(
        `SELECT id, fullName, email, phoneNumber, role, department, specialization,
                gender, profilePhoto, isActive, isVerified, createdAt, updatedAt
         FROM \`users\` WHERE id = ? LIMIT 1`,
        [doctorId]
      );
      profile = allRows[0];
    }

    if (!profile) {
      return res.status(404).json({ success: false, message: "Doctor profile not found" });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: profile.id,
        _id: profile.id,
        doctor_id: profile.id,
        fullName: profile.fullName || "",
        name: profile.fullName || "",
        email: profile.email || "",
        phone: profile.phoneNumber || "",
        role: profile.role || "doctor",
        department: profile.department || "",
        specialization: profile.specialization || "",
        gender: profile.gender || "",
        profilePhoto: profile.profilePhoto || null,
        bio: profile.bio || "",
        experience: profile.experience || "",
        qualifications: profile.qualifications || "",
        languages: profile.languages || "",
        address: profile.address || "",
        isActive: profile.isActive,
        isVerified: profile.isVerified,
        createdAt: profile.createdAt,
      },
      profile: {
        id: profile.id,
        _id: profile.id,
        fullName: profile.fullName || "",
        email: profile.email || "",
      },
    });
  } catch (error) {
    console.error("Error fetching doctor profile:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch doctor profile", error: error.message });
  }
};

/**
 * GET /api/departments
 * Returns department list. If a `users` table has a `department` column, derive from it.
 */
export const getDepartments = async (req, res) => {
  try {
    const { doctor_id, clinic_id } = req.query;

    let sql = `SELECT DISTINCT department FROM \`users\` WHERE department IS NOT NULL AND department != ''`;
    const params = [];

    if (doctor_id) {
      sql += ` AND (assignedDoctor = ? OR id = ?)`;
      params.push(doctor_id, doctor_id);
    }

    const [rows] = await query(sql, params);

    const departments = rows.map((r, idx) => ({
      id: idx + 1,
      name: r.department,
      department: r.department,
    }));

    // Add some defaults if empty
    const defaultDepts = [
      "General Medicine", "Cardiology", "Orthopedics", "Pediatrics",
      "Gynecology", "Neurology", "Dermatology", "ENT", "Ophthalmology", "Psychiatry",
    ];

    const finalDepts = departments.length > 0
      ? departments
      : defaultDepts.map((name, idx) => ({ id: idx + 1, name, department: name }));

    return res.status(200).json({
      success: true,
      data: finalDepts,
      departments: finalDepts,
      count: finalDepts.length,
    });
  } catch (error) {
    console.error("Error fetching departments:", error);
    // Return defaults on DB error
    const defaultDepts = [
      "General Medicine", "Cardiology", "Orthopedics", "Pediatrics",
      "Gynecology", "Neurology", "Dermatology", "ENT",
    ].map((name, idx) => ({ id: idx + 1, name, department: name }));

    return res.status(200).json({
      success: true,
      data: defaultDepts,
      departments: defaultDepts,
      count: defaultDepts.length,
    });
  }
};
