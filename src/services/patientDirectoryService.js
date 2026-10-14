import User from '../models/userModel.js';

const idOf = value => String(value?._id || value?.id || value || '');
export async function filterPatientDirectory(rows, source) {
  if (source === 'online') {
    const candidates = rows.filter(row => row.patient && row.patient.isActive !== false && row.patient.isActive !== 0);
    const unresolvedIds = [...new Set(candidates.filter(row => typeof row.patient === 'string').map(row => row.patient))];
    if (!unresolvedIds.length) return candidates;
    const users = await User.find({ _id: { $in: unresolvedIds }, isActive: { $ne: false } }).select('_id').lean();
    const activeIds = new Set(users.map(idOf));
    return candidates.filter(row => typeof row.patient !== 'string' || activeIds.has(row.patient));
  }
  const linkedIds = [...new Set(rows.map(row => idOf(row.patient_id)).filter(Boolean))];
  if (!linkedIds.length) return rows;
  const users = await User.find({ _id: { $in: linkedIds }, isActive: { $ne: false } }).select('_id').lean();
  const activeIds = new Set(users.map(idOf));
  return rows.filter(row => !idOf(row.patient_id) || activeIds.has(idOf(row.patient_id)));
}
