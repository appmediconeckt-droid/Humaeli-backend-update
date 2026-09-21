import { Medication } from '../models/clinicModels.js';
import { handle, doctorScope, actorId, pick, fail, jsonRecord } from '../utils/clinicAccess.js';
const fields = ['medication_name', 'dose', 'timing', 'route', 'patient_name', 'room_number', 'remarks'];
const owner = req => doctorScope(req, req.body?.doctor_id || req.query?.doctor_id);
export const addMedication = handle(async (req, res) => {
  const doctor_id = await owner(req);
  const row = await Medication.create({ ...pick(req.body, fields), doctor_id, created_by: actorId(req) });
  res.status(201).json({ success: true, message: 'Medication added successfully', data: jsonRecord(row) });
});
const list = async (req, res) => {
  const filter = { doctor_id: await owner(req) };
  const status = req.params.status || req.query.status;
  if (status) {
    if (!['pending', 'given', 'missed'].includes(status)) throw fail(400, 'Invalid medication status');
    filter.status = status;
  }
  let rows = await Medication.find(filter).sort({ createdAt: -1 }).lean();
  const search = String(req.query.search || '').toLowerCase();
  if (search) rows = rows.filter(r => [r.medication_name, r.patient_name, r.room_number].some(v => String(v).toLowerCase().includes(search)));
  res.json({ success: true, data: rows.map(jsonRecord), count: rows.length });
};
export const getAllMedications = handle(list);
export const getMedicationsByStatus = handle(list);
export const getMedicationById = handle(async (req, res) => {
  const row = await Medication.findOne({ _id: req.params.id, doctor_id: await owner(req) });
  if (!row) throw fail(404, 'Medication not found');
  res.json({ success: true, data: jsonRecord(row) });
});
const update = statusOnly => handle(async (req, res) => {
  const row = await Medication.findOneAndUpdate({ _id: req.params.id, doctor_id: await owner(req) },
    { $set: pick(req.body, statusOnly ? ['status'] : [...fields, 'status']) }, { returnDocument: 'after', runValidators: true });
  if (!row) throw fail(404, 'Medication not found');
  res.json({ success: true, data: jsonRecord(row) });
});
export const updateMedication = update(false);
export const updateMedicationStatus = update(true);
export const deleteMedication = handle(async (req, res) => {
  const row = await Medication.findOneAndDelete({ _id: req.params.id, doctor_id: await owner(req) });
  if (!row) throw fail(404, 'Medication not found');
  res.json({ success: true, message: 'Medication deleted successfully' });
});

