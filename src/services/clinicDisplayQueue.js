import Appointment from '../models/appointmentModel.js';
import { WalkinAppointment } from '../models/clinicModels.js';
import { query } from '../config/mysql.js';
import { timeMinutes } from './appointmentSlotService.js';
import { notifyNextQueueTokens } from './queueTurnNotificationService.js';
export const clinicDisplayQueueRepository = { query };

// Read the dashboard's appointment source as well as check-ins. Do not create
// new bookings/tokens during display refresh or guess a clinic for unassigned rows.
export async function clinicDisplayQueue(link, date) {
  const [queue] = await clinicDisplayQueueRepository.query('SELECT id,appointmentId,tokenNumber,status,queuePosition FROM queue_entries WHERE facilityId=? AND doctorId=? AND queueDate=? ORDER BY queuePosition', [link.facility_id, link.doctor_id, date]);
  const entries = new Map(queue.map(row => [String(row.appointmentId || `queue:${row.id}`), { ...row, priority: 'normal' }]));
  const scheduled = link.clinic_id ? await Appointment.find({ counselor: link.doctor_id, clinic_id: link.clinic_id, appointment_date: date })
    .select('patient token_number queue_status status priority appointment_time').lean() : [];
  const walkins = await WalkinAppointment.find({ doctor_id: link.doctor_id, appointment_date: date,
    $or: [{ doctor_clinic_id: link.id }, { facility_id: link.facility_id }, ...(link.clinic_id ? [{ clinic_id: link.clinic_id }] : [])] })
    .select('patient_id token_number appointment_status queue_status queue_entry_id appointment_time').lean();
  for (const row of [...scheduled, ...walkins]) {
    const key = String(row._id), previous = entries.get(key);
    const fallbackPosition = ((timeMinutes(row.appointment_time) ?? 1440) * 10000) + Number(row.token_number ?? 9999);
    const lifecycle = row.status || row.appointment_status;
    let status = ['canceled', 'cancelled', 'rejected'].includes(lifecycle) ? 'cancelled'
      : lifecycle === 'completed' ? 'completed'
      : ['in-progress', 'in_progress', 'in_consultation'].includes(lifecycle) ? 'in_consultation'
      : (row.queue_status && row.queue_status !== 'booked' ? row.queue_status : previous?.status) || 'waiting';
    if (['booked', 'pending', 'confirmed'].includes(status)) status = 'waiting';
    if (status === 'in_progress') status = 'in_consultation';
    if (status === 'canceled') status = 'cancelled';
    entries.set(key, { tokenNumber: previous?.tokenNumber ?? row.token_number ?? null,
      status, priority: row.priority || 'normal', queuePosition: previous?.queuePosition ?? fallbackPosition,
      appointmentId: row._id, patientId: row.patient || row.patient_id || previous?.patientId,
      source: row.patient ? 'online' : 'walkin' });
  }
  const all = [...entries.values()].filter(row => row.status !== 'cancelled');
  const rank = row => row.priority === 'emergency' ? 0 : row.priority === 'urgent' ? 1 : 2;
  const current = all.find(row => row.status === 'in_consultation') || all.find(row => row.status === 'called') || null;
  const waiting = all.filter(row => row !== current && ['waiting', 'called'].includes(row.status))
    .sort((a,b) => Number(b.status === 'called') - Number(a.status === 'called') || rank(a)-rank(b) || a.queuePosition-b.queuePosition);
  return { current,
    waiting: waiting.filter(row => row.tokenNumber !== null), waitingCount: waiting.length,
    completedCount: all.filter(row => row.status === 'completed').length, totalPatients: all.length };
}

export async function notifyClinicDisplayPatients(link, date, queue) {
  return notifyNextQueueTokens(queue.waiting.map(entry => ({
    id: entry.appointmentId || entry.id, source: entry.source || 'queue',
    token: entry.tokenNumber, patientId: entry.patientId,
  })), { doctorId: link.doctor_id, date, clinicId: link.clinic_id || '',
    currentAppointmentId: String(queue.current?.appointmentId || queue.current?.id || '') });
}
