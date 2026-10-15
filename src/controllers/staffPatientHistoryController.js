import User from '../models/userModel.js';
import Clinic from '../models/clinicModel.js';
import Appointment from '../models/appointmentModel.js';
import WalkinAppointment from '../models/walkinAppointmentModel.js';
import Prescription from '../models/Prescription.js';
import { doctorScope, receptionistClinicScope, handle, fail, dateOnly } from '../utils/clinicAccess.js';
import { appointmentToPrescriptionResponse, asWalkinConsultation, expandConsultationDetails, toResponse } from './prescriptionController.js';

const idOf = value => String(value?._id || value?.id || value || '');
const dayIST = value => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() + 19800000).toISOString().slice(0, 10) : '';
};
export const staffPatientHistory = handle(async (req, res) => {
  const doctorId = await doctorScope(req, req.query?.doctor_id);
  const clinicId = await receptionistClinicScope(req, req.query?.clinic_id);
  const from = req.query?.from ? dateOnly(req.query.from) : '';
  const to = req.query?.to ? dateOnly(req.query.to) : '';
  if (from && to && from > to) throw fail(400, 'Start date must be before end date');
  const source = req.query?.source || 'all';
  if (!['all', 'online', 'walkin', 'prescription'].includes(source)) throw fail(400, 'Invalid history source');
  const page = Number(req.query?.page ?? 1), limit = Number(req.query?.limit ?? 10);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw fail(400, 'Invalid pagination');
  const [doctor, clinics] = await Promise.all([
    User.findOne({ _id: doctorId, role: 'doctor', isActive: true }).select('fullName qualification specialization role accountType'),
    Clinic.find({ doctor_id: doctorId, ...(clinicId ? { _id: clinicId } : {}) }),
  ]);
  if (!doctor) throw fail(404, 'Assigned doctor is unavailable');
  if (clinicId && !clinics.some(row => idOf(row) === clinicId)) throw fail(403, 'Clinic does not belong to your doctor');
  const clinicFilter = clinicId ? { clinic_id: clinicId } : {};
  const [online, walkins, prescriptions] = await Promise.all([
    ['all', 'online'].includes(source) ? Appointment.find({ counselor: doctorId, $or: [{ status: 'completed' }, { queue_status: 'completed' }], ...clinicFilter })
      .populate('patient', 'fullName phoneNumber age gender').lean() : [],
    // Native walk-in tables use appointment_status; legacy status/queue fields
    // may not exist as SQL columns. Evaluate completion after reading scoped rows.
    ['all', 'walkin'].includes(source) ? WalkinAppointment.find({ doctor_id: doctorId, ...clinicFilter }).lean() : [],
    !clinicId && ['all', 'prescription'].includes(source) ? Prescription.find({ psychiatristId: doctorId })
      .select('_id patientId psychiatristId patientSnapshot psychiatristSnapshot problem medicines instructions issuedAt identityVerification').lean() : [],
  ]);
  const completedWalkins = walkins.filter(row => [row.appointment_status || row.status, row.queue_status]
    .some(value => ['completed', 'complete', 'done'].includes(String(value || '').trim().toLowerCase())));
  const visits = [...online.map(row => ({ row, visitSource: 'online' })), ...completedWalkins.map(row => ({ row: asWalkinConsultation(row), visitSource: 'walkin' }))].map(({ row, visitSource }) => {
    const expanded = expandConsultationDetails(row);
    const patient = { id: idOf(row.patient), name: row.patient?.fullName || row.patient_name || 'Patient', phoneNumber: row.patient?.phoneNumber || row.phone_number || '', gender: row.patient?.gender || row.gender, age: row.patient?.age ?? row.age };
    const prescription = { ...appointmentToPrescriptionResponse(row, doctor), patient };
    return { id: `${visitSource}:${idOf(row)}`, source: visitSource, patient, clinicId: idOf(row.clinic_id),
      doctor: { id: doctorId, name: doctor.fullName }, appointmentDate: row.appointment_date || dayIST(row.date),
      checkedDate: dayIST(row.consultation_ended_at) || row.appointment_date || dayIST(row.date),
      checkedAt: row.consultation_ended_at || null, appointmentTime: row.appointment_time || '', token: row.token_number ?? null,
      symptoms: expanded.symptoms || '', diagnosis: prescription.diagnosis, vitals: expanded.vitals || null,
      hasPrescription: Boolean(prescription.medicines.length || prescription.advice || prescription.additionalNotes || prescription.recommendedTests.length), prescription };
  });
  const issued = prescriptions.map(row => ({ id: `prescription:${idOf(row)}`, source: 'prescription',
    patient: { id: idOf(row.patientId), name: row.patientSnapshot?.name || 'Patient' },
    doctor: { id: doctorId, name: doctor.fullName }, clinicId: '', checkedDate: dayIST(row.issuedAt),
    checkedAt: row.issuedAt, hasPrescription: true, prescription: { ...toResponse(row), source: 'prescription', canViewFile: false, canDownload: false } }));
  const search = String(req.query?.search || '').trim().toLowerCase().slice(0, 150);
  const records = [...visits, ...issued].filter(row => (!from || row.checkedDate >= from) && (!to || row.checkedDate <= to) &&
    `${row.patient.name} ${row.patient.phoneNumber || ''} ${row.token ?? ''}`.toLowerCase().includes(search))
    .sort((a, b) => b.checkedDate.localeCompare(a.checkedDate) || String(b.checkedAt || b.appointmentTime || '').localeCompare(String(a.checkedAt || a.appointmentTime || '')) || b.id.localeCompare(a.id));
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, doctor: { id: doctorId, name: doctor.fullName }, clinics,
    records: records.slice((page - 1) * limit, page * limit), total: records.length, page, limit,
    summary: { visits: records.filter(row => row.source !== 'prescription').length,
      patients: new Set(records.map(row => row.patient.id || row.id)).size,
      prescriptions: records.filter(row => row.hasPrescription).length },
    separatePrescriptionsExcluded: Boolean(clinicId), updatedAt: new Date().toISOString() });
});
