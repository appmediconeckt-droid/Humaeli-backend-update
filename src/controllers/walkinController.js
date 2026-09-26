// src/controllers/walkinController.js
import WalkinAppointment from "../models/walkinAppointmentModel.js";
import { ensureClinicStaffSchema } from "../services/clinicStaffService.js";
import { withAppointmentSlot, indiaDateTime } from "../services/appointmentSlotService.js";
import { getConsultationTiming, emitQueueUpdated } from "../services/consultationTimingService.js";
import { enrichAppointmentsWithDelay } from "../services/appointmentDelayService.js";

export const getWalkinAppointments = async (req, res) => {
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

    if (req.query.date) {
      filter.appointment_date = req.query.date;
    }

    const rawStatus = req.query.appointment_status || req.query.status;
    if (rawStatus) {
      filter.appointment_status = String(rawStatus).toLowerCase();
    }

    const appointments = await WalkinAppointment.find(filter).sort({ createdAt: -1 });
    const targetDate = req.query.date || indiaDateTime().date;
    const enriched = await enrichAppointmentsWithDelay(appointments, doctorId, targetDate);

    return res.status(200).json({
      success: true,
      data: enriched,
      appointments: enriched,
      walkins: enriched,
      count: enriched.length,
    });
  } catch (error) {
    console.error("Error fetching walk-in appointments:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch walk-in appointments",
      error: error.message,
    });
  }
};

export const createWalkinAppointment = async (req, res) => {
  try {
    await ensureClinicStaffSchema();
    const {
      patient_name,
      patientName,
      name,
      phone_number,
      phoneNumber,
      phone,
      contactNumber,
      symptoms,
      problem,
      reason,
      doctor_id,
      doctorId,
      date_of_birth,
      dateOfBirth,
      age,
      gender,
      location,
      email,
      department,
      priority,
      doctor_name,
      doctorName,
      doctor,
      appointment_date,
      appointmentDate,
      appointment_time,
      appointmentTime,
      booking_source,
      bookingSource,
      status,
      appointment_status,
    } = req.body;

    const resolvedDoctorId = doctor_id || doctorId || req.userId || req.user?._id || req.user?.id;
    if (!resolvedDoctorId) {
      return res.status(400).json({
        success: false,
        message: "Doctor ID is required for walk-in appointment",
      });
    }

    const resolvedName = patient_name || patientName || name || "";
    if (!resolvedName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Patient name is required",
      });
    }

    const resolvedPhone = phone_number || phoneNumber || phone || contactNumber || "";
    const resolvedSymptoms = symptoms || problem || reason || "";
    const resolvedGender = gender || "Not specified";
    const resolvedDoctorName = doctor_name || doctorName || doctor || null;
    const resolvedDepartment = department || null;
    const resolvedPriority = priority || "Low";
    const resolvedLocation = location || null;
    const resolvedEmail = email || null;
    const resolvedDob = date_of_birth || dateOfBirth || null;
    const resolvedAge = age ? Number(age) : null;
    const resolvedSource = booking_source || bookingSource || "direct";

    const normalizedStatus = (status || appointment_status || "booked").toLowerCase();
    const todayDateStr = indiaDateTime().date;
    const resolvedDate = appointment_date || appointmentDate || todayDateStr;
    const resolvedTime = appointment_time || appointmentTime;
    const currentTime = indiaDateTime().time.split(":").map(Number);
    const newRecord = await withAppointmentSlot({
      doctorId: resolvedDoctorId,
      date: resolvedDate,
      time: resolvedTime,
      clinicId: req.body.clinic_id,
      earliestTime: resolvedDate === todayDateStr ? currentTime[0] * 60 + currentTime[1] + currentTime[2] / 60 : null,
    }, (slot) => WalkinAppointment.create({
      doctor_id: resolvedDoctorId,
      clinic_id: slot.clinicId || null,
      patient_name: resolvedName.trim(),
      phone_number: resolvedPhone.trim(),
      symptoms: resolvedSymptoms.trim(),
      gender: resolvedGender,
      date_of_birth: resolvedDob ? new Date(resolvedDob) : null,
      age: resolvedAge,
      location: resolvedLocation,
      email: resolvedEmail,
      department: resolvedDepartment,
      priority: resolvedPriority,
      doctor_name: resolvedDoctorName,
      appointment_date: resolvedDate,
      appointment_time: slot.time,
      token_number: slot.token,
      appointment_status: normalizedStatus,
      booking_source: resolvedSource,
    }));

    return res.status(201).json({
      success: true,
      message: "Walk-in appointment booked successfully",
      data: newRecord,
      appointment: newRecord,
      token: newRecord.token_number,
      token_number: newRecord.token_number,
    });
  } catch (error) {
    console.error("Error creating walk-in appointment:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Failed to create walk-in appointment",
      error: error.message,
    });
  }
};

export const getWalkinAppointmentById = async (req, res) => {
  try {
    const { id } = req.params;
    const appointment = await WalkinAppointment.findById(id);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Walk-in appointment not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: appointment,
      appointment,
    });
  } catch (error) {
    console.error("Error fetching walk-in appointment:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch walk-in appointment",
      error: error.message,
    });
  }
};

export const updateWalkinAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const appointment = await WalkinAppointment.findById(id);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Walk-in appointment not found",
      });
    }

    const updates = { ...req.body };
    delete updates.id;
    delete updates._id;
    delete updates.token_number;
    delete updates.token;
    delete updates.doctor_id;
    delete updates.consultation_timing;
    delete updates.consultation_action;

    const requestedStatus = String(req.body.status || req.body.appointment_status || "").toLowerCase();
    if (req.body.consultation_action || ["in-progress", "completed", "cancelled", "canceled"].includes(requestedStatus)) {
      if (String(req.userId || req.user?._id || "") !== String(appointment.doctor_id)) {
        return res.status(403).json({ message: "Only the assigned doctor can update consultation timing" });
      }
      const timing = await getConsultationTiming(appointment, req.body);
      if (timing) updates.consultation_timing = timing;
    }

    // Normalize status fields
    if (updates.status) {
      updates.appointment_status = String(updates.status).toLowerCase();
      delete updates.status;
    } else if (updates.appointment_status) {
      updates.appointment_status = String(updates.appointment_status).toLowerCase();
    }

    if (updates.follow_up_date) {
      updates.follow_up_date = new Date(updates.follow_up_date);
    }
    if (updates.date_of_birth) {
      updates.date_of_birth = new Date(updates.date_of_birth);
    }

    const changesSlot = updates.appointment_date !== undefined || updates.appointment_time !== undefined || updates.clinic_id !== undefined;
    const updated = changesSlot
      ? await withAppointmentSlot({
          doctorId: appointment.doctor_id,
          date: updates.appointment_date || appointment.appointment_date,
          time: updates.appointment_time || appointment.appointment_time,
          clinicId: req.body.clinic_id || appointment.clinic_id,
          excludeWalkinId: id,
        }, (slot) => WalkinAppointment.findByIdAndUpdate(id, { $set: {
          ...updates, clinic_id: slot.clinicId || null, appointment_date: slot.date, appointment_time: slot.time, token_number: slot.token,
        } }, { new: true }))
      : await WalkinAppointment.findByIdAndUpdate(id, { $set: updates }, { new: true });

    await emitQueueUpdated(updated);
    return res.status(200).json({
      success: true,
      message: "Walk-in appointment updated successfully",
      data: updated,
      appointment: updated,
    });
  } catch (error) {
    console.error("Error updating walk-in appointment:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Failed to update walk-in appointment",
      error: error.message,
    });
  }
};

export const deleteWalkinAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const appointment = await WalkinAppointment.findById(id);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Walk-in appointment not found",
      });
    }

    await WalkinAppointment.deleteOne({ _id: id });

    return res.status(200).json({
      success: true,
      message: "Walk-in appointment deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting walk-in appointment:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete walk-in appointment",
      error: error.message,
    });
  }
};
