import Appointment from '../models/appointmentModel.js';
import { FollowUp, WalkinAppointment } from '../models/clinicModels.js';
import { dateOnly } from '../utils/clinicAccess.js';

export function appointmentFollowUp(record) {
  const row = record.toObject ? record.toObject() : record;
  let details = {};
  try { const notes = JSON.parse(row.notes); if (notes?.__doctorConsultation === 1) details = notes.details || {}; } catch {}
  const data = { ...row, ...details };
  const required = data.follow_up_required ?? data.followUpRequired;
  const date = data.follow_up_date || data.followUpDate;
  if (![true, 1, '1', 'true'].includes(required) || !date) return null;
  const instant = date instanceof Date ? date : String(date).includes('T') ? new Date(date) : null;
  const day = instant
    ? new Date(instant.getTime() + 19800000).toISOString().slice(0, 10) : String(date).slice(0, 10);
  return { day: dateOnly(day), data };
}

export async function syncAppointmentFollowUp(record, source = 'online', insertOnly = false) {
  const follow = appointmentFollowUp(record);
  if (!follow) return;
  const { data, day } = follow;
  const walkin = source === 'walkin';
  const ref = walkin ? { walkin_id: data._id || data.id } : { appointment_id: data._id || data.id };
  const values = { doctor_id: walkin ? data.doctor_id : data.counselor,
    patient_id: walkin ? data.patient_id : data.patient, patient_name: data.patient_name,
    follow_up_date: new Date(day + 'T00:00:00+05:30'), reason: data.diagnosis || '',
    notes: data.additional_notes || data.advice || '',
  };
  for (const key of Object.keys(values)) if (values[key] === undefined) delete values[key];
  await FollowUp.findOneAndUpdate(ref, insertOnly ? { $setOnInsert: { ...ref, ...values } } : { $set: values },
    { upsert: true, returnDocument: 'after', runValidators: true });
  await (walkin ? WalkinAppointment : Appointment).updateOne({ _id: data._id || data.id }, { $set: { follow_up_synced: true } });
}

export async function recoverAppointmentFollowUps(doctorId) {
  const [online, walkins] = await Promise.all([
    Appointment.find({ counselor: doctorId, status: 'completed', follow_up_synced: { $ne: true } }).lean(),
    WalkinAppointment.find({ doctor_id: doctorId, appointment_status: 'completed', follow_up_required: true, follow_up_synced: { $ne: true } }).lean(),
  ]);
  for (const row of online) await syncAppointmentFollowUp(row, 'online', true);
  for (const row of walkins) await syncAppointmentFollowUp(row, 'walkin', true);
}
