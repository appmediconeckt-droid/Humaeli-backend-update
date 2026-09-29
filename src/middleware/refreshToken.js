// middleware/refreshToken.js
// NOTE: The primary refresh logic lives in authController.refreshAccessToken
// (exposed as POST /auth/refresh-token).  This standalone helper is kept
// for backward-compatibility but now includes proper error handling.
import jwt from "jsonwebtoken";
import Session from "../models/sessionModel.js";
import { generateAccessToken, generateRefreshToken } from "../utils/token.js";
import User from "../models/userModel.js";
import { setAuthCookies } from "../utils/authCookies.js";

export const refreshAccessToken = async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({ success: false, message: "No refresh token provided" });
    }

    // Safely verify the refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: "Invalid or expired refresh token" });
    }

    // Look up session by sessionId embedded in the token
    const session = await Session.findById(decoded.sessionId);

    if (!session || !session.isActive) {
      return res.status(401).json({ success: false, message: "Session expired or not found" });
    }

    // Token rotation guard — reject if stored token doesn't match
    if (session.refreshToken !== refreshToken) {
      return res.status(401).json({ success: false, message: "Token mismatch" });
    }

    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: "User not found or deactivated" });
    }

    // Issue new tokens
    const newAccessToken  = generateAccessToken(user._id, session._id, user.role);
    const newRefreshToken = generateRefreshToken(user._id, session._id, user.role);

    // Persist the new refresh token (rotation)
    session.refreshToken = newRefreshToken;
    session.lastActivityAt = new Date();
    await session.save();

    setAuthCookies(res, newAccessToken, newRefreshToken);

    return res.json({
      success: true,
      accessToken:  newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    console.error("refreshAccessToken error:", error);
    return res.status(500).json({ success: false, message: "Server error during token refresh" });
  }
};
