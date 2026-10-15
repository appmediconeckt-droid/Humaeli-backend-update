import { query } from '../config/mysql.js';
import { invalidateTableColumns } from '../models/mysql/BaseModel.js';
import { fail } from '../utils/clinicAccess.js';

// These are input sanity limits, not clinical normal ranges.
const limits = {
  pulse: [1, 400], temperature: [20, 50], spo2: [0, 100],
  respiratory_rate: [1, 150], weight: [0.1, 700], height: [10, 300], pain_score: [0, 10],
};
export function validateVitals(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'Vitals must be an object');
  const result = {};
  for (const [key, [min, max]] of Object.entries(limits)) {
    const value = input[key];
    if (value === '' || value == null) continue;
    if (!['number', 'string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max) {
      throw fail(400, `Invalid ${key.replaceAll('_', ' ')} (${min}-${max})`);
    }
    if (['pulse', 'respiratory_rate', 'pain_score'].includes(key) && !Number.isInteger(Number(value))) throw fail(400, `${key.replaceAll('_', ' ')} must be a whole number`);
    result[key] = Number(value);
  }
  if (input.blood_pressure != null && input.blood_pressure !== '') {
    const match = typeof input.blood_pressure === 'string' && input.blood_pressure.trim().match(/^(\d{1,3})\s*\/\s*(\d{1,3})$/);
    if (!match || +match[1] < 1 || +match[1] > 350 || +match[2] < 1 || +match[2] > 250 || +match[1] <= +match[2]) throw fail(400, 'Enter blood pressure as systolic/diastolic, for example 120/80');
    result.blood_pressure = `${+match[1]}/${+match[2]}`;
  }
  if (!Object.keys(result).length) throw fail(400, 'Enter at least one measured vital');
  if (input.notes != null) {
    if (typeof input.notes !== 'string' || input.notes.length > 1000) throw fail(400, 'Notes must be at most 1000 characters');
    result.notes = input.notes.trim();
  }
  result.temperature_unit = 'C';
  return result;
}

export const vitalsSchemaRepository = { query };
let schemaReady;
export function ensureWalkinVitalsSchema() {
  if (!schemaReady) schemaReady = (async () => {
    const [columns] = await vitalsSchemaRepository.query("SHOW COLUMNS FROM `walkin_appointments` LIKE 'vitals'");
    if (!columns.length) {
      try { await vitalsSchemaRepository.query('ALTER TABLE `walkin_appointments` ADD COLUMN vitals JSON NULL'); }
      catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
      invalidateTableColumns('walkin_appointments');
    }
  })().catch(error => { schemaReady = undefined; throw error; });
  return schemaReady;
}
