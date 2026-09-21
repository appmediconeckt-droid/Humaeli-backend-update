import { DoctorAnalyticsEvent, WalkinAppointment } from '../models/clinicModels.js';
import Appointment from '../models/appointmentModel.js';
import User from '../models/userModel.js';
import { fail, todayIST } from '../utils/clinicAccess.js';
export const normalizeBookingSource = value => String(value || '').toLowerCase() === 'qr' ? 'qr' : 'direct';
export const recordDoctorAnalyticsEvent = async ({ doctorId, eventType, source }) => {
  if (!await User.exists({ _id: doctorId, role: 'doctor', isActive: true })) throw fail(404, 'Doctor not found');
  return DoctorAnalyticsEvent.create({ doctor_id: doctorId, event_type: eventType, source: String(source || '').slice(0, 50) });
};
export const getDoctorQuickStats = async doctorId => {
  if (!await User.exists({ _id: doctorId, role: 'doctor' })) return null;
  const start = new Date(todayIST() + 'T00:00:00+05:30');
  const weekday = new Date(todayIST() + 'T00:00:00Z').getUTCDay();
  const week = new Date(start.getTime() - ((weekday + 6) % 7) * 86400000);
  const [todayScans, thisWeekScans, profileViews, qrScans, appointments, walkins, qr, walkinQr] = await Promise.all([
    DoctorAnalyticsEvent.countDocuments({ doctor_id: doctorId, event_type: 'qr_scan', createdAt: { $gte: start } }),
    DoctorAnalyticsEvent.countDocuments({ doctor_id: doctorId, event_type: 'qr_scan', createdAt: { $gte: week } }),
    DoctorAnalyticsEvent.countDocuments({ doctor_id: doctorId, event_type: 'profile_view' }),
    DoctorAnalyticsEvent.countDocuments({ doctor_id: doctorId, event_type: 'qr_scan' }),
    Appointment.countDocuments({ counselor: doctorId }), WalkinAppointment.countDocuments({ doctor_id: doctorId }),
    Appointment.countDocuments({ counselor: doctorId, booking_source: 'qr' }),
    WalkinAppointment.countDocuments({ doctor_id: doctorId, booking_source: 'qr' }),
  ]);
  return { todayScans, thisWeekScans, profileViews, qrScans, appointments: appointments + walkins,
    qrAppointments: qr + walkinQr, regularAppointments: appointments + walkins - qr - walkinQr };
};

