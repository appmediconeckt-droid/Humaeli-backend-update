import bcrypt from 'bcryptjs';
import User from '../models/userModel.js';
import Session from '../models/sessionModel.js';
import Clinic from '../models/clinicModel.js';
import { getStrongPasswordError } from '../utils/passwordPolicy.js';
import { sendStaffWelcomeEmail } from '../services/staffWelcomeEmailService.js';
import { handle, doctorScope, staffRoles, pick, fail } from '../utils/clinicAccess.js';

const fields = ['staffId', 'nursingLicense', 'shift', 'shiftTime', 'shiftStartTime', 'shiftEndTime', 'assignedWard', 'yearsOfExperience', 'qualifications', 'assistantId', 'department', 'supervisor', 'technicianId', 'labType', 'staffCertifications', 'housekeepingStaffId', 'assignedArea', 'housekeepingSupervisor', 'supervisorId', 'teamSize', 'responsibilities', 'managerId', 'employeesUnder', 'budgetResponsibility', 'billingId', 'softwareExpertise'];
const details = body => Object.fromEntries(fields.flatMap(key => {
  const snake = key.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
  const value = body[key] ?? body[snake];
  return value === undefined ? [] : [[key, value]];
}));
const scope = req => doctorScope(req, req.body?.doctor_id || req.query?.doctor_id);
const safe = user => { const data = user.toJSON(); delete data.walletCreditPaymentIds; delete data.walletAdjustmentIds; return data; };
const ownedClinic = async (doctorId, clinicId) => {
  if (typeof clinicId !== 'string' || !clinicId.trim()) throw fail(400, 'Please select a clinic or hospital');
  const clinic = await Clinic.findOne({ _id: clinicId.trim(), doctor_id: doctorId });
  if (!clinic) throw fail(404, 'Clinic not found for this doctor');
  return clinic;
};
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
  const clinic = b.clinic_id !== undefined ? await ownedClinic(assignedDoctor, b.clinic_id) : null;
  const user = await User.create({ ...details(b), fullName: b.fullName || b.full_name || b.name, email,
    phoneNumber, phoneCountryCode: b.phoneCountryCode || '+91', password: await bcrypt.hash(b.password, 10),
    role, assignedDoctor, ...(clinic ? { clinic_id: b.clinic_id.trim() } : {}),
    isActive: true, isEmailVerified: false, isPhoneVerified: false, profileCompleted: true });
  let emailSent = false;
  try {
    await sendStaffWelcomeEmail({ email, fullName: user.fullName, password: b.password });
    emailSent = true;
  } catch (error) {
    // The account already exists. Do not turn a mail outage into a failed
    // creation response or log an error that may contain the password.
    console.error('Staff welcome email delivery failed', {
      code: error.code || 'EMAIL_DELIVERY_FAILED', status: error.status || error.responseCode || null,
    });
  }
  res.status(201).json({ success: true,
    message: emailSent ? 'Staff account created' : 'Staff account created, but the temporary-password email could not be sent. Staff can use Forgot Password to set a password.',
    user: { ...safe(user), ...(clinic ? { clinic_name: clinic.clinic_name } : {}) }, emailSent });
});
export const resendStaffWelcomeEmail = handle(async (req, res) => {
  const assignedDoctor = await scope(req);
  const user = await User.findOne({ _id: req.params.id, assignedDoctor,
    role: { $in: staffRoles }, isActive: true }).select('+password');
  if (!user) throw fail(404, 'Staff member not found');
  const password = req.body?.password;
  if (typeof password !== 'string' || !await bcrypt.compare(password, user.password || '')) {
    throw fail(400, 'The temporary password no longer matches this account. Staff can use Forgot Password to set a new password.');
  }
  try {
    await sendStaffWelcomeEmail({ email: user.email, fullName: user.fullName, password });
  } catch (error) {
    console.error('Staff welcome email delivery failed', {
      code: error.code || 'EMAIL_DELIVERY_FAILED', status: error.status || error.responseCode || null,
    });
    return res.status(502).json({ success: false, emailSent: false,
      message: 'The login email could not be sent. Please try again shortly or use Forgot Password.' });
  }
  res.json({ success: true, emailSent: true, message: 'Staff login email sent' });
});
export const listStaff = handle(async (req, res) => {
  const doctorId = await scope(req);
  const users = await User.find({ assignedDoctor: doctorId, role: { $in: staffRoles }, isActive: true });
  const clinics = await Clinic.find({ doctor_id: doctorId });
  const names = new Map(clinics.map(clinic => [String(clinic._id || clinic.id), clinic.clinic_name]));
  res.json({ success: true, data: users.map(user => ({ ...safe(user), clinic_name: names.get(String(user.clinic_id || '')) || null })) });
});
export const updateStaff = handle(async (req, res) => {
  const doctorId = await scope(req);
  const user = await User.findOne({ _id: req.params.id, assignedDoctor: doctorId, role: { $in: staffRoles } });
  if (!user) throw fail(404, 'Staff member not found');
  const clinic = req.body.clinic_id !== undefined ? await ownedClinic(doctorId, req.body.clinic_id) : null;
  if (clinic) user.clinic_id = req.body.clinic_id.trim();
  if (req.body.role !== undefined) {
    if (!staffRoles.includes(req.body.role)) throw fail(400, 'Invalid staff role');
    user.role = req.body.role;
  }
  Object.assign(user, details(req.body), pick(req.body, ['fullName']));
  await user.save();
  res.json({ success: true, user: { ...safe(user), ...(clinic ? { clinic_name: clinic.clinic_name } : {}) } });
});
export const removeStaff = handle(async (req, res) => {
  const user = await User.findOneAndUpdate({ _id: req.params.id, assignedDoctor: await scope(req), role: { $in: staffRoles } },
    { $set: { isActive: false } }, { returnDocument: 'after' });
  if (!user) throw fail(404, 'Staff member not found');
  await Session.updateMany({ userId: user._id, isActive: true }, { $set: { isActive: false, logoutAt: new Date() } });
  res.json({ success: true, message: 'Staff account deactivated' });
});
