import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import Session from '../src/models/sessionModel.js';
import Appointment from '../src/models/appointmentModel.js';
import { queueToday } from '../src/utils/queueDate.js';
import clinicQrRoutes from '../src/routes/clinicQrRoutes.js';
import { createClinic } from '../src/controllers/clinicController.js';
import mongoose, { connectMySQL } from '../src/persistence/mongoose.js';
import { mysqlConfig } from '../src/persistence/mysqlDriver.js';
import { getPool } from '../src/config/mysql.js';
import { initQueueTables } from '../src/services/initQueueTables.js';
import User from '../src/models/userModel.js';
import { Clinic, Availability, WalkinAppointment } from '../src/models/clinicModels.js';
import { ensureClinicQr, profileQr, publicDoctor, bookClinicWalkin, resolveWalkin } from '../src/services/clinicQrService.js';

const suite = process.env.QR_MYSQL_TEST === '1' ? describe : describe.skip;
suite('Doctor and clinic QR isolated MySQL integration', function () {
  this.timeout(30000);
  let admin, pool, owned = false, doctorId, clinic, a, b;
  const name = process.env.MYSQL_DATABASE;
  const app = express(); app.use(express.json()); app.use('/api/qr', clinicQrRoutes);
  app.post('/test/create-clinic', (req, res, next) => { req.userId = doctorId; next(); }, createClinic);
  before(async () => {
    assert.match(name, /^humaeli_test_qr_[a-z0-9_]+$/);
    assert.equal(process.env.MYSQL_HOST, '127.0.0.1');
    admin = await mysql.createConnection({ host: '127.0.0.1', user: 'root', password: '' });
    await admin.query(`CREATE DATABASE \`${name}\``); owned = true;
    await connectMySQL(mysqlConfig()); pool = getPool(); await initQueueTables();
    if (process.env.QR_LEGACY_COLLATION_TEST === '1') {
      // Reproduce databases created before explicit QR table collations existed.
      await pool.query('ALTER TABLE doctor_clinic_links CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci');
      await pool.query('ALTER TABLE qr_codes CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
      await pool.query('ALTER TABLE clinic_qr_requests CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci');
      await assert.rejects(pool.query('SELECT l.id FROM doctor_clinic_links l JOIN doctor_facilities m ON m.id=l.mapping_id'), { code: 'ER_CANT_AGGREGATE_2COLLATIONS' });
    }
    for (const model of [User, Clinic, Availability, WalkinAppointment, Appointment]) await model.createCollection();
    doctorId = String(new mongoose.Types.ObjectId());
    await User.collection.insertOne({ _id: new mongoose.Types.ObjectId(doctorId), fullName: 'Dr Amit Kumar', role: 'doctor', accountType: 'doctor', isActive: true, doctorQrCode: 'legacy-image' });
    clinic = await Clinic.create({ doctor_id: doctorId, clinic_name: 'Apollo', location: 'Indore', phone_number: '9876543210' });
    a = await ensureClinicQr(clinic);
    b = await ensureClinicQr(await Clinic.create({ doctor_id: doctorId, clinic_name: 'City', location: 'Palasia', phone_number: '9876543210' }));
  });
  after(async () => {
    await mongoose.disconnect(); if (pool) await pool.end();
    if (admin) { if (owned) await admin.query(`DROP DATABASE \`${name}\``); await admin.end(); }
  });
  const body = n => ({ patientName: 'Patient', phoneNumber: `98765432${String(n).padStart(2,'0')}`, symptoms: 'Fever', requestId: `request_${n}` });
  it('creates distinct stable clinic QRs and preserves the permanent doctor identity', async () => {
    assert.notEqual(a.doctorClinicId, b.doctorClinicId);
    assert.match(a.walkinQrCode, /^data:image\/png;base64,/);
    assert.equal((await ensureClinicQr(clinic)).doctorClinicId, a.doctorClinicId);
    const profile = await profileQr(doctorId);
    assert.ok(profile.profileQrUrl.endsWith(`/doctor/${doctorId}`));
    assert.equal(profile.doctorQrCode, 'legacy-image');
    assert.equal((await publicDoctor(doctorId)).clinics.length, 2);
  });
  it('locks clinic context, isolates queues and atomically persists appointments', async () => {
    await assert.rejects(bookClinicWalkin(a.doctorClinicId, { ...body(1), clinicId: b.clinicId }), /locked/);
    const first = await bookClinicWalkin(a.doctorClinicId, body(1));
    const retry = await bookClinicWalkin(a.doctorClinicId, body(1));
    assert.equal(first.queueEntryId, retry.queueEntryId);
    const other = await bookClinicWalkin(b.doctorClinicId, body(1));
    assert.equal(first.tokenNumber, other.tokenNumber);
    assert.notEqual(first.facilityId, other.facilityId);
    const saved = await WalkinAppointment.findById(first.appointmentId).lean();
    assert.equal(String(saved.clinic_id), a.clinicId);
    assert.equal(saved.queue_entry_id, first.queueEntryId);
    const concurrent = await Promise.all([2,3,4].map(n => bookClinicWalkin(a.doctorClinicId, body(n))));
    assert.equal(new Set(concurrent.map(c => c.tokenNumber)).size, 3);
    assert.equal(await WalkinAppointment.countDocuments({}), 5);
    await assert.rejects(bookClinicWalkin(a.doctorClinicId, { ...body(1), requestId: 'new_request' }), /already checked in/);
  });
  it('exposes safe public pages and protects management codes', async () => {
    const response = await request(app).get(`/api/qr/doctors/${doctorId}/profile`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.clinics.length, 2);
    assert.doesNotMatch(response.text, /password|patientName|phone_number/);
    assert.equal((await request(app).get(`/api/qr/doctors/${doctorId}/codes`)).status, 401);
    assert.equal((await request(app).get(`/api/qr/doctors/${doctorId}/clinics`)).status, 401);
    assert.equal((await request(app).get(`/api/qr/walkin/${a.doctorClinicId}`)).status, 200);
    const booked = await request(app).post(`/api/qr/walkin/${a.doctorClinicId}`).send(body(5));
    assert.equal(booked.status, 201);
    assert.ok(booked.body.data.tokenNumber);
    assert.equal((await request(app).post(`/api/qr/walkin/${a.doctorClinicId}`).send({ ...body(6), doctorId: 'another-doctor' })).status, 400);
  });
  it('shows only the selected clinic queue on its public LED and refreshes status', async () => {
    const first = await request(app).get(`/api/qr/walkin/${a.doctorClinicId}/queue`);
    const second = await request(app).get(`/api/qr/walkin/${b.doctorClinicId}/queue`);
    assert.equal(first.status, 200); assert.equal(second.status, 200);
    assert.equal(first.headers['cache-control'], 'no-store');
    assert.equal(first.body.facility.name, 'Apollo'); assert.equal(second.body.facility.name, 'City');
    assert.equal(first.body.waitingCount, 5); assert.equal(second.body.waitingCount, 1);
    assert.doesNotMatch(first.text, /patientName|patientPhone|987654|symptoms/);
    await pool.query("UPDATE queue_entries SET status='called' WHERE facilityId=? AND queuePosition=1", [a.facilityId]);
    const updated = await request(app).get(`/api/qr/walkin/${a.doctorClinicId}/queue`);
    assert.equal(updated.body.current.token, 'AK001'); assert.equal(updated.body.waitingCount, 4);
    assert.equal((await request(app).get(`/api/qr/walkin/${b.doctorClinicId}/queue`)).body.current, null);
  });
  it('returns clinic-only QR choices and LED paths to the owning doctor', async () => {
    const previous = process.env.ACCESS_SECRET;
    process.env.ACCESS_SECRET = 'isolated-clinic-menu-test';
    try {
      await Session.createCollection();
      await User.updateOne({ _id: doctorId }, { $set: { isOnline: true, lastSeen: null } });
      const session = await Session.create({ userId: doctorId, refreshToken: 'test-clinic-menu', isActive: true });
      const token = jwt.sign({ userId: doctorId, sessionId: String(session._id) }, process.env.ACCESS_SECRET);
      const response = await request(app).get(`/api/qr/doctors/${doctorId}/clinics`).set('Authorization', `Bearer ${token}`);
      assert.equal(response.status, 200);
      assert.equal(response.body.data.clinics.length, 2);
      assert.equal(response.body.data.profileQrCode, undefined);
      for (const clinic of response.body.data.clinics) {
        assert.match(clinic.walkinQrCode, /^data:image\/png;base64,/);
        assert.equal(clinic.ledPath, `/display/clinic/${clinic.doctorClinicId}`);
      }
      const otherDoctor = String(new mongoose.Types.ObjectId());
      assert.equal((await request(app).get(`/api/qr/doctors/${otherDoctor}/clinics`).set('Authorization', `Bearer ${token}`)).status, 403);
      const roomPath = `/api/qr/walkin/${a.doctorClinicId}/room`;
      assert.equal((await request(app).patch(roomPath).send({ roomNumber: '101' })).status, 401);
      assert.equal((await request(app).patch(roomPath).set('Authorization', `Bearer ${token}`).send({ roomNumber: ' ' })).status, 400);
      assert.equal((await request(app).patch(roomPath).set('Authorization', `Bearer ${token}`).send({ roomNumber: ' OPD-101 ' })).status, 200);
      assert.equal((await request(app).get(`/api/qr/walkin/${a.doctorClinicId}/queue`)).body.roomId, 'OPD-101');
      assert.equal((await request(app).get(`/api/qr/walkin/${b.doctorClinicId}/queue`)).body.roomId, null);
      const refreshed = await request(app).get(`/api/qr/doctors/${doctorId}/clinics`).set('Authorization', `Bearer ${token}`);
      assert.equal(refreshed.body.data.clinics.find(c => c.doctorClinicId === a.doctorClinicId).clinic.room, 'OPD-101');
      await User.collection.insertOne({ _id: new mongoose.Types.ObjectId(otherDoctor), role: 'doctor', isActive: true, isOnline: true });
      const otherSession = await Session.create({ userId: otherDoctor, refreshToken: 'other-room-test' });
      const otherToken = jwt.sign({ userId: otherDoctor, sessionId: String(otherSession._id) }, process.env.ACCESS_SECRET);
      assert.equal((await request(app).patch(roomPath).set('Authorization', `Bearer ${otherToken}`).send({ roomNumber: '999' })).status, 403);
    } finally {
      if (previous === undefined) delete process.env.ACCESS_SECRET;
      else process.env.ACCESS_SECRET = previous;
    }
  });
  it('rolls back the appointment if queue insertion fails', async () => {
    const before = await WalkinAppointment.countDocuments({});
    await pool.query("CREATE TRIGGER qr_test_failure BEFORE INSERT ON queue_entries FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test queue failure'");
    try { await assert.rejects(bookClinicWalkin(a.doctorClinicId, body(7)), /test queue failure/); }
    finally { await pool.query('DROP TRIGGER qr_test_failure'); }
    assert.equal(await WalkinAppointment.countDocuments({}), before);
    assert.ok((await bookClinicWalkin(a.doctorClinicId, body(7))).tokenNumber);
  });
  it('returns the generated QR directly when a clinic is added', async () => {
    const response = await request(app).post('/test/create-clinic').send({ doctor_id: doctorId, clinic_name: 'Care Clinic', location: 'Indore', phone_number: '9876543210' });
    assert.equal(response.status, 201);
    assert.equal(response.body.qrType, 'CLINIC_WALKIN');
    assert.match(response.body.walkinQrCode, /^data:image\/png;base64,/);
    assert.equal((await resolveWalkin(response.body.doctorClinicId)).clinic.clinic_name, 'Care Clinic');
  });
  it('includes dashboard appointments, follows their status and excludes other clinics/days', async () => {
    const base = { counselor: new mongoose.Types.ObjectId(doctorId), clinic_id: clinic._id, appointment_date: queueToday(), status: 'confirmed', queue_status: 'waiting' };
    const first = new mongoose.Types.ObjectId(), second = new mongoose.Types.ObjectId();
    const before = (await request(app).get(`/api/qr/walkin/${a.doctorClinicId}/queue`)).body;
    await Appointment.collection.insertMany([
      { ...base, _id: first, token_number: 80 }, { ...base, _id: second, token_number: 81 },
      { ...base, _id: new mongoose.Types.ObjectId(), clinic_id: new mongoose.Types.ObjectId(b.clinicId), token_number: 999 },
      { ...base, _id: new mongoose.Types.ObjectId(), appointment_date: '2000-01-01', token_number: 998 },
      { ...base, _id: new mongoose.Types.ObjectId(), status: 'canceled', token_number: 997 },
    ]);
    let data = (await request(app).get(`/api/qr/walkin/${a.doctorClinicId}/queue`)).body;
    assert.equal(data.waitingCount, before.waitingCount + 2);
    assert.equal(data.totalPatients, before.totalPatients + 2);
    assert.ok(!data.nextTokens.includes(999));
    await Appointment.updateOne({ _id: first }, { $set: { queue_status: 'in_progress' } });
    data = (await request(app).get(`/api/qr/walkin/${a.doctorClinicId}/queue`)).body;
    assert.equal(data.current.token, 80);
    await Appointment.updateOne({ _id: first }, { $set: { queue_status: 'completed', status: 'completed' } });
    data = (await request(app).get(`/api/qr/walkin/${a.doctorClinicId}/queue`)).body;
    assert.equal(data.completedCount, before.completedCount + 1);
    await pool.query("INSERT INTO queue_entries (id,patientName,appointmentId,facilityId,doctorId,tokenNumber,queueDate,queuePosition,status) VALUES ('linked-scheduled','Test patient',?,?,?,?,?,100,'waiting')", [String(second), a.facilityId, doctorId, '81', queueToday()]);
    data = (await request(app).get(`/api/qr/walkin/${a.doctorClinicId}/queue`)).body;
    assert.equal(data.totalPatients, before.totalPatients + 2);
    assert.doesNotMatch(JSON.stringify(data), /patientName|patientPhone|symptoms/);
  });
  it('rejects inactive and deleted clinics', async () => {
    await pool.query('UPDATE doctor_facilities SET isActive=0 WHERE facilityId=?', [b.facilityId]);
    await assert.rejects(resolveWalkin(b.doctorClinicId), /unavailable/);
    assert.equal((await request(app).get(`/api/qr/walkin/${b.doctorClinicId}/queue`)).status, 404);
    await Clinic.deleteOne({ _id: clinic._id });
    await assert.rejects(resolveWalkin(a.doctorClinicId), /unavailable/);
    assert.equal((await request(app).get(`/api/qr/walkin/${a.doctorClinicId}/queue`)).status, 404);
  });
});
