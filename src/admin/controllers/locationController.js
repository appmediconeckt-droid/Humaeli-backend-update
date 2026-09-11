import User from "../models/User.js";

// GET /api/admin/location/:userId/history?event=login
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

