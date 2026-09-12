// index.js or server.js
// import server from "./src/app.js";
// // import dotenv from "dotenv";


// // Add this to your app.js or server.js temporarily
// console.log('JWT_SECRET loaded:', process.env.JWT_SECRET ? 'YES (length: ' + process.env.JWT_SECRET.length + ')' : 'NO');
// console.log('JWT_SECRET value:', process.env.JWT_SECRET);
// dotenv.config();

// const PORT = process.env.PORT || 5000;

// mongoose.connect(process.env.MONGO_URI)
//   .then(() => {
//     console.log("MySQL Connected");
    
//     server.listen(PORT, () => {
//       console.log(`Server running on port ${PORT}`);
//     });
//   })
//   .catch(err => {
//     console.error("MySQL connection error:", err);
//     process.exit(1);
//   });

// index.js or server.js
import dotenv from "dotenv";
import dns from "node:dns";
import connectDB from "./src/config/db.js";
import { databaseFailureDetails } from "./src/config/databaseStartup.js";
dns.setServers(["8.8.8.8", "1.1.1.1"]);

// IMPORTANT: Load environment variables FIRST
// Prefer an explicit .env path in src/ when running via nodemon from project root.
dotenv.config();
if (process.env.DOTENV_PATH) {
  dotenv.config({ path: process.env.DOTENV_PATH, override: true });
}

const { default: server, startDatabaseJobs } = await import("./src/app.js");
const { startNotificationRuleScheduler } = await import("./src/admin/jobs/notificationRuleScheduler.js");

const PORT = parseInt(process.env.PORT, 10) || 5001;
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
      return await connectDB();
    } catch (error) {
      attempt += 1;
      const retryDelay = Math.min(30000, attempt * 3000);
      console.error(
        `MySQL unavailable (${databaseFailureDetails(error)}). ` +
          `Retrying in ${Math.ceil(retryDelay / 1000)}s; process will stay alive.`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
}

// Connect to MySQL using cached connection
connectWithRetry()
  .then(async () => {
    await startDatabaseJobs();
    if (process.env.NODE_ENV !== "test") startNotificationRuleScheduler();
    server.listen(PORT, () => {
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

    server.on('error', handleServerError);
  })
  .catch(err => {
    console.error("❌ MySQL connection error:", err);
    process.exit(1);
  });
