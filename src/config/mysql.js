import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

let pool = null;
let keepAliveTimer = null;

const MYSQL_HOST = process.env.MYSQL_HOST || "yamanote.proxy.rlwy.net";
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 12592);
const MYSQL_USER = process.env.MYSQL_USER || "root";
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || "";
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || "railway";
const MYSQL_CONNECTION_LIMIT = Number(process.env.MYSQL_CONNECTION_LIMIT || 10);
const MYSQL_SSL = String(process.env.MYSQL_SSL || "").toLowerCase() === "true";

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: MYSQL_HOST,
      port: MYSQL_PORT,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      database: MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: MYSQL_CONNECTION_LIMIT,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      ssl: MYSQL_SSL ? { rejectUnauthorized: false } : undefined,
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
      console.log(`✅ Railway MySQL Connected Successfully (${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE})`);
      return currentPool;
    }
  } catch (error) {
    console.error("❌ Railway MySQL connection error:", error.message);
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
    return { status: "healthy", latencyMs: latency, host: MYSQL_HOST, database: MYSQL_DATABASE };
  } catch (error) {
    return { status: "unhealthy", error: error.message, host: MYSQL_HOST, database: MYSQL_DATABASE };
  }
}

export default {
  getPool,
  connectMySQL,
  query,
  execute,
  checkHealth,
};
