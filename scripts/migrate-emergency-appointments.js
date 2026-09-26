import { ensureEmergencyAppointmentSchema } from "../src/services/emergencyAppointmentService.js";
import { getPool } from "../src/config/mysql.js";
try {
  await ensureEmergencyAppointmentSchema();
  console.log("Emergency appointment fields ready");
} catch (error) {
  console.error("Emergency appointment migration failed:", error.message);
  process.exitCode = 1;
} finally { await getPool().end(); }
