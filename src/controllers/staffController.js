import bcrypt from 'bcryptjs';
import User from '../models/userModel.js';
import Session from '../models/sessionModel.js';
import { getStrongPasswordError } from '../utils/passwordPolicy.js';
import { handle, doctorScope, staffRoles, pick, fail } from '../utils/clinicAccess.js';

const fields = ['staffId', 'nursingLicense', 'shift', 'shiftTime', 'shiftStartTime', 'shiftEndTime', 'assignedWard', 'yearsOfExperience', 'qualifications', 'assistantId', 'department', 'supervisor', 'technicianId', 'labType', 'staffCertifications', 'housekeepingStaffId', 'assignedArea', 'housekeepingSupervisor', 'supervisorId', 'teamSize', 'responsibilities', 'managerId', 'employeesUnder', 'budgetResponsibility', 'billingId', 'softwareExpertise'];
const details = body => Object.fromEntries(fields.flatMap(key => {
  const snake = key.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
  const value = body[key] ?? body[snake];
  return value === undefined ? [] : [[key, value]];
}));
const scope = req => doctorScope(req, req.body?.doctor_id || req.query?.doctor_id);
const safe = user => { const data = user.toJSON(); delete data.walletCreditPaymentIds; delete data.walletAdjustmentIds; return data; };
export const addStaff = handle(async (req, res) => {
  const assignedDoctor = await scope(req);
  const b = req.body;
  const role = String(b.role || '').toLowerCase();
  if (!staffRoles.includes(role)) throw fail(400, 'Invalid staff role');
  const passwordError = getStrongPasswordError(b.password);
  if (passwordError) throw fail(400, passwordError);
  const email = String(b.email || '').trim().toLowerCase();
  const phoneNumber = String(b.phoneNumber || b.phone_number || b.contact_number || '').replace(/[\s()-]/g, '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\+?\d{7,15}$/.test(phoneNumber)) throw fail(400, 'Valid email and phone number are required');
  if (await User.exists({ $or: [{ email }, { phoneNumber }] })) throw fail(409, 'Account already exists');
  const user = await User.create({ ...details(b), fullName: b.fullName || b.full_name || b.name, email,
    phoneNumber, phoneCountryCode: b.phoneCountryCode || '+91', password: await bcrypt.hash(b.password, 10),
    role, assignedDoctor, isActive: true, isEmailVerified: false, isPhoneVerified: false, profileCompleted: true });
  res.status(201).json({ success: true, message: 'Staff account created', user: safe(user) });
});
export const listStaff = handle(async (req, res) => {
  const users = await User.find({ assignedDoctor: await scope(req), role: { $in: staffRoles } });
  res.json({ success: true, data: users.map(safe) });
});
export const updateStaff = handle(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, assignedDoctor: await scope(req), role: { $in: staffRoles } });
  if (!user) throw fail(404, 'Staff member not found');
  Object.assign(user, details(req.body), pick(req.body, ['fullName']));
  await user.save();
  res.json({ success: true, user: safe(user) });
});
export const removeStaff = handle(async (req, res) => {
  const user = await User.findOneAndUpdate({ _id: req.params.id, assignedDoctor: await scope(req), role: { $in: staffRoles } },
    { $set: { isActive: false } }, { returnDocument: 'after' });
  if (!user) throw fail(404, 'Staff member not found');
  await Session.updateMany({ userId: user._id, isActive: true }, { $set: { isActive: false, logoutAt: new Date() } });
  res.json({ success: true, message: 'Staff account deactivated' });
});
