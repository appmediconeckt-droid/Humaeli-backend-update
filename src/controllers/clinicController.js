import { Clinic, Availability } from '../models/clinicModels.js';
import { handle, doctorScope, pick, fail, jsonRecord } from '../utils/clinicAccess.js';
export const createClinic = handle(async (req, res) => {
  const doctor_id = await doctorScope(req, req.body.doctor_id);
  const clinic = await Clinic.create({ ...pick(req.body, ['clinic_name', 'phone_number', 'location']), doctor_id,
    clinic_photo: req.file ? '/uploads/' + req.file.filename : undefined });
  res.status(201).json({ success: true, message: 'Clinic created successfully', clinicId: String(clinic._id), clinic: jsonRecord(clinic) });
});
export const getClinics = handle(async (req, res) => {
  const clinics = await Clinic.find(req.query.doctor_id ? { doctor_id: req.query.doctor_id } : {}).sort({ createdAt: -1 }).lean();
  res.json({ success: true, clinics: clinics.map(jsonRecord) });
});
export const getClinicById = handle(async (req, res) => {
  const clinic = await Clinic.findById(req.params.id).lean();
  if (!clinic) throw fail(404, 'Clinic not found');
  res.json({ success: true, clinic: jsonRecord(clinic) });
});
export const updateClinic = handle(async (req, res) => {
  const clinic = await Clinic.findById(req.params.id);
  if (!clinic) throw fail(404, 'Clinic not found');
  await doctorScope(req, clinic.doctor_id);
  Object.assign(clinic, pick(req.body, ['clinic_name', 'phone_number', 'location']));
  if (req.file) clinic.clinic_photo = '/uploads/' + req.file.filename;
  await clinic.save();
  res.json({ success: true, message: 'Clinic updated successfully', clinic: jsonRecord(clinic) });
});
export const deleteClinic = handle(async (req, res) => {
  const clinic = await Clinic.findById(req.params.id);
  if (!clinic) throw fail(404, 'Clinic not found');
  await doctorScope(req, clinic.doctor_id);
  if (await Availability.exists({ clinic_id: clinic._id })) throw fail(409, 'Remove clinic availability before deleting this clinic');
  await clinic.deleteOne();
  res.json({ success: true, message: 'Clinic deleted successfully' });
});
