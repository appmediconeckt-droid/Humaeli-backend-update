import User from '../models/userModel.js';
import Clinic from '../models/clinicModel.js';
import Appointment from '../models/appointmentModel.js';
import WalkinAppointment from '../models/walkinAppointmentModel.js';
import { handle, doctorScope, receptionistClinicScope, dateOnly, todayIST, fail } from '../utils/clinicAccess.js';
import { normalizeQueueAppointment, isActiveQueueAppointment, isServingQueueAppointment } from '../services/queueTimingService.js';
import { getDisplayTiming } from '../services/displayTimingService.js';
import { actorId } from '../utils/clinicAccess.js';
import { validateVitals, ensureWalkinVitalsSchema } from '../services/appointmentVitalsService.js';
import { appointmentPatientPhone } from '../utils/appointmentPatientPhone.js';

export const saveAppointmentVitals = handle(async (req, res) => {
  const doctorId = await doctorScope(req);
  if (!['doctor', 'receptionist'].includes(req.clinicAccessUser.role)) throw fail(403, 'Only the doctor or receptionist can record vitals');
  const clinicId = await receptionistClinicScope(req);
  const source = req.body?.source;
  if (!['online', 'walkin'].includes(source)) throw fail(400, 'A valid appointment source is required');
  const vitals = validateVitals(req.body?.vitals);
  const Model = source === 'walkin' ? WalkinAppointment : Appointment;
  const scope = { _id: req.params.id, [source === 'walkin' ? 'doctor_id' : 'counselor']: doctorId, ...(clinicId ? { clinic_id: clinicId } : {}) };
  const row = await Model.findOne(scope);
  if (!row) throw fail(404, 'Appointment not found in your assigned clinic');
  const normalized = normalizeQueueAppointment(row, source);
  if (!isActiveQueueAppointment(normalized)) throw fail(409, 'Vitals cannot be changed for a closed appointment');
  if (normalized.date !== todayIST()) throw fail(409, "Vitals can only be recorded for today's appointments");
  if (source === 'walkin') await ensureWalkinVitalsSchema();
  const recorded = { ...vitals, recorded_at: new Date().toISOString(), recorded_by: actorId(req), recorded_role: req.clinicAccessUser.role };
  const updated = await Model.updateOne({ ...scope,
    ...(row.status ? { status: row.status } : {}),
    ...(row.appointment_status ? { appointment_status: row.appointment_status } : {}),
    ...(row.queue_status ? { queue_status: row.queue_status } : {}),
  }, { $set: { vitals: recorded } });
  if (!updated.matchedCount) throw fail(409, 'Appointment changed. Refresh and try again.');
  const patientId = source === 'walkin' ? row.patient_id : row.patient?._id || row.patient;
  if (patientId && global.io) {
    global.io.to(`user_${String(patientId)}`).emit('patientVitalsUpdated', { appointmentId: String(row._id || row.id), recordedAt: recorded.recorded_at });
  }
  res.json({ success: true, vitals: recorded });
});

export const receptionistDashboard = handle(async (req, res) => {
  const doctorId = await doctorScope(req, req.query?.doctor_id);
  const clinicId = await receptionistClinicScope(req, req.query?.clinic_id);
  const date = dateOnly(req.query?.date || todayIST());
  const [doctor, clinics] = await Promise.all([
    User.findOne({ _id: doctorId, role: 'doctor', isActive: true })
      .select('fullName email phoneNumber specialization qualification experience bio aboutMe location consultationMode languages education profilePhoto'),
    Clinic.find({ doctor_id: doctorId, ...(clinicId ? { _id: clinicId } : {}) }),
  ]);
  if (!doctor) throw fail(404, 'Assigned doctor is unavailable');
  if (clinicId && !clinics.some(row => String(row._id || row.id) === clinicId)) throw fail(403, 'Clinic does not belong to your doctor');
  const clinicFilter = clinicId ? { clinic_id: clinicId } : {};
  const [online, walkins] = await Promise.all([
    Appointment.find({ counselor: doctorId, appointment_date: date, ...clinicFilter })
      .populate('patient', 'fullName phoneNumber phone_number phone mobile age gender').sort({ appointment_time: 1, token_number: 1 }).lean(),
    WalkinAppointment.find({ doctor_id: doctorId, appointment_date: date, ...clinicFilter }).lean(),
  ]);
  const appointments = [...online.map(row => ({ row, source: 'online' })), ...walkins.map(row => ({ row, source: 'walkin' }))]
    .map(({ row, source }) => ({
      ...normalizeQueueAppointment(row, source),
      patientName: row.patient?.fullName || row.patient_name || 'Patient',
      phoneNumber: appointmentPatientPhone(row),
      age: row.patient?.age ?? row.age, gender: row.patient?.gender || row.gender,
      emergencyReason: row.emergency_reason || row.emergencyReason || '',
      symptoms: row.symptoms || '', diagnosis: row.diagnosis || '', advice: row.advice || '',
      vitals: row.vitals || null,
    })).sort((a, b) => Number(b.emergency) - Number(a.emergency) || a.time.localeCompare(b.time) || (a.token || 0) - (b.token || 0));
  const currentPatients = appointments.filter(isServingQueueAppointment);
  const waiting = appointments.filter(row => isActiveQueueAppointment(row) && !isServingQueueAppointment(row));
  const timing = clinicId ? await getDisplayTiming({ doctorId, date, clinicId }) : null;
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, doctor, clinics, date, appointments, currentPatients, waiting,
    summary: { total: appointments.length, waiting: waiting.length, ongoing: currentPatients.length,
      completed: appointments.filter(row => ['completed', 'complete', 'done'].includes(row.status) || row.queueStatus === 'completed').length },
    timing, updatedAt: new Date().toISOString() });
});
