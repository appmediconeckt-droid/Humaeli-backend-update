// src/controllers/doctorBreakController.js
import DoctorBreak from "../models/doctorBreakModel.js";
import { emitQueueUpdated } from "../services/consultationTimingService.js";
import { indiaDateTime } from "../services/appointmentSlotService.js";

export const getActiveBreak = async (req, res) => {
  try {
    const doctorId =
      req.query.doctor_id ||
      req.query.doctorId ||
      req.userId ||
      req.user?._id ||
      req.user?.id;

    if (!doctorId) {
      return res.status(200).json({
        active: false,
        break: null,
      });
    }

    const activeBreak = await DoctorBreak.findOne({
      doctor_id: doctorId,
      status: "active",
    });

    if (!activeBreak) {
      return res.status(200).json({
        active: false,
        break: null,
      });
    }

    const breakStartMs = new Date(activeBreak.started_at).getTime();
    const plannedMinutes = Number(activeBreak.planned_minutes) || 15;
    const breakEndMs = breakStartMs + plannedMinutes * 60000;
    const nowMs = Date.now();

    // If past expected end time, mark as ended
    if (breakEndMs <= nowMs) {
      await DoctorBreak.findByIdAndUpdate(activeBreak.id, {
        $set: {
          status: "ended",
          ended_at: new Date(breakEndMs),
          active_key: null,
        },
      });

      return res.status(200).json({
        active: false,
        break: null,
      });
    }

    const expectedEndAt = new Date(breakEndMs).toISOString();

    const breakData = {
      id: activeBreak.id,
      _id: activeBreak.id,
      doctor_id: activeBreak.doctor_id,
      started_at: activeBreak.started_at,
      ended_at: activeBreak.ended_at,
      planned_minutes: plannedMinutes,
      expected_end_at: expectedEndAt,
      reason: activeBreak.reason,
      status: activeBreak.status,
    };

    return res.status(200).json({
      active: true,
      break: breakData,
      data: { active: true, break: breakData },
    });
  } catch (error) {
    console.error("Error checking active break:", error);
    return res.status(500).json({
      success: false,
      active: false,
      break: null,
      message: "Failed to check active break",
      error: error.message,
    });
  }
};

export const startBreak = async (req, res) => {
  try {
    const doctorId =
      req.body.doctor_id ||
      req.body.doctorId ||
      req.query.doctor_id ||
      req.query.doctorId ||
      req.userId ||
      req.user?._id ||
      req.user?.id;

    if (!doctorId) {
      return res.status(400).json({
        success: false,
        message: "Doctor ID is required to start a break",
      });
    }

    const minutes = Number(req.body.duration_minutes || req.body.duration || 15);
    const reason = req.body.reason || "Personal break";

    // End any existing active breaks for this doctor
    await DoctorBreak.updateMany(
      { doctor_id: doctorId, status: "active" },
      { $set: { status: "ended", ended_at: new Date(), active_key: null } }
    );

    const now = new Date();
    const expectedEndAt = new Date(now.getTime() + minutes * 60000).toISOString();

    const newBreak = await DoctorBreak.create({
      doctor_id: doctorId,
      started_at: now,
      planned_minutes: minutes,
      reason,
      active_key: doctorId,
      status: "active",
    });

    const breakData = {
      id: newBreak.id,
      _id: newBreak.id,
      doctor_id: newBreak.doctor_id,
      started_at: now.toISOString(),
      planned_minutes: minutes,
      expected_end_at: expectedEndAt,
      reason,
      status: "active",
    };

    await emitQueueUpdated({ doctor_id: doctorId, appointment_date: indiaDateTime(now).date });
    return res.status(201).json({
      success: true,
      message: "Break started successfully",
      break: breakData,
      data: { break: breakData },
    });
  } catch (error) {
    console.error("Error starting break:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to start break",
      error: error.message,
    });
  }
};

export const endBreak = async (req, res) => {
  try {
    const { id } = req.params;
    const doctorId = req.userId || req.user?._id || req.body.doctor_id;

    const filter = { _id: id };
    const currentBreak = await DoctorBreak.findById(id);
    if (!currentBreak) {
      // If not found by ID, try ending active break by doctorId if provided
      if (doctorId) {
        await DoctorBreak.updateMany(
          { doctor_id: doctorId, status: "active" },
          { $set: { status: "ended", ended_at: new Date(), active_key: null } }
        );
        return res.status(200).json({
          success: true,
          message: "Active break ended successfully",
        });
      }
      return res.status(404).json({
        success: false,
        message: "Break session not found",
      });
    }

    await DoctorBreak.findByIdAndUpdate(id, {
      $set: {
        status: "ended",
        ended_at: new Date(),
        active_key: null,
      },
    });

    await emitQueueUpdated({ doctor_id: currentBreak.doctor_id, appointment_date: indiaDateTime().date });

    return res.status(200).json({
      success: true,
      message: "Break ended successfully",
    });
  } catch (error) {
    console.error("Error ending break:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to end break",
      error: error.message,
    });
  }
};

export const getDoctorBreaks = async (req, res) => {
  try {
    const doctorId =
      req.query.doctor_id ||
      req.query.doctorId ||
      req.userId ||
      req.user?._id ||
      req.user?.id;

    if (!doctorId) {
      return res.status(400).json({
        success: false,
        message: "Doctor ID is required",
      });
    }

    const breaks = await DoctorBreak.find({ doctor_id: doctorId }).sort({ started_at: -1 });

    return res.status(200).json({
      success: true,
      data: breaks,
      breaks,
    });
  } catch (error) {
    console.error("Error fetching doctor breaks:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch doctor breaks",
      error: error.message,
    });
  }
};
