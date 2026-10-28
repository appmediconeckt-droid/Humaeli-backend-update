import User from '../models/userModel.js';
import Clinic from '../models/clinicModel.js';
import Appointment from '../models/appointmentModel.js';
import WalkinAppointment from '../models/walkinAppointmentModel.js';
import { handle, doctorScope, receptionistClinicScope, dateOnly, todayIST, fail } from '../utils/clinicAccess.js';
import { normalizeQueueAppointment, isActiveQueueAppointment, isServingQueueAppointment, comparePatientReturnPriority } from '../services/queueTimingService.js';
import { emitAppointmentUpdated } from '../services/portalRealtimeService.js';
import { notifyUpcomingQueuePatients } from '../services/consultationTimingService.js';

export const updatePatientAvailability = handle(async (req, res) => {
  const doctorId = await doctorScope(req);
  if (!['doctor', 'receptionist'].includes(req.clinicAccessUser.role)) throw fail(403, 'Only the doctor or receptionist can update patient availability');
  const clinicId = await receptionistClinicScope(req);
  const { source, availability } = req.body || {};
  if (!['online', 'walkin'].includes(source) || !['available', 'unavailable'].includes(availability)) throw fail(400, 'A valid appointment source and availability are required');
  const Model = source === 'walkin' ? WalkinAppointment : Appointment;
  const scope = { _id: req.params.id, [source === 'walkin' ? 'doctor_id' : 'counselor']: doctorId, ...(clinicId ? { clinic_id: clinicId } : {}) };
  const row = await Model.findOne(scope);
  if (!row) throw fail(404, 'Appointment not found in your assigned clinic');
  const normalized = normalizeQueueAppointment(row, source);
  const skipped = normalized.status === 'skipped' || normalized.queueStatus === 'skipped';
  if (['completed', 'complete', 'done', 'canceled', 'cancelled', 'rejected', 'no_show', 'no-show'].includes(normalized.status) || normalized.timing.endedAt) throw fail(409, 'Availability cannot be changed for a closed appointment');
  if ((!skipped && !isActiveQueueAppointment(normalized)) || (isServingQueueAppointment(normalized) && normalized.queueStatus !== 'called') || normalized.timing.startedAt) throw fail(409, 'Availability can only be changed before consultation starts');
  if (normalized.date !== todayIST()) throw fail(409, "Availability can only be updated for today's appointments");
  const now = new Date().toISOString();
  const state = { status: availability, updatedAt: now, updatedBy: actorId(req), updatedRole: req.clinicAccessUser.role,
    returnedAt: availability === 'available' ? (skipped ? now : normalized.availability.returnedAt || null) : null };
  let timing = row.consultation_timing || {};
  if (typeof timing === 'string') { try { timing = JSON.parse(timing); } catch { timing = {}; } }
  const changes = { consultation_timing: { ...timing, availability: state } };
  if (availability === 'available') {
    changes.checked_in_at = row.checked_in_at || new Date();
    if (skipped) {
      changes.queue_status = 'waiting';
      if (source === 'walkin') changes.appointment_status = 'booked';
    }
  }
  const result = await Model.updateOne({ ...scope,
    ...(row.status ? { status: row.status } : {}), ...(row.appointment_status ? { appointment_status: row.appointment_status } : {}),
    ...(row.queue_status ? { queue_status: row.queue_status } : {}),
    'consultation_timing.availability.updatedAt': normalized.availability.updatedAt || null,
  }, { $set: changes });
  if (!result.matchedCount) throw fail(409, 'Appointment changed. Refresh and try again.');
  emitAppointmentUpdated(row);
  if (global.io) global.io.to(`user_${doctorId}`).emit('queueUpdated', { doctorId, date: normalized.date });
  await notifyUpcomingQueuePatients(row);
  res.json({ success: true, availability: state, message: skipped && availability === 'available' ? 'Patient returned and will be seen next after the current consultation' : 'Patient availability updated' });
});
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
    })).sort((a, b) => comparePatientReturnPriority(a, b) || a.time.localeCompare(b.time) || (a.token || 0) - (b.token || 0));
  const currentPatients = appointments.filter(isServingQueueAppointment);
  const waiting = appointments.filter(row => isActiveQueueAppointment(row) && !isServingQueueAppointment(row));
  const pendingPatients = appointments.filter(row => row.status === 'skipped' || row.queueStatus === 'skipped');
  const timing = clinicId ? await getDisplayTiming({ doctorId, date, clinicId }) : null;
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, doctor, clinics, date, appointments, currentPatients, waiting, pendingPatients,
    summary: { total: appointments.length, waiting: waiting.length, ongoing: currentPatients.length,
      completed: appointments.filter(row => ['completed', 'complete', 'done'].includes(row.status) || row.queueStatus === 'completed').length },
    timing, updatedAt: new Date().toISOString() });
});
