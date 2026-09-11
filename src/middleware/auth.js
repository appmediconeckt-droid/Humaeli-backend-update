import jwt from "jsonwebtoken";
import User from "../models/userModel.js";
import Session from "../models/sessionModel.js";
import mongoose from "mongoose";

export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Access token required" });
    }

    const secret = process.env.ACCESS_SECRET || process.env.JWT_SECRET;
    const decoded = jwt.verify(token, secret);

    const userId = decoded.userId || decoded.id;
    const sessionId = decoded.sessionId;
    const role = decoded.role;

    if (!userId || !sessionId || !role) {
      return res.status(401).json({ error: "Invalid token payload" });
    }

    // ✅ Validate session only (important for one-device policy)
    const activeSession = await Session.findOne({
      _id: sessionId,
      userId,
      isActive: true,
    });

    if (!activeSession) {
      return res.status(401).json({
        error: "Session expired or logged out from another device",
      });
    }

    // ✅ Attach clean user info (NO extra DB call)
    req.user = {
      _id: userId,
      userId,
      role,
      sessionId,
    };

    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid token" });
    }
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    }

    console.error("Auth error:", error);
    return res.status(500).json({ error: "Authentication error" });
  }
};

export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: "Access denied: Insufficient permissions",
      });
    }
    next();
  };
};

export const authenticateSocket = async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "");

    if (!token) {
      const err = new Error("AUTH_TOKEN_MISSING");
      err.data = { code: "AUTH_TOKEN_MISSING" };
      return next(err);
    }

    const secret = process.env.ACCESS_SECRET || process.env.JWT_SECRET;

    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (jwtErr) {
      const isExpired = jwtErr?.name === "TokenExpiredError";
      const err = new Error(isExpired ? "AUTH_TOKEN_EXPIRED" : "AUTH_TOKEN_INVALID");
      err.data = { code: isExpired ? "AUTH_TOKEN_EXPIRED" : "AUTH_TOKEN_INVALID" };
      return next(err);
    }

    const userId = decoded.userId || decoded.id;
    if (!userId) {
      const err = new Error("AUTH_TOKEN_INVALID");
      err.data = { code: "AUTH_TOKEN_INVALID" };
      return next(err);
    }

    const sessionId = decoded.sessionId;
    if (!sessionId) {
      const err = new Error("AUTH_TOKEN_INVALID");
      err.data = { code: "AUTH_TOKEN_INVALID" };
      return next(err);
    }

    const activeSession = await Session.findOne({
      _id: sessionId,
      userId,
      isActive: true,
    });

    if (!activeSession) {
      const err = new Error("AUTH_SESSION_INACTIVE");
      err.data = { code: "AUTH_SESSION_INACTIVE" };
      return next(err);
    }

    User.findById(userId)
      .then((user) => {
        if (!user || !user.isActive) {
          const err = new Error("AUTH_USER_INACTIVE");
          err.data = { code: "AUTH_USER_INACTIVE" };
          return next(err);
        }
        socket.userId = user._id.toString();
        socket.userRole = user.role;
        return next();
      })
      .catch((error) => {
        console.error("Socket auth user lookup error:", error);
        const err = new Error("AUTH_LOOKUP_FAILED");
        err.data = { code: "AUTH_LOOKUP_FAILED" };
        return next(err);
      });
  } catch (error) {
    console.error("Socket auth error:", error);
    const err = new Error("AUTH_FAILED");
    err.data = { code: "AUTH_FAILED" };
    next(err);
  }
};
