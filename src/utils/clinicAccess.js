import User from '../models/userModel.js';

export const staffRoles = ['nurse', 'assistant', 'lab_technician', 'housekeeping', 'supervisor', 'department_manager', 'billing'];
export const actorId = req => String(req.userId || req.user?._id || req.user?.id || req.user?.userId || '');
export const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
export const pick = (object, fields) => Object.fromEntries(fields.filter(key => object?.[key] !== undefined).map(key => [key, object[key]]));
export const jsonRecord = row => {
  const data = row?.toObject ? row.toObject() : row;
  return data ? { ...data, id: String(data._id), created_at: data.createdAt, updated_at: data.updatedAt } : null;
};
export const handle = fn => async (req, res) => {
  try { return await fn(req, res); }
  catch (error) {
    const status = error.statusCode || error.status || (['ValidationError', 'CastError'].includes(error.name) ? 400 : error.code === 11000 ? 409 : 500);
    if (status === 500) console.error('Clinic API error:', error);
    return res.status(status).json({ success: false, message: status === 500 ? 'Unable to complete request' : error.message,
      ...(error.code === 'DUPLICATE_APPOINTMENT' ? { code: error.code } : {}),
      ...(error.code === 'INVALID_CLINIC_ID' ? { code: error.code, field: error.field } : {}) });
  }
};
export async function doctorScope(req, requested) {
  const user = await User.findById(actorId(req)).select('role assignedDoctor isActive');
  if (!user || !user.isActive) throw fail(401, 'Active account required');
  if (user.role === 'admin') {
    if (!requested) throw fail(400, 'doctor_id is required');
    const doctor = await User.exists({ _id: requested, role: 'doctor', isActive: true });
    if (!doctor) throw fail(404, 'Doctor not found');
    return String(requested);
  }
  const owner = user.role === 'doctor' ? actorId(req) : staffRoles.includes(user.role) ? String(user.assignedDoctor || '') : '';
  if (!owner || (requested && String(requested) !== owner)) throw fail(403, 'Access to this doctor is not allowed');
  return owner;
}
export const bool = value => value === true || value === 1 || ['true', '1'].includes(String(value).toLowerCase());
export const todayIST = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
export function dateOnly(value) {
  const text = String(value || '');
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw fail(400, 'A valid YYYY-MM-DD date is required');
  return text;
}
