import { summarizeAppointmentRatings } from '../services/doctorRatingService.js';
import Appointment from '../models/appointmentModel.js';
import { emitAvailabilityUpdated } from "../services/portalRealtimeService.js";
import { clinicPhotoPath, serializeClinicPhoto } from '../services/clinicPhotoService.js';
import { Clinic, Availability } from '../models/clinicModels.js';
import { handle, doctorScope, pick, fail, jsonRecord } from '../utils/clinicAccess.js';
import { ensureClinicQr } from '../services/clinicQrService.js';
import User from '../models/userModel.js';
import { feeCurrency, validFee } from '../utils/consultationCurrency.js';

// A null clinic fee follows the doctor's profile fee, including future changes.
export async function clinicFeeUpdate(body, doctorId) {
  if (body.fee === undefined && body.videoConsultationAdditionalFee === undefined) return {};
  if (body.videoConsultationAdditionalFee === undefined && (body.fee === null || body.fee === '')) return { fee: null };
  const doctor = await User.findById(doctorId);
  const result = {};
  if (body.fee !== undefined) {
    if (body.fee === null || body.fee === '') result.fee = null;
    else {
      if (!['string', 'number'].includes(typeof body.fee) || !validFee(body.fee, feeCurrency(doctor || {}) || 'INR')) throw fail(400, 'Enter a valid clinic fee in your profile currency.');
      result.fee = Number(body.fee);
    }
  }
  if (body.videoConsultationAdditionalFee !== undefined) {
    const value = body.videoConsultationAdditionalFee;
    if (!['string', 'number'].includes(typeof value) || !validFee(value, feeCurrency(doctor || {}) || 'INR')) throw fail(400, 'Enter a valid non-negative video additional fee for this clinic.');
    result.videoConsultationAdditionalFee = Number(value);
  }
  return result;
}
const clinicRecord = row => ({ ...serializeClinicPhoto(jsonRecord(row)), fee: row.fee ?? null, videoConsultationAdditionalFee: row.videoConsultationAdditionalFee ?? 0 });
export const createClinic = handle(async (req, res) => {
  const doctor_id = await doctorScope(req, req.body.doctor_id);
  const clinic = await Clinic.create({ ...pick(req.body, ['clinic_name', 'phone_number', 'location']), doctor_id,
    ...await clinicFeeUpdate(req.body, doctor_id),
    clinic_photo: clinicPhotoPath(req.file) });
  const qr = await ensureClinicQr(clinic);
  emitAvailabilityUpdated(doctor_id);
  res.status(201).json({ success: true, message: 'Clinic created successfully', clinicId: String(clinic._id), clinic: { ...clinicRecord(clinic), ...qr }, ...qr });
});
export const getClinics = handle(async (req, res) => {
  const clinics = await Clinic.find(req.query.doctor_id ? { doctor_id: req.query.doctor_id } : {}).sort({ createdAt: -1 }).lean();
  const rated = clinics.length ? await Appointment.find({ clinic_id: { $in: clinics.map(row => row._id) }, clinicRating: { $exists: true } }).select('clinic_id patient clinicRating').lean() : [];
  const summaries = summarizeAppointmentRatings(rated, 'clinic');
  res.json({ success: true, clinics: clinics.map(row => {
    const summary = summaries.get(String(row._id));
    return { ...clinicRecord(row), rating: summary?.rating || 0, ratingCount: summary?.ratingCount || 0 };
  }) });
});
export const getClinicById = handle(async (req, res) => {
  const clinic = await Clinic.findById(req.params.id).lean();
  if (!clinic) throw fail(404, 'Clinic not found');
  const rated = await Appointment.find({ clinic_id: clinic._id, clinicRating: { $exists: true } }).select('clinic_id patient clinicRating').lean();
  const summary = summarizeAppointmentRatings(rated, 'clinic').get(String(clinic._id));
  res.json({ success: true, clinic: { ...clinicRecord(clinic), rating: summary?.rating || 0, ratingCount: summary?.ratingCount || 0 } });
});
export const updateClinic = handle(async (req, res) => {
  const clinic = await Clinic.findById(req.params.id);
  if (!clinic) throw fail(404, 'Clinic not found');
  await doctorScope(req, clinic.doctor_id);
  Object.assign(clinic, pick(req.body, ['clinic_name', 'phone_number', 'location']), await clinicFeeUpdate(req.body, clinic.doctor_id));
  if (req.file) clinic.clinic_photo = clinicPhotoPath(req.file);
  await clinic.save();
  const qr = await ensureClinicQr(clinic);
  emitAvailabilityUpdated(clinic.doctor_id);
  res.json({ success: true, message: 'Clinic updated successfully', clinic: { ...clinicRecord(clinic), ...qr } });
});
export const deleteClinic = handle(async (req, res) => {
  const clinic = await Clinic.findById(req.params.id);
  if (!clinic) throw fail(404, 'Clinic not found');
  await doctorScope(req, clinic.doctor_id);
  if (await Availability.exists({ clinic_id: clinic._id })) throw fail(409, 'Remove clinic availability before deleting this clinic');
  await clinic.deleteOne();
  emitAvailabilityUpdated(clinic.doctor_id);
  res.json({ success: true, message: 'Clinic deleted successfully' });
});
