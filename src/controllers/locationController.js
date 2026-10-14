import User from "../models/userModel.js";
import { LOCATION_EVENTS } from "../utils/locationEvents.js";
import { reverseGeocode } from "../services/geocodingService.js";
import Chat from "../models/Chat.js";

const MAX_HISTORY = 20;

const getClientIp = (req) =>
  (req.headers["x-forwarded-for"]?.split(",")[0] || req.socket?.remoteAddress || "").trim();

// ──────────────────────────────────────────────────────────────
// POST /api/location/update
// Body: { latitude, longitude, event? }
// Auth required.
// ──────────────────────────────────────────────────────────────
export const updateLocation = async (req, res) => {
  try {
    const { latitude, longitude, event = "manual" } = req.body;
    if (!LOCATION_EVENTS.includes(event)) {
      return res.status(400).json({ success: false, message: 'Invalid location event' });
    }

    const lat = Number(latitude);
    const lng = Number(longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({
        success: false,
        message: "latitude and longitude are required and must be numbers",
      });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({
        success: false,
        message: "latitude must be in [-90,90] and longitude in [-180,180]",
      });
    }

    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    let geo = { address: "", city: "", state: "", country: "" };
    try {
      geo = await reverseGeocode(lat, lng);
    } catch (err) {
      console.warn("Reverse geocode failed:", err.message);
      // continue with empty address — coords still saved
    }

    const ip = getClientIp(req);
    const now = new Date();

    const current = {
      type: "Point",
      coordinates: [lng, lat], // GeoJSON order: [lng, lat]
      address: geo.address,
      city: geo.city,
      state: geo.state,
      country: geo.country,
      capturedAt: now,
      ipAddress: ip,
    };

    const historyEntry = {
      coordinates: [lng, lat],
      address: geo.address,
      capturedAt: now,
      event,
      ipAddress: ip,
    };

    const updated = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          "locationData.current": current,
          locationConsent: true,
        },
        $push: {
          "locationData.history": {
            $each: [historyEntry],
            $slice: -MAX_HISTORY, // keep only last N
          },
        },
      },
      { returnDocument: "after" },
    ).select("fullName role locationData locationConsent");

    if (!updated) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      data: {
        userId: updated._id,
        role: updated.role,
        current: updated.locationData.current,
        isVerified: updated.locationData.isVerified,
      },
    });
  } catch (err) {
    console.error("updateLocation error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────
const pickLocationSummary = (user) => {
  const current = user?.locationData?.current;
  const coords = current?.coordinates;
  const hasCoords = Array.isArray(coords) && coords.length === 2;

  return {
    legacyText: user?.location || null,
    current: hasCoords
      ? {
          type: current.type || "Point",
          coordinates: coords,
          address: current.address || "",
          city: current.city || "",
          state: current.state || "",
          country: current.country || "",
          capturedAt: current.capturedAt || null,
        }
      : null,
  };
};

export const getChatLocations = async (req, res) => {
  try {
    const { chatId } = req.params;

    const chat = await Chat.findOne({ chatId })
      .populate("userId", "fullName role location locationData.current")
      .populate("counselorId", "fullName role location locationData.current")
      .lean();

    if (!chat) {
      return res.status(404).json({ success: false, message: "Chat not found" });
    }

    const requesterId = req.user?._id || req.user?.id;
    const isParticipant =
      chat.userId?._id?.toString() === requesterId?.toString() ||
      chat.counselorId?._id?.toString() === requesterId?.toString();

    if (!isParticipant) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    return res.status(200).json({
      success: true,
      data: {
        chatId: chat.chatId,
        user: {
          id: chat.userId?._id,
          fullName: chat.userId?.fullName,
          role: chat.userId?.role,
          location: pickLocationSummary(chat.userId),
        },
        counsellor: {
          id: chat.counselorId?._id,
          fullName: chat.counselorId?.fullName,
          role: chat.counselorId?.role,
          location: pickLocationSummary(chat.counselorId),
        },
      },
    });
  } catch (err) {
    console.error("getChatLocations error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────────────
// GET /api/location/admin/all
// Admin: list ALL users + counsellors that have location data.
// Query: ?role=user|counsellor   (optional filter)
// Used by the admin map to plot pins for everyone at once.
// ──────────────────────────────────────────────────────────────
export const adminAllLocations = async (req, res) => {
  try {
    const { role } = req.query;
    const filter = {
      "locationData.current.coordinates": { $exists: true, $ne: [] },
    };
    if (role === "user" || role === "counsellor") {
      filter.role = role;
    } else {
      filter.role = { $in: ["user", "counsellor"] };
    }

    const docs = await User.find(filter)
      .select(
        "fullName email role location locationData.current locationData.isVerified createdAt phoneNumber specialization experience rating",
      )
      .sort({ "locationData.current.capturedAt": -1 })
      .limit(500)
      .lean();

    const data = docs.map((u) => ({
      _id: u._id,
      fullName: u.fullName,
      email: u.email,
      phoneNumber: u.phoneNumber,
      role: u.role,
      declaredLocation: u.location || null,
      specialization: u.specialization,
      experience: u.experience,
      rating: u.rating,
      current: u.locationData?.current || null,
      isVerified: !!u.locationData?.isVerified,
      createdAt: u.createdAt,
    }));

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (err) {
    console.error("adminAllLocations error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────────────
// GET /api/admin/location/pending
// Admin: list counsellors whose locations are not yet verified.
// ──────────────────────────────────────────────────────────────
export const adminPendingCounsellors = async (req, res) => {
  try {
    const counsellors = await User.find({
      role: "counsellor",
      "locationData.isVerified": false,
    })
      .select(
        "fullName email phoneNumber location locationData createdAt qualification specialization",
      )
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: counsellors.length,
      data: counsellors,
    });
  } catch (err) {
    console.error("adminPendingCounsellors error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/location/admin/:userId/history?event=login
// Admin: fetch location history (optionally filtered by event) for a user or counsellor.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const adminGetLocationHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const { event } = req.query;

    const user = await User.findById(userId)
      .select("fullName email role location locationData locationConsent createdAt")
      .lean();

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const history = Array.isArray(user.locationData?.history) ? user.locationData.history : [];
    const filtered = event ? history.filter((h) => h?.event === event) : history;

    return res.status(200).json({
      success: true,
      data: {
        userId: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        legacyText: user.location || null,
        locationConsent: !!user.locationConsent,
        current: user.locationData?.current || null,
        isVerified: !!user.locationData?.isVerified,
        verifiedAt: user.locationData?.verifiedAt || null,
        history: filtered,
      },
    });
  } catch (err) {
    console.error("adminGetLocationHistory error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ──────────────────────────────────────────────────────────────
// POST /api/admin/location/:userId/verify
// Body: { approve: boolean, notes?: string }
// ──────────────────────────────────────────────────────────────
export const adminVerifyLocation = async (req, res) => {
  try {
    const { userId } = req.params;
    const { approve, notes = "" } = req.body;

    if (typeof approve !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "`approve` (boolean) is required",
      });
    }

    const adminId = req.user?._id || req.user?.id;

    const updated = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          "locationData.isVerified": approve,
          "locationData.verifiedAt": new Date(),
          "locationData.verifiedBy": adminId,
          "locationData.verificationNotes": notes,
        },
      },
      { returnDocument: "after" },
    ).select("fullName role locationData");

    if (!updated) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      data: {
        userId: updated._id,
        isVerified: updated.locationData.isVerified,
        verifiedAt: updated.locationData.verifiedAt,
        notes: updated.locationData.verificationNotes,
      },
    });
  } catch (err) {
    console.error("adminVerifyLocation error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
