import { query, getPool } from "../src/config/mysql.js";

try {
  for (const table of ["appointments", "walkin_appointments"]) {
    const [columns] = await query(`SHOW COLUMNS FROM \`${table}\` LIKE 'consultation_timing'`);
    if (!columns.length) await query(`ALTER TABLE \`${table}\` ADD COLUMN consultation_timing JSON NULL`);
    console.log(`${table}: consultation_timing ready`);
  }
  await getPool().end();
  process.exit(0);
} catch (error) {
  console.error("Consultation timing migration failed:", error.message);
  process.exit(1);
}
