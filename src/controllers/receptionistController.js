import User from '../models/userModel.js';
import Clinic from '../models/clinicModel.js';
import Appointment from '../models/appointmentModel.js';
import WalkinAppointment from '../models/walkinAppointmentModel.js';
import { handle, doctorScope, receptionistClinicScope, dateOnly, todayIST, fail } from '../utils/clinicAccess.js';
import { normalizeQueueAppointment, isActiveQueueAppointment, isServingQueueAppointment } from '../services/queueTimingService.js';
import { getDisplayTiming } from '../services/displayTimingService.js';

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
      .populate('patient', 'fullName phoneNumber age gender').sort({ appointment_time: 1, token_number: 1 }).lean(),
    WalkinAppointment.find({ doctor_id: doctorId, appointment_date: date, ...clinicFilter }).lean(),
  ]);
  const appointments = [...online.map(row => ({ row, source: 'online' })), ...walkins.map(row => ({ row, source: 'walkin' }))]
    .map(({ row, source }) => ({
      ...normalizeQueueAppointment(row, source),
      patientName: row.patient?.fullName || row.patient_name || 'Patient',
      phoneNumber: row.patient?.phoneNumber || row.phone_number || '',
      age: row.patient?.age ?? row.age, gender: row.patient?.gender || row.gender,
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
