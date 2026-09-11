// // // // src/app.js
// // // import express from "express";
// // // import cors from "cors";

// // // import { authRoutes } from "./routes/authRoutes.js";
// // // import messageRoutes from "./routes/messageRoutes.js"
// // // import cookieParser from "cookie-parser";
// // // import path from "path";
// // // import { fileURLToPath } from "url";
// // // import http from "http";
// // // import { Server } from "socket.io";
// // // import SocketHandler from "./socket/socketHandler.js"
// // // import callRoutes from "./routes/callRoutes.js"

// // // const __filename = fileURLToPath(import.meta.url);
// // // const __dirname = path.dirname(__filename);

// // // const app = express();
// // // app.use(cookieParser());
// // // app.use(cors());
// // // app.use(express.json());
// // // app.use(express.urlencoded({ extended: true }));

// // // const server = http.createServer(app);
// // // const io = new Server(server, {
// // //   cors: {
// // //     origin: process.env.CLIENT_URL || "http://localhost:3000",
// // //     credentials: true
// // //   }
// // // });

// // // // Initialize socket handler
// // // const socketHandler = new SocketHandler(io);
// // // socketHandler.initialize();

// // // // Serve static files (uploaded images)
// // // app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
// // // app.get('/reset-password/:token', (req, res) => {
// // //     // Send the HTML file
// // //     res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
// // // });

// // // app.use("/api/auth", authRoutes);
// // // app.use("/api/chat",messageRoutes)
// // // app.use("/api/call",callRoutes)

// // // // export default app;
// // // export default server;

// // // src/app.js
// // import express from "express";
// // import cors from "cors";
// // import cookieParser from "cookie-parser";
// // import path from "path";
// // import { fileURLToPath } from "url";
// // import http from "http";
// // import { Server } from "socket.io";

// // import { authRoutes } from "./routes/authRoutes.js";
// // import videoRoutes from "./routes/videoRoutes.js"
// // import messageRoutes from "./routes/messageRoutes.js";
// // import callRoutes from "./routes/callRoutes.js";
// // import SocketHandler from "./socket/socketHandler.js";

// // const __filename = fileURLToPath(import.meta.url);
// // const __dirname = path.dirname(__filename);

// // const app = express();

// // // ---------------------------
// // // 1. CORS configuration (ONCE)
// // // ---------------------------
// // const allowedOrigins = [
// //   'http://localhost:3000',                 // React dev server
// //   'http://localhost:5173',
// //   'http://192.168.0.138:5173',                       // Vite (if used)
// //   'https://your-frontend-domain.com',      // production domain
// //   'https://td6lmn5q-5000.inc1.devtunnels.ms',
// //   'https://www.humaeli.com'
// //    // your tunnel
// // ];

// // // app.use(cors({
// // //   origin: function (origin, callback) {
// // //     // Allow requests with no origin (like mobile apps, curl, Postman)
// // //     if (!origin) return callback(null, true);
// // //     if (allowedOrigins.indexOf(origin) !== -1) {
// // //       callback(null, true);
// // //     } else {
// // //       console.warn(`CORS blocked origin: ${origin}`);
// // //       callback(new Error('Not allowed by CORS'), false);
// // //     }
// // //   },
// // //   credentials: true,      // ✅ allow cookies to be sent/received
// // //   methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
// // //   allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
// // // }));

// // // ---------------------------
// // // 2. Other middleware
// // // ---------------------------
// // app.use(cors({
// //   origin: function (origin, callback) {
// //     // ✅ Allow requests with no origin (file:// protocol, mobile apps, Postman, etc.)
// //     if (!origin) return callback(null, true);

// //     // Also check against allowed origins
// //     if (allowedOrigins.indexOf(origin) !== -1) {
// //       callback(null, true);
// //     } else {
// //       console.warn(`CORS blocked origin: ${origin}`);
// //       callback(new Error('Not allowed by CORS'), false);
// //     }
// //   },
// //   credentials: true,
// //   methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
// //   allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
// // }));
// // app.use(helmet());
// // app.use(compression());
// // app.use(cookieParser());
// // app.use(express.json());
// // app.use(express.urlencoded({ extended: true }));

// // // ---------------------------
// // // 3. Static files
// // // ---------------------------
// // app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// // // Serve password reset HTML page
// // app.get('/reset-password/:token', (req, res) => {
// //   res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
// // });

// // // ---------------------------
// // // 4. Routes
// // // ---------------------------
// // app.use("/api/auth", authRoutes);
// // app.use("/api/chat", messageRoutes);
// // app.use("/api/call", callRoutes);
// // app.use("/api/video",videoRoutes);
// // // ---------------------------
// // // 5. HTTP & Socket.IO server
// // // ---------------------------
// // const server = http.createServer(app);
// // const io = new Server(server, {
// //   cors: {
// //     origin: process.env.CLIENT_URL || "http://localhost:3000",
// //     credentials: true
// //   }
// // });

// // // Initialize socket handler
// // const socketHandler = new SocketHandler(io);
// // socketHandler.initialize();

// // export default server;

// // src/app.js
// import express from "express";
// import cors from "cors";
// import helmet from "helmet";  // Add this
// import compression from "compression";  // Add this
// import cookieParser from "cookie-parser";
// import path from "path";
// import { fileURLToPath } from "url";
// import http from "http";
// import { Server } from "socket.io";
// import { authRoutes } from "./routes/authRoutes.js";
// import videoRoutes from "./routes/videoRoutes.js";
// import messageRoutes from "./routes/messageRoutes.js";
// import callRoutes from "./routes/callRoutes.js";
// import SocketHandler from "./socket/socketHandler.js";

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// const app = express();
// app.use(express.json());
// // ---------------------------
// // 1. CORS configuration
// // ---------------------------
// const allowedOrigins = [
//   'https://your-frontend-origin.com',
//   'http://localhost:3000',
//   'http://localhost:5173',
//   'http://192.168.0.138:5173',
//   'https://your-frontend-domain.com',
//   'https://td6lmn5q-5000.inc1.devtunnels.ms',
//   'https://www.humaeli.com'
// ];

// app.use(cors({
//   origin: function (origin, callback) {
//     if (!origin) return callback(null, true);
//     if (allowedOrigins.indexOf(origin) !== -1) {
//       callback(null, true);
//     } else {
//       console.warn(`CORS blocked origin: ${origin}`);
//       callback(new Error('Not allowed by CORS'), false);
//     }
//   },
//   credentials: true,
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
// }));

// app.use(express.urlencoded({ extended: true }));
// app.use(helmet());
// app.use(compression());
// app.use(cookieParser());

// // ---------------------------
// // 3. Static files
// // ---------------------------
// app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// // Serve password reset HTML page
// app.get('/reset-password/:token', (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
// });

// // ---------------------------
// // 4. Routes
// // ---------------------------
// app.use("/api/auth", authRoutes);
// app.use("/api/chat", messageRoutes);
// app.use("/api/call", callRoutes);
// app.use("/api/video", videoRoutes);

// // ---------------------------
// // 5. HTTP & Socket.IO server
// // ---------------------------
// const server = http.createServer(app);
// const io = new Server(server, {
//   cors: {
//     origin: process.env.CLIENT_URL || "http://localhost:3000",
//     credentials: true
//   }
// });

// // Initialize socket handler
// const socketHandler = new SocketHandler(io);
// socketHandler.initialize();

// export default server;

// src/app.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import { Server } from "socket.io";
import authRoutes from "./routes/authRoutes.js";
import videoRoutes from "./routes/videoRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import prescriptionRoutes from "./routes/prescriptionRoutes.js";
import callRoutes from "./routes/callRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import appointmentRoutes from "./routes/appointmentRoutes.js";
import { deleteExpiredUnresolvedAppointments } from "./controllers/appointmentController.js";
import { getMyChatHistory } from "./controllers/chatController.js";
import { getPaymentConfig } from "./controllers/messageController.js";
import { settleInactiveChatSessions } from "./services/paidSessionService.js";
import walletRoutes from "./routes/walletRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import progressRoutes from "./routes/progressRoutes.js";
import locationRoutes from "./routes/locationRoutes.js";
import ratingRoutes from "./routes/ratingRoutes.js";
import ratingsApiRoutes from "./routes/ratingsApiRoutes.js";
import SocketHandler from "./socket/socketHandler.js";
import { authenticateSocket } from "./middleware/auth.js";
import { authMiddleware } from "./middleware/authMiddleware.js";
import { resetAllUsersPresence } from "./utils/presenceManager.js";
// import adminRoutes from "./routes/adminRoutes.js";
// import { initChatCleanupJob } from "./jobs/chatCleanupJob.js";
import forgotPasswordRoutes from "./routes/forgotPasswordRoutes.js";
import translateRoutes from "./routes/translateRoutes.js";
import avatarRoutes from "./routes/avatarRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import aiRealtimeRoute from "./routes/aiRealtimeRoute.js"
import { expirePendingPaidChatRequests } from "./services/paidSessionService.js";
import { getEmailDeliveryDiagnostics } from "./services/otpService.js";
import { startGreetingNotificationJob } from "./services/greetingNotificationService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('etag');
app.use('/api', apiFreshness);

// Use a tolerant JSON parser: accept text for application/json, keep raw body,
// attempt strict JSON.parse, and retry after trimming a single trailing quote.
// Selfie data URLs are considerably larger than normal JSON payloads. Keep a
// bounded limit that accepts a compressed camera image while preventing an
// unbounded request body.
app.use(express.text({ type: 'application/json', limit: process.env.JSON_BODY_LIMIT || '8mb' }));
app.use((req, res, next) => {
  if (!req.is || !req.is('application/json')) return next();

  req.rawBody = typeof req.body === 'string' ? req.body : undefined;

  if (!req.rawBody) return next();

  // First try strict parse
  try {
    req.body = JSON.parse(req.rawBody);
    return next();
  } catch (err) {
    // Try trimming trailing whitespace and a possible stray quote
    let candidate = req.rawBody.trimEnd();
    if (candidate.endsWith("'") || candidate.endsWith('"')) {
      candidate = candidate.slice(0, -1);
    }

    try {
      req.body = JSON.parse(candidate);
      // update rawBody to the fixed version for logging
      req.rawBody = candidate;
      return next();
    } catch (err2) {
      // expose original parse error to the error handler
      const parseErr = new SyntaxError(err.message || 'Invalid JSON');
      parseErr.type = 'entity.parse.failed';
      return next(parseErr);
    }
  }
});

const DB_STATE_LABEL = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

const splitEnvOrigins = (...values) =>
  values
    .flatMap((value) => String(value || "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);

// ---------------------------
// 1. CORS configuration
// ---------------------------
const configuredOrigins = splitEnvOrigins(
  process.env.CLIENT_URL,
  process.env.TUNNEL_URL,
  process.env.FRONTEND_URL,
  process.env.CORS_ORIGINS,
);

const allowedOrigins = [
  "http://localhost:4173",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://192.168.0.138:5173",
  "https://your-frontend-domain.com",
  "https://www.humaeli.com",
  "https://humaeli.com",
  ...configuredOrigins,
];

const normalizeOrigin = (origin) => origin?.replace(/\/$/, "");
const isDevTunnelOrigin = (origin) =>
  /^https:\/\/[a-z0-9-]+-\d+\.inc\d+\.devtunnels\.ms$/i.test(origin);
const isLocalOrigin = (origin) =>
  /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|[a-z0-9-]+\.local):\d+$/i.test(
    origin,
  );

const isAllowedOrigin = (origin) => {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return true;

  const exactMatch = allowedOrigins.some(
    (allowedOrigin) => normalizeOrigin(allowedOrigin) === normalized,
  );

  return (
    exactMatch || isDevTunnelOrigin(normalized) || isLocalOrigin(normalized)
  );
};

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);

    console.warn(`CORS blocked origin: ${origin}`);
    callback(new Error("Not allowed by CORS"), false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
  ],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(express.urlencoded({ extended: true }));
app.use(helmet());
app.use(compression());
app.use(cookieParser());

// ---------------------------
// 3. Static files
// ---------------------------

app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Serve password reset HTML page
app.get("/reset-password/:token", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "reset-password.html"));
});

// Public account-deletion instructions. This URL can be shared in app-store
// listings and remains available even when a user cannot sign in.
app.get(["/delete-account", "/account-deletion"], (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "delete-account.html"));
});

app.get("/account-deletion.css", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "account-deletion.css"));
});

// ---------------------------
// 4. Routes
// ---------------------------
app.get("/api/health", (_req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus = DB_STATE_LABEL[dbState] || "unknown";
  const isHealthy = dbState === 1;

  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    status: isHealthy ? "ok" : "degraded",
    service: "humaeli-backend",
    environment: process.env.NODE_ENV || "development",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    features: {
      landingStats: true,
    },
    mail: getEmailDeliveryDiagnostics(),
    db: {
      state: dbStatus,
      readyState: dbState,
    },
  });
});

app.use("/api/auth", authRoutes);
app.get("/api/chat/payment-config", getPaymentConfig);
app.use("/api/chat", messageRoutes);
app.use("/api/prescriptions", prescriptionRoutes);
app.get("/api/ai-chat/history", authMiddleware, getMyChatHistory);
app.use("/api/ai-chat", chatRoutes); // <--- We mounted our AI chat here!
app.use("/api/progress", progressRoutes); // <--- Mood tracking & progress endpoints
app.use("/api/call", callRoutes);
app.use("/api/video", videoRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/location", locationRoutes);
app.use("/api/counselors", ratingRoutes);
app.use("/api/ratings", ratingsApiRoutes);
app.use("/api/avatar", avatarRoutes); // <--- Avatar generation with OpenAI
// app.use("/api/admin", adminRoutes); // <--- Admin endpoints (cleanup, stats, etc.)
app.use('/api/auth', forgotPasswordRoutes);
app.use('/api/translate', translateRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/ai/realtime", aiRealtimeRoute);
// Remove unresolved appointments only after their scheduled date/time has
// passed. The request-time cleanup in getAppointments is a second safeguard.
const appointmentCleanupInterval = setInterval(() => {
  deleteExpiredUnresolvedAppointments().catch((error) => {
    console.error("Appointment cleanup failed:", error.message);
  });
}, 60 * 1000);
appointmentCleanupInterval.unref?.();
const chatBillingSettlementInterval = setInterval(() => {
  settleInactiveChatSessions().catch((error) => {
    console.error("Inactive chat billing settlement failed:", error.message);
  });
}, 30 * 1000);
chatBillingSettlementInterval.unref?.();
settleInactiveChatSessions().catch((error) => {
  console.error("Initial inactive chat billing settlement failed:", error.message);
});
deleteExpiredUnresolvedAppointments().catch((error) => {
  console.error("Initial appointment cleanup failed:", error.message);
});

const paidChatExpiryInterval = setInterval(() => {
  expirePendingPaidChatRequests().catch((error) => {
    console.error("Paid chat expiry cleanup failed:", error.message);
  });
}, 5 * 60 * 1000);
paidChatExpiryInterval.unref?.();
expirePendingPaidChatRequests().catch((error) => {
  console.error("Initial paid chat expiry cleanup failed:", error.message);
});

if (process.env.NODE_ENV !== "test") {
  startGreetingNotificationJob();
}

// ---------------------------
// 5. HTTP & Socket.IO server
// ---------------------------
const server = http.createServer(app);

const parseSocketTransports = (value) => {
  const transports = String(value || "")
    .split(",")
    .map((transport) => transport.trim().toLowerCase())
    .filter((transport) => transport === "websocket" || transport === "polling");

  return transports.length ? transports : ["websocket", "polling"];
};

const socketTransports = parseSocketTransports(process.env.SOCKET_TRANSPORTS);

// Create Socket.IO server. WebSocket is preferred for real-time delivery, with
// polling kept as a fallback for networks/tunnels that cannot upgrade.
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"), false);
    },
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  },
  transports: socketTransports,
  allowUpgrades: socketTransports.includes("websocket"),
  pingTimeout: 60000,
  pingInterval: 25000,
  path: "/socket.io/",
  allowEIO3: true,
  maxHttpBufferSize: 1e7,
});

io.use(authenticateSocket);

// Make io accessible globally for your controllers
global.io = io;

// Initialize your existing socket handler (for chat, etc.)
const socketHandler = new SocketHandler(io);
socketHandler.initialize();
global.socketHandler = socketHandler;

// Reset all users to offline on startup
resetAllUsersPresence().catch(err => {
  console.error("Failed to reset presence on startup:", err);
});

export { app };
export default server;

// Central error handler to catch JSON parse errors and log raw body
app.use((err, req, res, next) => {
  if (err && (err instanceof SyntaxError || err.type === 'entity.parse.failed')) {
    console.error('JSON parse error:', err.message);
    console.error('Raw request body:', req.rawBody);
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON in request body',
      error: err.message,
    });
  }

  // pass through
  next(err);
});
