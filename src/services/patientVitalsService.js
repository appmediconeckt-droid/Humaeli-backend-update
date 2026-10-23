// Select one complete measurement snapshot; never combine readings from different visits.
export function latestPatientVitals(online, walkins) {
  const fields = ['blood_pressure', 'pulse', 'temperature', 'spo2', 'respiratory_rate', 'weight', 'height', 'pain_score'];
  const snapshots = [];
  for (const [source, rows] of [['online', online], ['walkin', walkins]]) {
    for (const row of rows) {
      let value = row.vitals;
      if (typeof value === 'string') { try { value = JSON.parse(value); } catch { continue; } }
      if (!value || typeof value !== 'object') continue;
      const canonical = { ...value, blood_pressure: value.blood_pressure ?? value.bp ?? value.bloodPressure, pulse: value.pulse ?? value.heartRate ?? value.heart_rate };
      const vitals = Object.fromEntries(fields.filter(key => canonical[key] != null && canonical[key] !== '').map(key => [key, canonical[key]]));
      if (!Object.keys(vitals).length) continue;
      const recordedAt = [value.recorded_at, row.checked_in_at, row.appointment_date, row.date]
        .find(candidate => candidate != null && Number.isFinite(Date.parse(candidate)));
      const time = Date.parse(recordedAt);
      if (!Number.isFinite(time)) continue;
      vitals.recorded_at = recordedAt;
      vitals.temperature_unit = value.temperature_unit || 'C';
      snapshots.push({ vitals, source, appointmentId: String(row._id || row.id), appointmentDate: row.appointment_date, time });
    }
  }
  snapshots.sort((a, b) => b.time - a.time || b.appointmentId.localeCompare(a.appointmentId));
  if (!snapshots.length) return null;
  const { time, ...latest } = snapshots[0];
  return latest;
}
