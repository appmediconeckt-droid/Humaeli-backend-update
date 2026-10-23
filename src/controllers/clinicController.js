import Appointment from '../models/appointmentModel.js';
import { emitAvailabilityUpdated } from "../services/portalRealtimeService.js";
import { clinicPhotoPath, serializeClinicPhoto } from '../services/clinicPhotoService.js';
import { Clinic, Availability } from '../models/clinicModels.js';
import { handle, doctorScope, pick, fail, jsonRecord } from '../utils/clinicAccess.js';
import { ensureClinicQr } from '../services/clinicQrService.js';
export const createClinic = handle(async (req, res) => {
  const doctor_id = await doctorScope(req, req.body.doctor_id);
  const clinic = await Clinic.create({ ...pick(req.body, ['clinic_name', 'phone_number', 'location']), doctor_id,
    clinic_photo: clinicPhotoPath(req.file) });
  const qr = await ensureClinicQr(clinic);
  emitAvailabilityUpdated(doctor_id);
  res.status(201).json({ success: true, message: 'Clinic created successfully', clinicId: String(clinic._id), clinic: { ...serializeClinicPhoto(jsonRecord(clinic)), ...qr }, ...qr });
});
export const getClinics = handle(async (req, res) => {
  const clinics = await Clinic.find(req.query.doctor_id ? { doctor_id: req.query.doctor_id } : {}).sort({ createdAt: -1 }).lean();
  const rated = clinics.length ? await Appointment.find({ clinic_id: { $in: clinics.map(row => row._id) }, clinicRating: { $exists: true } }).select('clinic_id clinicRating').lean() : [];
  const summaries = new Map();
  for (const row of rated) {
    const key = String(row.clinic_id);
    const summary = summaries.get(key) || { sum: 0, count: 0 };
    if (Number.isInteger(row.clinicRating?.stars)) { summary.sum += row.clinicRating.stars; summary.count += 1; }
    summaries.set(key, summary);
  }
  res.json({ success: true, clinics: clinics.map(row => {
    const summary = summaries.get(String(row._id));
    return { ...serializeClinicPhoto(jsonRecord(row)), rating: summary?.count ? Math.round(summary.sum / summary.count * 10) / 10 : 0, ratingCount: summary?.count || 0 };
  }) });
});
export const getClinicById = handle(async (req, res) => {
  const clinic = await Clinic.findById(req.params.id).lean();
  if (!clinic) throw fail(404, 'Clinic not found');
  res.json({ success: true, clinic: serializeClinicPhoto(jsonRecord(clinic)) });
});
export const updateClinic = handle(async (req, res) => {
  const clinic = await Clinic.findById(req.params.id);
  if (!clinic) throw fail(404, 'Clinic not found');
  await doctorScope(req, clinic.doctor_id);
  Object.assign(clinic, pick(req.body, ['clinic_name', 'phone_number', 'location']));
  if (req.file) clinic.clinic_photo = clinicPhotoPath(req.file);
  await clinic.save();
  const qr = await ensureClinicQr(clinic);
  emitAvailabilityUpdated(clinic.doctor_id);
  res.json({ success: true, message: 'Clinic updated successfully', clinic: { ...serializeClinicPhoto(jsonRecord(clinic)), ...qr } });
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
