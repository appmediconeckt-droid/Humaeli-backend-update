import dotenv from "dotenv";
import connectDB from "./src/config/db.js";
import { databaseFailureDetails } from "./src/config/databaseStartup.js";

// IMPORTANT: Load environment variables FIRST
// Prefer an explicit .env path when one is provided by the runtime.
dotenv.config();
if (process.env.DOTENV_PATH) {
  dotenv.config({ path: process.env.DOTENV_PATH, override: true });
}

const { default: server, app, startDatabaseJobs } = await import("./src/app.js");
const { startNotificationRuleScheduler } = await import("./src/admin/jobs/notificationRuleScheduler.js");

const PORT = Number(process.env.PORT || 5001);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}
app.locals.databaseReady = false;
const TUNNEL_URL = String(process.env.TUNNEL_URL || "").trim();
const CLIENT_URL = String(process.env.CLIENT_URL || "").trim();

function extractTunnelPort(url) {
  const match = url.match(/-(\d+)\.inc\d+\.devtunnels\.ms$/i);
  return match ? Number(match[1]) : null;
}

function handleServerError(error) {
  if (error.syscall !== 'listen') {
    throw error;
  }

  const bind = typeof PORT === 'string' ? `Pipe ${PORT}` : `Port ${PORT}`;

  switch (error.code) {
    case 'EACCES':
      console.error(`❌ ${bind} requires elevated privileges.`);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(`❌ ${bind} is already in use. Please stop the process using it or set a different PORT.`);
      process.exit(1);
      break;
    default:
      throw error;
  }
}

async function connectWithRetry() {
  let attempt = 0;
  while (true) {
    try {
      const connection = await connectDB();
      app.locals.databaseLastError = null;
      return connection;
    } catch (error) {
      attempt += 1;
      const retryDelay = Math.min(30000, attempt * 3000);
      app.locals.databaseLastError = databaseFailureDetails(error);
      console.error(error.stack || error);
      console.error(
        `MySQL unavailable (${app.locals.databaseLastError}). ` +
          `Retrying in ${Math.ceil(retryDelay / 1000)}s; process will stay alive.`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
}

// Bind HTTP immediately so diagnostics remain available during database retries.
server.on('error', handleServerError);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📡 API URL: http://localhost:${PORT}`);
  if (CLIENT_URL) {
    console.log(`🖥️ Frontend origin: ${CLIENT_URL}`);
  }
  if (TUNNEL_URL) {
    console.log(`🌐 Tunnel URL: ${TUNNEL_URL}`);
    const tunnelPort = extractTunnelPort(TUNNEL_URL);
    if (tunnelPort && tunnelPort !== PORT) {
      console.warn(
        `⚠️ Tunnel URL port (${tunnelPort}) does not match backend PORT (${PORT}). Update the devtunnel or PORT before using the tunnel.`,
      );
    }
  }
});

connectWithRetry()
  .then(async () => {
    app.locals.databaseReady = true;
    console.log("Database initialization complete; API is ready.");
    startDatabaseJobs().catch((error) => {
      console.error("Database background jobs failed to start:", databaseFailureDetails(error));
    });
    if (process.env.NODE_ENV !== "test") {
      try {
        startNotificationRuleScheduler();
      } catch (error) {
        console.error("Notification rule scheduler failed to start:", error.message);
      }
    }
  })
  .catch(err => {
    console.error(err.stack || err);
    console.error("Database startup failed:", databaseFailureDetails(err));
    process.exit(1);
  });
