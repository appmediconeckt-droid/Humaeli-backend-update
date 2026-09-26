// src/controllers/availabilityController.js
import DateRange from "../models/dateRangeModel.js";
import UnavailableDate from "../models/unavailableDateModel.js";
import Clinic from "../models/clinicModel.js";
import { buildDaySlots, indiaDateTime } from "../services/appointmentSlotService.js";

const unavailableDatesFor = async (doctorId, clinicId, existingRanges = null) => {
  const filter = { doctor_id: doctorId, is_unavailable: true };
  if (clinicId && clinicId !== "all") filter.clinic_id = String(clinicId);
  const [globalDates, clinicDates] = await Promise.all([
    UnavailableDate.find({ doctor_id: doctorId }), existingRanges
      ? existingRanges.filter(range => range.is_unavailable === true || Number(range.is_unavailable) === 1)
      : DateRange.find(filter),
  ]);
  return [
    ...globalDates.map(record => ({ date: record.unavailable_date, scope: "all" })),
    ...clinicDates.map(record => ({ date: record.availability_date, clinic_id: record.clinic_id })),
  ];
};

export const getAvailabilityRanges = async (req, res) => {
  try {
    const doctorId =
      req.query.doctor_id ||
      req.query.doctorId ||
      req.userId ||
      req.user?._id ||
      req.user?.id;

    const clinicId = req.query.clinic_id || req.query.clinicId;

    if (!doctorId) {
      return res.status(200).json({
        success: true,
        data: [],
        ranges: [],
        existingRanges: [],
        unavailableDates: [],
      });
    }

    const filter = { doctor_id: doctorId };
    if (clinicId && clinicId !== "all") {
      filter.clinic_id = clinicId;
    }

    const ranges = await DateRange.find(filter).sort({ createdAt: -1 });

    const unavailableDates = await unavailableDatesFor(doctorId, clinicId, ranges);

    return res.status(200).json({
      success: true,
      data: ranges,
      ranges,
      existingRanges: ranges,
      unavailableDates,
      unavailable_dates: unavailableDates,
      count: ranges.length,
    });
  } catch (error) {
    console.error("Error fetching availability ranges:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch availability ranges",
      error: error.message,
    });
  }
};

export const createAvailabilityRange = async (req, res) => {
  try {
    const doctorId =
      req.body.doctor_id ||
      req.body.doctorId ||
      req.userId ||
      req.user?._id ||
      req.user?.id;

    const clinicId = req.body.clinic_id || req.body.clinicId || "";
    const date = req.body.date || req.body.availability_date || req.body.available_date || null;
    const weekday = req.body.weekday !== undefined && req.body.weekday !== null ? Number(req.body.weekday) : null;
    const startTime = req.body.start_time || req.body.startTime || req.body.start || "";
    const endTime = req.body.end_time || req.body.endTime || req.body.end || "";
    const slotDuration = Number(req.body.slot_duration || req.body.slotDuration || req.body.duration || 15);

    if (!doctorId) {
      return res.status(400).json({
        success: false,
        message: "Doctor ID is required",
      });
    }

    const newRange = await DateRange.create({
      doctor_id: doctorId,
      clinic_id: String(clinicId),
      availability_date: date,
      weekday,
      start_time: startTime,
      end_time: endTime,
      slot_duration: slotDuration,
      is_unavailable: 0,
    });

    return res.status(201).json({
      success: true,
      message: "Availability range created successfully",
      data: newRange,
      range: newRange,
      existingRanges: [newRange],
    });
  } catch (error) {
    console.error("Error creating availability range:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create availability range",
      error: error.message,
    });
  }
};

export const deleteAvailabilityRange = async (req, res) => {
  try {
    const { id } = req.params;
    const range = await DateRange.findById(id);
    if (!range) {
      return res.status(404).json({
        success: false,
        message: "Availability range not found",
      });
    }

    await DateRange.deleteOne({ _id: id });

    return res.status(200).json({
      success: true,
      message: "Availability range deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting availability range:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete availability range",
      error: error.message,
    });
  }
};

export const getAvailableRanges = async (req, res) => {
  try {
    const doctorId =
      req.query.doctor_id ||
      req.query.doctorId ||
      req.userId ||
      req.user?._id;

    const clinicId = req.query.clinic_id || req.query.clinicId;
    const date = req.query.date;

    const filter = { doctor_id: doctorId, is_unavailable: 0 };
    if (clinicId && clinicId !== "all") {
      filter.clinic_id = clinicId;
    }

    const ranges = await DateRange.find(filter);
    const unavailable = await unavailableDatesFor(doctorId, clinicId);

    return res.status(200).json({
      success: true,
      data: ranges,
      ranges,
      existingRanges: ranges,
      unavailableDates: unavailable,
    });
  } catch (error) {
    console.error("Error fetching available ranges:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch available ranges",
      error: error.message,
    });
  }
};

const changeUnavailableDate = async (req, res, blocked) => {
  try {
    const doctorId = req.userId || req.user?._id;
    const requestedDoctor = req.body?.doctor_id || req.body?.doctorId;
    if (!doctorId) return res.status(401).json({ success: false, message: "Authentication required" });
    if (requestedDoctor && String(requestedDoctor) !== String(doctorId)) {
      return res.status(403).json({ success: false, message: "Cannot change another doctor's availability" });
    }
    const date = req.body?.date || req.body?.unavailable_date;
    try { buildDaySlots([], date); } catch {
      return res.status(400).json({ success: false, message: "A valid date is required" });
    }
    if (date < indiaDateTime().date) return res.status(400).json({ success: false, message: "Cannot change past dates" });
    const clinicId = req.body?.clinic_id;
    if (!clinicId) return res.status(400).json({ success: false, message: "Select a clinic" });
    const clinic = await Clinic.findOne({ _id: String(clinicId), doctor_id: doctorId });
    if (!clinic) return res.status(403).json({ success: false, message: "Clinic does not belong to this doctor" });
    const filter = { doctor_id: doctorId, clinic_id: String(clinicId), availability_date: date, is_unavailable: true };
    if (blocked) {
      if (!await DateRange.findOne(filter)) {
        await DateRange.create({ ...filter, weekday: null, start_time: "00:00:00", end_time: "23:59:00", slot_duration: 15 });
      }
    } else {
      // Legacy whole-doctor exceptions must be explicitly restored across clinics.
      const globalDate = await UnavailableDate.findOne({ doctor_id: doctorId, unavailable_date: date });
      if (globalDate && req.body?.scope !== "all") {
        return res.status(409).json({ success: false, message: "This date is unavailable at all clinics. Choose restore for all clinics.", code: "GLOBAL_UNAVAILABLE" });
      }
      if (req.body?.scope === "all") await UnavailableDate.deleteMany({ doctor_id: doctorId, unavailable_date: date });
      await DateRange.deleteMany(filter);
    }
    return res.json({ success: true, blocked, date, clinic_id: String(clinicId), message: blocked ? "Clinic marked unavailable for this date" : "Availability restored; saved timings preserved" });
  } catch (error) {
    console.error("Availability exception failed:", error.message);
    return res.status(500).json({ success: false, message: "Could not update availability. Please try again." });
  }
};

export const setUnavailableDate = (req, res) => changeUnavailableDate(req, res, true);
export const removeUnavailableDate = (req, res) => changeUnavailableDate(req, res, false);

export const clearDateRanges = async (req, res) => {
  try {
    const doctorId =
      req.body?.doctor_id ||
      req.query?.doctor_id ||
      req.userId;

    const date = req.body?.date || req.query?.date;

    if (!doctorId || !date) {
      return res.status(400).json({
        success: false,
        message: "Doctor ID and Date are required",
      });
    }

    await DateRange.deleteMany({
      doctor_id: doctorId,
      availability_date: date,
    });

    await UnavailableDate.deleteMany({
      doctor_id: doctorId,
      unavailable_date: date,
    });

    return res.status(200).json({
      success: true,
      message: "Date ranges cleared successfully",
    });
  } catch (error) {
    console.error("Error clearing date ranges:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to clear date ranges",
      error: error.message,
    });
  }
};

export const clearAllRanges = async (req, res) => {
  try {
    const doctorId = req.userId || req.user?._id;
    const requestedDoctor = req.body?.doctor_id;
    if (requestedDoctor && String(requestedDoctor) !== String(doctorId)) {
      return res.status(403).json({ success: false, message: "Cannot clear another doctor's availability" });
    }
    const clinicId = req.body?.clinic_id;
    const filter = { doctor_id: doctorId };
    if (clinicId && clinicId !== "all") filter.clinic_id = String(clinicId);
    await DateRange.deleteMany(filter);
    // Unavailable dates apply to the doctor across all clinics.
    // A single-clinic reset must preserve those global dates.
    if (!clinicId || clinicId === "all") {
      await UnavailableDate.deleteMany({ doctor_id: doctorId });
    }
    return res.json({ success: true, message: "Availability cleared successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to clear availability" });
  }
};
