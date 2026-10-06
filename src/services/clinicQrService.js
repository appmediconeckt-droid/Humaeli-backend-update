import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import mongoose from '../persistence/mongoose.js';
import { writeRow } from '../persistence/columns.js';
import { query, getPool } from '../config/mysql.js';
import User from '../models/userModel.js';
import { Clinic, Availability, WalkinAppointment } from '../models/clinicModels.js';
import { fail } from '../utils/clinicAccess.js';
import { queueToday } from '../utils/queueDate.js';
import { withQueueMutex } from './queueMutex.js';
import { doctorProfileUrl, clinicWalkinUrl } from './qrLinks.js';
import { timeMinutes, withAppointmentSlot } from './appointmentSlotService.js';

const id = () => randomBytes(12).toString('hex');
const rows = async (db, sql, params = []) => (await db.query(sql, params))[0];
const one = async (db, sql, params = []) => (await rows(db, sql, params))[0];
export const clinicQrRepository = { query, connection: () => getPool().getConnection() };
const repo = clinicQrRepository;
const safeId = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,191}$/.test(value)) throw fail(400, 'Invalid identifier');
  return value;
};
async function ensureQr(db, type, doctorId, linkId = null) {
  const scope = type === 'DOCTOR_PROFILE' ? `profile:${doctorId}` : `walkin:${linkId}`;
  await db.query(`INSERT INTO qr_codes (id,qr_type,doctor_id,doctor_clinic_id,qr_token,scope_key)
    VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE scope_key=VALUES(scope_key)`, [id(), type, doctorId, linkId, randomBytes(24).toString('hex'), scope]);
  return one(db, 'SELECT * FROM qr_codes WHERE scope_key=?', [scope]);
}
export async function profileQr(doctorId) {
  const doctor = await User.findOne({ _id: safeId(doctorId), role: 'doctor', isActive: true }).select('_id fullName doctorQrCode').lean();
  if (!doctor) throw fail(404, 'Doctor not found');
  const qr = await ensureQr(repo, 'DOCTOR_PROFILE', doctorId);
  if (!qr.is_active) throw fail(410, 'Profile QR is inactive');
  const profileQrUrl = doctorProfileUrl(doctorId);
  return { doctorId, name: doctor.fullName, qrType: 'DOCTOR_PROFILE', profileQrUrl,
    profileQrCode: await QRCode.toDataURL(profileQrUrl, { margin: 4, scale: 6 }),
    doctorQrCode: doctor.doctorQrCode || null };
}
// A legacy Clinic already has one owning doctor. Give that relationship its own
// stable ID and an LED facility mapping, without changing the original clinic ID.
export async function ensureClinicQr(clinic) {
  const clinicId = String(clinic._id || clinic.id), doctorId = String(clinic.doctor_id);
  const source = `clinic:${clinicId}`;
  const connection = await repo.connection();
  let locked = false;
  try {
    const [lock] = await connection.query('SELECT GET_LOCK(?,10) AS acquired', [`clinic-qr:${clinicId}`]);
    locked = Number(lock[0].acquired) === 1;
    if (!locked) throw fail(503, 'Clinic configuration is busy');
    await connection.beginTransaction();
    let link = await one(connection, 'SELECT * FROM doctor_clinic_links WHERE source_key=? FOR UPDATE', [source]);
    if (!link) {
      link = { id: id(), doctor_id: doctorId, clinic_id: clinicId, facility_id: id(), mapping_id: id() };
      await connection.query("INSERT INTO facilities (id,name,type,address) VALUES (?,?,'clinic',?)", [link.facility_id, clinic.clinic_name, JSON.stringify(clinic.location || '')]);
      await connection.query('INSERT INTO doctor_facilities (id,doctorId,facilityId) VALUES (?,?,?)', [link.mapping_id, doctorId, link.facility_id]);
      await connection.query('INSERT INTO doctor_clinic_links (id,doctor_id,clinic_id,facility_id,mapping_id,source_key) VALUES (?,?,?,?,?,?)', [link.id, doctorId, clinicId, link.facility_id, link.mapping_id, source]);
    }
    await connection.query('UPDATE facilities SET name=?, address=? WHERE id=?', [clinic.clinic_name, JSON.stringify(clinic.location || ''), link.facility_id]);
    await ensureQr(connection, 'CLINIC_WALKIN', doctorId, link.id);
    const walkinQrCode = await QRCode.toDataURL(clinicWalkinUrl(link.id));
    await connection.commit();
    return { doctorClinicId: link.id, doctorId, clinicId, facilityId: link.facility_id, qrType: 'CLINIC_WALKIN', walkinQrUrl: clinicWalkinUrl(link.id), walkinQrCode };
  } catch (error) { await connection.rollback(); throw error; }
  finally { try { if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [`clinic-qr:${clinicId}`]); } finally { connection.release(); } }
}
export async function ensureFacilityQr(mapping) {
  const source = `facility:${mapping.id || mapping._id}`;
  const connection = await repo.connection();
  try {
    await connection.beginTransaction();
    await connection.query(`INSERT INTO doctor_clinic_links (id,doctor_id,facility_id,mapping_id,source_key)
      VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`, [id(), String(mapping.doctorId), String(mapping.facilityId), String(mapping.id || mapping._id), source]);
    const link = await one(connection, 'SELECT * FROM doctor_clinic_links WHERE mapping_id=? FOR UPDATE', [String(mapping.id || mapping._id)]);
    await ensureQr(connection, 'CLINIC_WALKIN', link.doctor_id, link.id);
    const walkinQrCode = await QRCode.toDataURL(clinicWalkinUrl(link.id));
    await connection.commit();
    return { doctorClinicId: link.id, doctorId: link.doctor_id, clinicId: link.clinic_id, facilityId: link.facility_id, qrType: 'CLINIC_WALKIN', walkinQrUrl: clinicWalkinUrl(link.id), walkinQrCode };
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}
export async function resolveWalkin(linkId, db = repo, lock = false) {
  // Early QR tables inherited the database collation (e.g. 0900_ai_ci), while
  // queue tables use unicode_ci. CREATE TABLE IF NOT EXISTS cannot upgrade
  // existing tables. Normalize only join operands, preserving stored IDs/data.
  const link = await one(db, `SELECT l.*, m.departmentId, m.roomId, f.name AS facility_name, f.address
    FROM doctor_clinic_links l JOIN qr_codes q ON q.doctor_clinic_id=CONVERT(l.id USING utf8mb4) COLLATE utf8mb4_unicode_ci AND q.qr_type='CLINIC_WALKIN'
    JOIN doctor_facilities m ON m.id=CONVERT(l.mapping_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
      AND m.doctorId=CONVERT(l.doctor_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
      AND m.facilityId=CONVERT(l.facility_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
    JOIN facilities f ON f.id=CONVERT(l.facility_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
    WHERE l.id=? AND l.is_active=1 AND q.is_active=1 AND m.isActive=1 AND f.status='active'${lock ? ' FOR UPDATE' : ''}`, [safeId(linkId)]);
  if (!link) throw fail(404, 'Clinic walk-in QR is unavailable');
  const doctor = await User.findOne({ _id: link.doctor_id, role: 'doctor', isActive: true }).select('fullName specialization qualification experience aboutMe profilePhoto').lean();
  if (!doctor) throw fail(404, 'Doctor is unavailable');
  let clinic;
  if (link.clinic_id) {
    clinic = await Clinic.findOne({ _id: link.clinic_id, doctor_id: link.doctor_id }).lean();
    if (!clinic) throw fail(404, 'Clinic is unavailable');
  }
  const timings = clinic ? await Availability.find({ clinic_id: link.clinic_id, doctor_id: link.doctor_id, is_unavailable: false }).lean() :
    await rows(db, 'SELECT day,startTime,endTime,slotDuration,maxPatients FROM doctor_schedules WHERE facilityId=? AND doctorId=? AND isActive=1', [link.facility_id, link.doctor_id]);
  return { link, doctor, clinic, timings };
}
export function publicWalkin(context) {
  const { link, doctor, clinic, timings } = context;
  return { qrType: 'CLINIC_WALKIN', doctorClinicId: link.id, doctorId: link.doctor_id, clinicId: link.clinic_id,
    facilityId: link.facility_id, doctor: { id: link.doctor_id, name: doctor.fullName, specialization: doctor.specialization },
    clinic: { id: link.clinic_id || link.facility_id, name: clinic?.clinic_name || link.facility_name,
      address: clinic?.location || link.address, room: link.roomId || null },
    timings: timings.map(t => ({ date: t.availability_date || null, weekday: t.weekday ?? t.day,
      startTime: t.start_time || t.startTime, endTime: t.end_time || t.endTime })),
    walkinQrUrl: clinicWalkinUrl(link.id) };
}
export async function doctorClinics(doctorId, includeImages = false) {
  safeId(doctorId);
  const clinics = await Clinic.find({ doctor_id: doctorId }).lean();
  for (const clinic of clinics) await ensureClinicQr(clinic);
  const mappings = await rows(repo, 'SELECT * FROM doctor_facilities WHERE doctorId=? AND isActive=1', [doctorId]);
  for (const mapping of mappings) {
    if (!await one(repo, 'SELECT id FROM doctor_clinic_links WHERE mapping_id=?', [mapping.id])) await ensureFacilityQr(mapping);
  }
  const links = await rows(repo, 'SELECT id FROM doctor_clinic_links WHERE doctor_id=? AND is_active=1', [doctorId]);
  const result = [];
  for (const link of links) {
    try {
      const item = publicWalkin(await resolveWalkin(link.id));
      if (includeImages) item.walkinQrCode = await QRCode.toDataURL(item.walkinQrUrl, { margin: 4, scale: 6 });
      result.push(item);
    }
    catch (error) { if (error.statusCode !== 404) throw error; }
  }
  return result;
}
export async function publicDoctor(doctorId) {
  const doctor = await User.findOne({ _id: safeId(doctorId), role: 'doctor', isActive: true }).select('fullName qualification specialization experience aboutMe profilePhoto').lean();
  if (!doctor) throw fail(404, 'Doctor not found');
  const qr = await ensureQr(repo, 'DOCTOR_PROFILE', doctorId);
  if (!qr.is_active) throw fail(410, 'Profile QR is inactive');
  return { doctorId, name: doctor.fullName, qualification: doctor.qualification,
    specialization: doctor.specialization, experience: doctor.experience, about: doctor.aboutMe,
    profilePhoto: doctor.profilePhoto, qrType: 'DOCTOR_PROFILE', profileQrUrl: doctorProfileUrl(doctorId), clinics: await doctorClinics(doctorId) };
}
export async function bookClinicWalkin(linkId, body) {
  const first = await resolveWalkin(linkId);
  // The URL is authoritative; reject attempts to change its doctor/clinic.
  const expected = { doctorId: first.link.doctor_id, doctor_id: first.link.doctor_id,
    clinicId: first.link.clinic_id || first.link.facility_id, clinic_id: first.link.clinic_id || first.link.facility_id,
    facilityId: first.link.facility_id, facility_id: first.link.facility_id, doctorClinicId: linkId };
  for (const [key, value] of Object.entries(expected)) if (body[key] !== undefined && String(body[key]) !== String(value)) throw fail(400, 'The doctor and clinic are locked by this QR');
  const name = String(body.patientName || '').trim(), phone = String(body.phoneNumber || '').replace(/[\s()-]/g, '');
  const symptoms = String(body.symptoms || '').trim();
  if (!name || name.length > 150 || !/^\+?\d{7,15}$/.test(phone) || !symptoms || symptoms.length > 2000) throw fail(400, 'Name, valid phone number and symptoms are required');
  if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(body.requestId)) throw fail(400, 'A valid requestId is required');
  const date = queueToday();
  if (body.appointmentDate && body.appointmentDate !== date) throw fail(400, 'Clinic walk-in is available for today only');
  const requestedTime = body.appointmentTime ?? body.appointment_time ?? null;
  const currentTime = new Intl.DateTimeFormat('en-GB', { timeZone: process.env.QUEUE_TIMEZONE || 'Asia/Kolkata', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).format(new Date());
  const earliestTime = requestedTime ? null : timeMinutes(currentTime);
  const storage = mongoose.connection.db;
  if (!storage) throw fail(503, 'Database is not ready');
  const table = WalkinAppointment.collection.name;
  await WalkinAppointment.createCollection();
  const [previousRows] = await query(`SELECT e.* FROM clinic_qr_requests r JOIN queue_entries e ON e.id=CONVERT(r.queue_entry_id USING utf8mb4) COLLATE utf8mb4_unicode_ci WHERE r.doctor_clinic_id=? AND r.request_id=?`, [linkId, body.requestId]);
  const result = previousRows[0] || await withAppointmentSlot({
    doctorId: first.link.doctor_id,
    date,
    time: requestedTime,
    clinicId: first.link.clinic_id || undefined,
    earliestTime,
  }, slot => withQueueMutex(first.link.facility_id, first.link.doctor_id, date, async connection => {
    try {
      await connection.beginTransaction();
      const { link } = await resolveWalkin(linkId, connection, true);
      const previous = await one(connection, `SELECT e.* FROM clinic_qr_requests r JOIN queue_entries e ON e.id=CONVERT(r.queue_entry_id USING utf8mb4) COLLATE utf8mb4_unicode_ci WHERE r.doctor_clinic_id=? AND r.request_id=?`, [linkId, body.requestId]);
      if (previous) { await connection.commit(); return previous; }
      const active = await one(connection, "SELECT id FROM queue_entries WHERE facilityId=? AND doctorId=? AND queueDate=? AND patientPhone=? AND status IN ('waiting','called','in_consultation')", [link.facility_id, link.doctor_id, date, phone]);
      if (active) throw fail(409, 'This patient is already checked in at this clinic today');
      const token = String(slot.token), entryId = id();
      const position = (slot.minutes * 10000) + slot.token;
      const appointment = new WalkinAppointment({ doctor_id: link.doctor_id, clinic_id: link.clinic_id || undefined,
        doctor_clinic_id: link.id, facility_id: link.facility_id, queue_entry_id: entryId,
        patient_name: name, phone_number: phone, symptoms, appointment_date: date,
        appointment_time: slot.time,
        token_number: slot.token, booking_source: 'qr', createdAt: new Date(), updatedAt: new Date() });
      await appointment.validate();
      // Respect the existing model adapter's write lock and row-state metadata.
      await connection.query('SELECT collection_name FROM _humaeli_locks WHERE collection_name=? FOR UPDATE', [table]);
      await writeRow(connection, table, storage.columns.get(table), appointment.toObject());
      await connection.query(`INSERT INTO queue_entries (id,appointmentId,patientName,patientPhone,facilityId,departmentId,doctorId,roomId,tokenNumber,queueDate,queuePosition,status,bookingSource)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'waiting','qr')`, [entryId, String(appointment._id), name, phone, link.facility_id, link.departmentId || null, link.doctor_id, link.roomId || null, token, date, position]);
      await connection.query('INSERT INTO clinic_qr_requests VALUES (?,?,?,?)', [linkId, body.requestId, String(appointment._id), entryId]);
      const entry = await one(connection, 'SELECT * FROM queue_entries WHERE id=?', [entryId]);
      await connection.commit(); return entry;
    } catch (error) { await connection.rollback(); throw error; }
  }));
  // No patient data in the public confirmation or event.
  const response = { appointmentId: result.appointmentId, queueEntryId: result.id, doctorClinicId: linkId,
    doctorId: result.doctorId, facilityId: result.facilityId, clinicId: first.link.clinic_id,
    tokenNumber: result.tokenNumber, queueDate: result.queueDate, status: result.status, room: result.roomId };
  global.io?.to(`doctor:${result.doctorId}`).emit('queueUpdated', response);
  global.io?.to(`facility:${result.facilityId}`).emit('queueUpdated', response);
  return response;
}
