import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { mysqlConfig } from '../persistence/mysqlDriver.js';
dotenv.config();
if (process.env.DOTENV_PATH) {
  dotenv.config({ path: process.env.DOTENV_PATH, override: true });
}

let pool = null;
let keepAliveTimer = null;

let settings;

export function getPool() {
  if (!pool) {
    settings = mysqlConfig();
    pool = mysql.createPool({
      ...settings,
      waitForConnections: true,
      connectionLimit: settings.connectionLimit,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    });

    // Start keep-alive interval to prevent Railway TCP proxy idle disconnects
    startKeepAlive();
  }
  return pool;
}

function startKeepAlive() {
  if (keepAliveTimer) return;

  keepAliveTimer = setInterval(async () => {
    try {
      if (pool) {
        await pool.query("SELECT 1");
      }
    } catch (err) {
      console.warn("⚠️ Railway MySQL keep-alive ping failed:", err.message);
    }
  }, 25000); // 25 seconds (Railway idle timeout is typically 60-120s)

  // Don't prevent process from exiting
  if (keepAliveTimer && typeof keepAliveTimer.unref === "function") {
    keepAliveTimer.unref();
  }
}

export async function connectMySQL() {
  try {
    const currentPool = getPool();
    const [rows] = await currentPool.query("SELECT 1 AS connected");
    if (rows && rows[0]?.connected === 1) {
      console.log(`✅ Railway MySQL Connected Successfully (${settings.host}:${settings.port}/${settings.database})`);
      return currentPool;
    }
  } catch (error) {
    console.error(error.stack || error);
    throw error;
  }
}

export async function query(sql, params) {
  const currentPool = getPool();
  return currentPool.query(sql, params);
}

export async function execute(sql, params) {
  const currentPool = getPool();
  return currentPool.execute(sql, params);
}

export async function checkHealth() {
  try {
    const currentPool = getPool();
    const startTime = Date.now();
    await currentPool.query("SELECT 1");
    const latency = Date.now() - startTime;
    return { status: "healthy", latencyMs: latency, host: settings.host, database: settings.database };
  } catch (error) {
    return { status: "unhealthy", error: error.message, host: settings?.host, database: settings?.database };
  }
}

export default {
  getPool,
  connectMySQL,
  query,
  execute,
  checkHealth,
};
