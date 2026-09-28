import { Leave } from '../models/clinicModels.js';
import User from '../models/userModel.js';
import { handle, actorId, doctorScope, dateOnly, fail, jsonRecord, staffRoles } from '../utils/clinicAccess.js';
export const applyLeave = handle(async (req, res) => {
  const user = await User.findById(actorId(req)).select('role assignedDoctor');
  if (!user || ![...staffRoles, 'doctor'].includes(user.role)) throw fail(403, 'Staff or doctor account required');
  const start = dateOnly(req.body.start_date), end = dateOnly(req.body.end_date);
  if (end < start) throw fail(400, 'end_date must be on or after start_date');
  const leave = await Leave.create({ user_id: actorId(req), doctor_id: user.assignedDoctor || (user.role === 'doctor' ? user._id : undefined),
    leave_type: req.body.leave_type, reason: req.body.reason, start_date: start, end_date: end });
  res.status(201).json({ success: true, message: 'Leave applied successfully', data: jsonRecord(leave) });
});
export const getUserLeaves = handle(async (req, res) => {
  const rows = await Leave.find({ user_id: actorId(req) }).sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: rows.map(jsonRecord) });
});
export const cancelLeave = handle(async (req, res) => {
  const row = await Leave.findOneAndUpdate({ _id: req.params.id, user_id: actorId(req), status: 'pending' },
    { $set: { status: 'cancelled' } }, { returnDocument: 'after' });
  if (!row) throw fail(404, 'Pending leave not found');
  res.json({ success: true, data: jsonRecord(row) });
});
async function managementFilter(req) {
  if (req.user.role === 'admin') return {};
  if (req.user.role !== 'doctor') throw fail(403, 'Doctor or admin required');
  return { doctor_id: await doctorScope(req) };
}
const list = pending => handle(async (req, res) => {
  const filter = await managementFilter(req);
  if (pending) filter.status = 'pending';
  const rows = await Leave.find(filter).populate('user_id', 'fullName role department').sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: rows.map(jsonRecord) });
});
export const getAllLeaves = list(false);
export const getPendingLeaves = list(true);
export const getUserById = handle(async (req, res) => {
  const filter = await managementFilter(req);
  const user = await User.findOne({ _id: req.params.user_id, ...(filter.doctor_id ? { assignedDoctor: filter.doctor_id } : {}) })
    .select('fullName role department staffId shift');
  if (!user) throw fail(404, 'Staff member not found');
  res.json({ success: true, data: user });
});
export const updateLeaveStatus = handle(async (req, res) => {
  const filter = await managementFilter(req);
  if (!['approved', 'rejected'].includes(req.body.status)) throw fail(400, 'Status must be approved or rejected');
  const row = await Leave.findOneAndUpdate({ ...filter, _id: req.params.id, status: 'pending', user_id: { $ne: actorId(req) } },
    { $set: { status: req.body.status, reviewed_by: actorId(req) } }, { returnDocument: 'after', runValidators: true });
  if (!row) throw fail(404, 'Pending leave not found, or cannot review your own leave');
  res.json({ success: true, data: jsonRecord(row) });
});
