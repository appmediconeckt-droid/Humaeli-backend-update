import { query } from "../config/mysql.js";

// Store UTC timestamps explicitly so database/server timezone does not affect counts.
export function createDoctorQrStatsService(runQuery = query) {
  let ready;
  const ensureTable = () => {
    if (!ready) ready = runQuery(`CREATE TABLE IF NOT EXISTS doctor_qr_visits (
      doctor_id VARCHAR(64) NOT NULL,
      visit_id VARCHAR(64) NOT NULL,
      scanned BOOLEAN NOT NULL DEFAULT FALSE,
      created_at DATETIME NOT NULL,
      PRIMARY KEY (doctor_id, visit_id),
      INDEX doctor_qr_visit_date (doctor_id, created_at)
    )`).catch((error) => { ready = undefined; throw error; });
    return ready;
  };
  return {
    async recordVisit(doctorId, visitId, scanned) {
      await ensureTable();
      await runQuery(`INSERT IGNORE INTO doctor_qr_visits
        (doctor_id, visit_id, scanned, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP())`,
      [doctorId, visitId, scanned ? 1 : 0]);
    },
    async getStats(doctorId, now = new Date()) {
      await ensureTable();
      // Calendar day and Monday-based week in India, matching appointment dates.
      const offset = 330 * 60 * 1000;
      const local = new Date(now.getTime() + offset);
      const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
      const today = midnight - offset;
      const week = today - ((local.getUTCDay() + 6) % 7) * 86400000;
      const sqlDate = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
      const [[visits], [appointments]] = await Promise.all([
        runQuery(`SELECT
          COALESCE(SUM(scanned = 1 AND created_at >= ? AND created_at < ?), 0) AS todayScans,
          COALESCE(SUM(scanned = 1 AND created_at >= ? AND created_at < ?), 0) AS thisWeekScans,
          COUNT(*) AS profileViews
          FROM doctor_qr_visits WHERE doctor_id = ?`,
        [sqlDate(today), sqlDate(today + 86400000), sqlDate(week), sqlDate(week + 7 * 86400000), doctorId]),
        runQuery("SELECT COUNT(*) AS count FROM walkin_appointments WHERE doctor_id = ? AND booking_source = 'qr'", [doctorId]),
      ]);
      return {
        todayScans: Number(visits[0]?.todayScans || 0),
        thisWeekScans: Number(visits[0]?.thisWeekScans || 0),
        qrAppointments: Number(appointments[0]?.count || 0),
        profileViews: Number(visits[0]?.profileViews || 0),
      };
    },
  };
}

export const doctorQrStats = createDoctorQrStatsService();
