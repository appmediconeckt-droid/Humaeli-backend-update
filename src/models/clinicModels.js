import mongoose from '../persistence/mongoose.js';

const ref = (model = 'User', required = true) => ({ type: mongoose.Schema.Types.ObjectId, ref: model, required });
const requiredText = { type: String, required: true, trim: true, maxlength: 2000 };
const model = (name, collection, fields, indexes = []) => {
  const schema = new mongoose.Schema(fields, { timestamps: true, collection });
  schema.set('toJSON', { virtuals: true });
  for (const [keys, options] of indexes) schema.index(keys, options);
  return mongoose.models[name] || mongoose.model(name, schema);
};

export const Clinic = model('Clinic', 'clinics', {
  doctor_id: ref(), clinic_name: requiredText, phone_number: requiredText,
  location: requiredText, clinic_photo: String,
});
export const Availability = model('Availability', 'date_ranges', {
  doctor_id: ref(), clinic_id: ref('Clinic'), availability_date: String,
  weekday: { type: Number, min: 0, max: 6, required: true },
  start_time: requiredText, end_time: requiredText,
  slot_duration: { type: Number, min: 1, max: 1440, default: 15 },
  is_unavailable: { type: Boolean, default: false },
});
export const UnavailableDate = model('UnavailableDate', 'unavailable_dates', {
  doctor_id: ref(), unavailable_date: requiredText,
}, [[{ doctor_id: 1, unavailable_date: 1 }, { unique: true }]]);
export const WalkinAppointment = model('WalkinAppointment', 'walkin_appointments', {
  clinic_id: ref('Clinic', false), doctor_clinic_id: String, facility_id: String, queue_entry_id: String,
  doctor_id: ref(), patient_id: ref('User', false), patient_name: requiredText,
  phone_number: requiredText, date_of_birth: Date, gender: { type: String, enum: ['male', 'female', 'other'] },
  symptoms: requiredText, appointment_date: requiredText, appointment_time: requiredText,
  token_number: { type: Number, required: true },
  appointment_status: { type: String, enum: ['booked', 'pending', 'confirmed', 'completed', 'cancelled'], default: 'booked' },
  booking_source: { type: String, enum: ['qr', 'direct'], default: 'direct' },
  diagnosis: String, advice: String, additional_notes: String, follow_up_required: Boolean,
  follow_up_date: Date,
});
export const FollowUp = model('FollowUp', 'follow_ups', {
  doctor_id: ref(), patient_id: ref('User', false), appointment_id: ref('Appointment', false),
  walkin_id: ref('WalkinAppointment', false), patient_name: String,
  follow_up_date: { type: Date, required: true }, follow_up_type: String, reason: String, notes: String,
  status: { type: String, enum: ['pending', 'completed', 'cancelled'], default: 'pending' },
}, [[{ walkin_id: 1 }, { unique: true, sparse: true }]]);
export const Leave = model('Leave', 'leaves', {
  user_id: ref(), doctor_id: ref('User', false), leave_type: requiredText,
  start_date: { type: Date, required: true }, end_date: { type: Date, required: true }, reason: requiredText,
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending' },
  reviewed_by: ref('User', false),
});
export const Medication = model('Medication', 'medications', {
  doctor_id: ref(), created_by: ref(), patient_id: ref('User', false),
  medication_name: requiredText, dose: requiredText, timing: requiredText, route: requiredText,
  patient_name: requiredText, room_number: requiredText, remarks: String,
  status: { type: String, enum: ['pending', 'given', 'missed'], default: 'pending' },
});
export const DoctorBreak = model('DoctorBreak', 'doctor_breaks', {
  doctor_id: ref(), started_at: { type: Date, required: true }, ended_at: Date,
  planned_minutes: { type: Number, required: true, min: 1, max: 240 },
  reason: String, active_key: String,
  status: { type: String, enum: ['active', 'ended'], default: 'active' },
}, [[{ active_key: 1 }, { unique: true, sparse: true }]]);
export const DoctorAnalyticsEvent = model('DoctorAnalyticsEvent', 'doctor_analytics_events', {
  doctor_id: ref(), event_type: { type: String, enum: ['qr_scan', 'profile_view'], required: true }, source: String,
});
export const AppointmentCounter = model('AppointmentCounter', 'appointment_counters', {
  key: { type: String, required: true }, value: { type: Number, default: 0 },
}, [[{ key: 1 }, { unique: true }]]);
export const AppointmentSlot = model('AppointmentSlot', 'appointment_slots', {
  key: { type: String, required: true }, doctor_id: ref(), appointment_date: requiredText,
  appointment_time: requiredText, booking_source: { type: String, required: true },
}, [[{ key: 1 }, { unique: true }]]);
