import { createHash } from 'node:crypto';
import { getPool } from '../config/mysql.js';
import Appointment from '../models/appointmentModel.js';

export const doctorRatingRepository = { connection: () => getPool().getConnection() };

// Serialize submissions for one target, even across different appointments.
export async function withRatingLock(type, targetId, save) {
  const connection = await doctorRatingRepository.connection();
  const key = 'rating:' + createHash('sha256').update(`${type}:${targetId}`).digest('hex').slice(0, 48);
  let locked = false;
  try {
    const [rows] = await connection.query('SELECT GET_LOCK(?, 5) AS acquired', [key]);
    locked = Number(rows[0]?.acquired) === 1;
    if (!locked) throw Object.assign(new Error('Rating is busy. Please try again.'), { status: 503 });
    return await save();
  } finally {
    try { if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [key]); }
    finally { connection.release(); }
  }
}

export function summarizeAppointmentRatings(rows, type = 'doctor', { includeReviewer = false } = {}) {
  const field = `${type}Rating`, target = type === 'doctor' ? 'counselor' : 'clinic_id';
  const seen = new Set(), summaries = new Map();
  // Keep the first submitted rating for legacy users who rated multiple visits.
  for (const row of [...rows].sort((a, b) => new Date(a[field]?.submittedAt || 0) - new Date(b[field]?.submittedAt || 0))) {
    const value = row[field];
    if (!Number.isInteger(value?.stars) || value.stars < 1 || value.stars > 5) continue;
    const id = String(row[target]?._id || row[target]);
    const key = `${id}:${row.patient?._id || row.patient || row._id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const summary = summaries.get(id) || { sum: 0, rating: 0, ratingCount: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, reviews: [] };
    summary.sum += value.stars;
    summary.ratingCount++;
    summary.distribution[value.stars]++;
    summary.rating = Math.round(summary.sum / summary.ratingCount * 10) / 10;
    summary.reviews.push({ stars: value.stars, review: value.review || '', submittedAt: value.submittedAt,
      ...(includeReviewer ? { id: String(row._id), reviewerName: row.patient?.fullName || row.patient?.anonymous || 'Patient' } : {}) });
    summaries.set(id, summary);
  }
  return summaries;
}

export async function doctorRatingSummaries(ids) {
  if (!ids.length) return new Map();
  const rows = await Appointment.find({ counselor: { $in: ids }, doctorRating: { $exists: true } })
    .select('counselor patient doctorRating').lean();
  return summarizeAppointmentRatings(rows);
}

export async function attachDoctorRatings(profiles) {
  const doctors = profiles.filter(p => p.role === 'doctor' || p.accountType === 'doctor');
  if (!doctors.length) return profiles;
  const summaries = await doctorRatingSummaries(doctors.map(p => p._id || p.id));
  return profiles.map(p => {
    if (p.role !== 'doctor' && p.accountType !== 'doctor') return p;
    const summary = summaries.get(String(p._id || p.id));
    return { ...p, rating: summary?.rating || 0, ratingCount: summary?.ratingCount || 0 };
  });
}

export async function attachAppointmentDoctorRatings(appointments) {
  const providers = new Map();
  for (const row of appointments) {
    const provider = row.counselor;
    if (provider && typeof provider === 'object' && (provider._id || provider.id)) {
      providers.set(String(provider._id || provider.id), provider);
    }
  }
  const rated = await attachDoctorRatings([...providers.values()]);
  const byId = new Map(rated.map(provider => [String(provider._id || provider.id), provider]));
  return appointments.map(row => ({ ...row, counselor: byId.get(String(row.counselor?._id || row.counselor?.id)) || row.counselor }));
}
