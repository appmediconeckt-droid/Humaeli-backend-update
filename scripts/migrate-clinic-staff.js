import { ensureClinicStaffSchema } from "../src/services/clinicStaffService.js";
import { getPool } from "../src/config/mysql.js";

try {
  await ensureClinicStaffSchema();
  console.log("Clinic staff schema ready. Existing unassigned staff can be assigned from Staff Management.");
} catch (error) {
  console.error("Clinic staff migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await getPool().end();
}
