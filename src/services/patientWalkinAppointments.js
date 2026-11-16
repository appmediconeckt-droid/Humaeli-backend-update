import WalkinAppointment from '../models/walkinAppointmentModel.js';
import User from '../models/userModel.js';
import Clinic from '../models/clinicModel.js';
import { normalizeAppointmentLifecycle } from './appointmentLifecycle.js';
import { enrichAppointmentGroups } from './appointmentDelayService.js';

export const walkinPatientId = user => user?.role === 'user' ? user._id || user.id : undefined;

export function patientWalkinView(record, doctor, clinic) {
  const row = normalizeAppointmentLifecycle(record, 'walkin');
  const status = String(row.appointment_status || row.status || 'booked').toLowerCase();
  return { ...row, appointment_type: 'walkin', visitSource: 'walkin',
    patient: row.patient_id, counselor: doctor || { _id: row.doctor_id, fullName: row.doctor_name || 'Doctor', role: 'doctor' },
    clinic_name: clinic?.clinic_name || '', consultationMode: 'Walk-in',
    date: `${String(row.appointment_date).slice(0, 10)}T${String(row.appointment_time || '00:00').slice(0, 5)}:00+05:30`,
    status: ['booked', 'accepted'].includes(status) ? 'confirmed' : status === 'cancelled' ? 'canceled' : status,
  };
}

export async function getPatientWalkinAppointments(userId, dateFilter = {}, statusFilter = {}) {
  const rows = await WalkinAppointment.find({ patient_id: userId }).lean();
  const doctorIds = [...new Set(rows.map(row => row.doctor_id).filter(Boolean))];
  const clinicIds = [...new Set(rows.map(row => row.clinic_id).filter(Boolean))];
  const [doctors, clinics] = await Promise.all([
    doctorIds.length ? User.find({ _id: { $in: doctorIds } }).select('fullName name profilePhoto role accountType specialization qualification').lean() : [],
    clinicIds.length ? Clinic.find({ _id: { $in: clinicIds } }).select('clinic_name').lean() : [],
  ]);
  const doctorMap = new Map(doctors.map(row => [String(row._id), row]));
  const clinicMap = new Map(clinics.map(row => [String(row._id), row]));
  // Enrich native records before adding the online-compatible counselor field.
  const enriched = await enrichAppointmentGroups(rows);
  return enriched.map(row => patientWalkinView(row, doctorMap.get(String(row.doctor_id)), clinicMap.get(String(row.clinic_id))))
    .filter(row => {
      const when = new Date(row.date).getTime();
      if (dateFilter.date?.$gte && when < new Date(dateFilter.date.$gte).getTime()) return false;
      if (dateFilter.date?.$lte && when > new Date(dateFilter.date.$lte).getTime()) return false;
      const status = statusFilter.status;
      return !status || (typeof status === 'string' ? row.status === status : status.$in.includes(row.status));
    });
}
