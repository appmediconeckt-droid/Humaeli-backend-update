// src/controllers/followUpController.js
import FollowUp from "../models/followUpModel.js";

export const getFollowUps = async (req, res) => {
  try {
    const doctorId =
      req.query.doctor_id ||
      req.query.doctorId ||
      req.userId ||
      req.user?._id ||
      req.user?.id;

    const filter = {};
    if (doctorId) {
      filter.doctor_id = doctorId;
    }

    const followUps = await FollowUp.find(filter).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: followUps,
      followups: followUps,
      followUps,
      count: followUps.length,
    });
  } catch (error) {
    console.error("Error fetching follow-ups:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch follow-ups",
      error: error.message,
    });
  }
};

export const createFollowUp = async (req, res) => {
  try {
    const doctorId =
      req.body.doctor_id ||
      req.body.doctorId ||
      req.userId ||
      req.user?._id;

    if (!doctorId) {
      return res.status(400).json({
        success: false,
        message: "Doctor ID is required",
      });
    }

    const {
      patient_id,
      patientId,
      appointment_id,
      appointmentId,
      patient_name,
      patientName,
      phone_number,
      phone,
      age,
      follow_up_date,
      followUpDate,
      follow_up_time,
      followUpTime,
      follow_up_type,
      followUpType,
      type,
      status,
      reason,
      notes,
      doctor_name,
    } = req.body;

    const followUpDateVal = follow_up_date || followUpDate;
    const newFollowUp = await FollowUp.create({
      doctor_id: doctorId,
      patient_id: patient_id || patientId || null,
      appointment_id: appointment_id || appointmentId || null,
      patient_name: patient_name || patientName || "",
      phone_number: phone_number || phone || "",
      age: age ? Number(age) : null,
      follow_up_date: followUpDateVal ? new Date(followUpDateVal) : new Date(),
      follow_up_time: follow_up_time || followUpTime || "",
      follow_up_type: follow_up_type || followUpType || type || "routine",
      status: (status || "pending").toLowerCase(),
      reason: reason || notes || "",
      notes: notes || reason || "",
      doctor_name: doctor_name || null,
    });

    return res.status(201).json({
      success: true,
      message: "Follow-up scheduled successfully",
      data: newFollowUp,
      followUp: newFollowUp,
    });
  } catch (error) {
    console.error("Error creating follow-up:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create follow-up",
      error: error.message,
    });
  }
};

export const updateFollowUp = async (req, res) => {
  try {
    const { id } = req.params;
    const followUp = await FollowUp.findById(id);
    if (!followUp) {
      return res.status(404).json({
        success: false,
        message: "Follow-up not found",
      });
    }

    const updates = { ...req.body };
    delete updates.id;
    delete updates._id;

    if (updates.follow_up_date) {
      updates.follow_up_date = new Date(updates.follow_up_date);
    }
    if (updates.type && !updates.follow_up_type) {
      updates.follow_up_type = updates.type;
    }

    const updated = await FollowUp.findByIdAndUpdate(id, { $set: updates }, { new: true });

    return res.status(200).json({
      success: true,
      message: "Follow-up updated successfully",
      data: updated,
      followUp: updated,
    });
  } catch (error) {
    console.error("Error updating follow-up:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update follow-up",
      error: error.message,
    });
  }
};

export const deleteFollowUp = async (req, res) => {
  try {
    const { id } = req.params;
    const followUp = await FollowUp.findById(id);
    if (!followUp) {
      return res.status(404).json({
        success: false,
        message: "Follow-up not found",
      });
    }

    await FollowUp.deleteOne({ _id: id });

    return res.status(200).json({
      success: true,
      message: "Follow-up deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting follow-up:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete follow-up",
      error: error.message,
    });
  }
};
