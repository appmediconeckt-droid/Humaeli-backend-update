// middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import User from "../models/userModel.js";
import Session from "../models/sessionModel.js";
import { generateAccessToken, generateRefreshToken } from "../utils/token.js";

// ────────────────────────────────────────────────────────────────────────────
// Helper: attempt silent token refresh and continue the request
// ────────────────────────────────────────────────────────────────────────────
const tryRefreshAndContinue = async (req, res, next, incomingRefreshToken) => {
  try {
    // 1. Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(incomingRefreshToken, process.env.REFRESH_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: "Refresh token invalid or expired. Please log in again.",
        code: "REFRESH_INVALID",
      });
    }

    if (!decoded.sessionId || typeof decoded.sessionId !== "string" || decoded.sessionId.length < 12) {
      return res.status(401).json({
        success: false,
        error: "Invalid session. Please log in again.",
        code: "SESSION_INVALID",
      });
    }

    // 2. Find the session
    const session = await Session.findById(decoded.sessionId);
    if (!session || !session.isActive) {
      return res.status(401).json({
        success: false,
        error: "Session expired. Please log in again.",
        code: "SESSION_EXPIRED",
      });
    }

    // 3. Ensure refresh token matches what we stored (token rotation guard)
    if (session.refreshToken !== incomingRefreshToken) {
      return res.status(401).json({
        success: false,
        error: "Token mismatch. Please log in again.",
        code: "TOKEN_MISMATCH",
      });
    }

    // 4. Load user
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: "User not found or deactivated.",
        code: "USER_NOT_FOUND",
      });
    }

    if (!user.isOnline || user.lastSeen) {
      await User.updateOne(
        { _id: user._id },
        { $set: { isOnline: true, lastSeen: null } },
      );
      user.isOnline = true;
      user.lastSeen = null;
    }

    // 5. Issue new tokens (rotation)
    const newAccessToken = generateAccessToken(user._id, session._id);
    const newRefreshToken = generateRefreshToken(user._id, session._id);

    // 6. Persist new refresh token
    session.refreshToken = newRefreshToken;
    await session.save();

    // 7. Set new cookies
    const cookieBase = {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    };
    res.cookie("accessToken", newAccessToken);
    res.cookie("refreshToken", newRefreshToken);
    // 8. Expose new access token in header so frontend can store it
    res.setHeader("X-New-Access-Token", newAccessToken);

    // 9. Attach user and continue
    req.user = user;
    req.userId = user._id;
    req.userRole = user.role;
    req.newAccessToken = newAccessToken;
    req.sessionId = session._id;

    return next();
  } catch (err) {
    console.error("tryRefreshAndContinue error:", err);
    return res.status(401).json({
      success: false,
      error: "Authentication failed. Please log in again.",
      code: "REFRESH_FAILED",
    });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// Main auth middleware
// ────────────────────────────────────────────────────────────────────────────
export const authMiddleware = async (req, res, next) => {
  try {
    // ── 1. Extract access token (header > cookie) ──
    let token = req.headers.authorization;
    if (token && token.startsWith("Bearer ")) {
      token = token.split(" ")[1];
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    // ── 2. No access token at all ──
    if (!token) {
      if (refreshToken) {
        // Try to silently refresh
        return await tryRefreshAndContinue(req, res, next, refreshToken);
      }
      return res.status(401).json({
        success: false,
        error: "Authentication required. No token provided.",
        code: "NO_TOKEN",
      });
    }

    // ── 3. Verify access token ──
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.ACCESS_SECRET);
    } catch (error) {
      if (error.name === "TokenExpiredError" && refreshToken) {
        // Access token expired – silently refresh using refresh token
        console.log("Access token expired, attempting silent refresh...");
        return await tryRefreshAndContinue(req, res, next, refreshToken);
      }
      return res.status(401).json({
        success: false,
        error:
          error.name === "TokenExpiredError"
            ? "Access token expired. Please provide a valid refresh token."
            : "Invalid token.",
        code:
          error.name === "TokenExpiredError"
            ? "TOKEN_EXPIRED"
            : "INVALID_TOKEN",
      });
    }

    // Enforce one-device policy: token session must still be active.
    if (!decoded.sessionId) {
      return res.status(401).json({
        success: false,
        error: "Session is required. Please log in again.",
        code: "SESSION_MISSING",
      });
    }

    if (!decoded.sessionId || typeof decoded.sessionId !== "string" || decoded.sessionId.length < 12) {
      return res.status(401).json({
        success: false,
        error: "Invalid session. Please log in again.",
        code: "SESSION_INVALID",
      });
    }

    const session = await Session.findOne({
      _id: decoded.sessionId,
      userId: decoded.userId || decoded._id,
      isActive: true,
    });

    if (!session) {
      return res.status(401).json({
        success: false,
        error: "Session expired or logged out from another device.",
        code: "SESSION_EXPIRED",
      });
    }

    // Successful authenticated requests also count as browser activity.
    await Session.updateOne(
      { _id: session._id, isActive: true },
      { $set: { lastActivityAt: new Date() } },
    );

    // ── 4. Load user ──
    const user = await User.findById(decoded.userId || decoded._id);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "User not found",
        code: "USER_NOT_FOUND",
      });
    }
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: "Account is deactivated",
        code: "ACCOUNT_DEACTIVATED",
      });
    }

    // ── 5. Attach user to request ──
    if (!user.isOnline || user.lastSeen) {
      await User.updateOne(
        { _id: user._id },
        { $set: { isOnline: true, lastSeen: null } },
      );
      user.isOnline = true;
      user.lastSeen = null;
    }

    req.user = user;
    req.userId = user._id;
    req.userRole = user.role;
    req.sessionId = session._id;

    return next();
  } catch (error) {
    console.error("authMiddleware error:", error);
    return res.status(500).json({
      success: false,
      error: "Authentication error",
    });
  }
};

// Optional auth middleware: identifies user if token exists, but doesn't block guests
export const optionalAuth = async (req, res, next) => {
  try {
    let token = req.headers.authorization;
    if (token && token.startsWith("Bearer ")) {
      token = token.split(" ")[1];
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      return next();
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.ACCESS_SECRET);
    } catch (error) {
      // If token is invalid/expired, we just treat them as a guest instead of erroring
      return next();
    }

    const user = await User.findById(decoded.userId || decoded._id);
    if (user && user.isActive) {
      req.user = user;
      req.userId = user._id;
      req.userRole = user.role;
    }

    next();
  } catch (error) {
    // Fail silently for optional auth
    next();
  }
};

// Optional: Role-based middleware
export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: "Insufficient permissions",
      });
    }

    next();
  };
};

// Optional: Admin only middleware
export const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      error: "Admin access required",
    });
  }
  next();
};

// Optional: Counsellor only middleware
export const counsellorOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "counsellor") {
    return res.status(403).json({
      success: false,
      error: "Counsellor access required",
    });
  }
  next();
};

// Admin-app token auth — accepts tokens signed with ADMIN_JWT_SECRET
// (used by the separate admin frontend which has its own auth system)
export const adminTokenAuth = (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, error: "No token provided" });
  }

  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ success: false, error: "Admin secret not configured" });
  }

  try {
    const decoded = jwt.verify(token, secret);
    // decoded contains { email } from the admin app's login
    req.user = { role: "admin", email: decoded.email };
    next();
  } catch {
    return res.status(401).json({ success: false, error: "Invalid or expired admin token" });
  }
};

