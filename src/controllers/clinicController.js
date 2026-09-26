// src/controllers/clinicController.js
import Clinic from "../models/clinicModel.js";
import { authenticatedDoctorId, requireOwnedClinic, removeOwnedClinic } from "../services/clinicStaffService.js";

export const getClinics = async (req, res) => {
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

    const clinics = await Clinic.find(filter).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: clinics,
      clinics,
      count: clinics.length,
    });
  } catch (error) {
    console.error("Error fetching clinics:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch clinics",
      error: error.message,
    });
  }
};

export const createClinic = async (req, res) => {
  try {
    const doctorId = authenticatedDoctorId(req);

    if (!doctorId) {
      return res.status(400).json({
        success: false,
        message: "Doctor ID is required to create a clinic",
      });
    }

    const clinicName = req.body.clinic_name || req.body.clinicName || req.body.name || "";
    if (!String(clinicName).trim()) return res.status(400).json({ success: false, message: "Clinic name is required" });
    const phone = req.body.phone_number || req.body.phoneNumber || req.body.phone || "";
    const address = req.body.location || req.body.address || "";

    let photoPath = null;
    if (req.file) {
      photoPath = req.file.path;
    } else if (req.body.clinic_photo || req.body.photo) {
      photoPath = req.body.clinic_photo || req.body.photo;
    }

    const newClinic = await Clinic.create({
      doctor_id: doctorId,
      clinic_name: clinicName,
      phone_number: phone,
      location: address,
      clinic_photo: photoPath,
    });

    return res.status(201).json({
      success: true,
      message: "Clinic created successfully",
      data: newClinic,
      clinic: newClinic,
    });
  } catch (error) {
    console.error("Error creating clinic:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create clinic",
      error: error.message,
    });
  }
};

export const getClinicById = async (req, res) => {
  try {
    const { id } = req.params;
    const clinic = await Clinic.findById(id);
    if (!clinic) {
      return res.status(404).json({
        success: false,
        message: "Clinic not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: clinic,
      clinic,
    });
  } catch (error) {
    console.error("Error fetching clinic:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch clinic",
      error: error.message,
    });
  }
};

export const updateClinic = async (req, res) => {
  try {
    const { id } = req.params;
    const clinic = await requireOwnedClinic(authenticatedDoctorId(req), id);
    if (!clinic) {
      return res.status(404).json({
        success: false,
        message: "Clinic not found",
      });
    }

    const updates = {};
    for (const field of ["clinic_name", "phone_number", "location", "clinic_photo"]) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (req.file) {
      updates.clinic_photo = req.file.path;
    }

    const updated = await Clinic.findByIdAndUpdate(id, { $set: updates }, { new: true });

    return res.status(200).json({
      success: true,
      message: "Clinic updated successfully",
      data: updated,
      clinic: updated,
    });
  } catch (error) {
    console.error("Error updating clinic:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Failed to update clinic",
      error: error.message,
    });
  }
};

export const deleteClinic = async (req, res) => {
  try {
    const { id } = req.params;
    await removeOwnedClinic(authenticatedDoctorId(req), id);

    return res.status(200).json({
      success: true,
      message: "Clinic deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting clinic:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Failed to delete clinic",
      error: error.message,
    });
  }
};
