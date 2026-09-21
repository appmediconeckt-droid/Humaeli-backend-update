import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose, { connectMySQL } from '../src/persistence/mongoose.js';
import { mysqlConfig } from '../src/persistence/mysqlDriver.js';
import { loadModels } from '../src/persistence/models.js';
import User from '../src/models/userModel.js';
import Session from '../src/models/sessionModel.js';
import Appointment from '../src/models/appointmentModel.js';
import { Clinic, Availability, AppointmentSlot, WalkinAppointment, FollowUp, Leave, Medication, DoctorBreak, DoctorAnalyticsEvent } from '../src/models/clinicModels.js';
import staffRoutes from '../src/routes/staffRoutes.js';
import clinicRoutes from '../src/routes/clinicRoutes.js';
import availabilityRoutes from '../src/routes/availabilityRoutes.js';
import appointmentRoutes from '../src/routes/appointmentRoutes.js';
import walkinRoutes from '../src/routes/walkinAppointmentRoutes.js';
import followupRoutes from '../src/routes/followupRoutes.js';
import leaveRoutes from '../src/routes/leaveRoutes.js';
import medicationRoutes from '../src/routes/medicationRoutes.js';
import breakRoutes from '../src/routes/doctorBreakRoutes.js';
import { nextAppointmentToken } from '../src/services/appointmentTokenService.js';
import { recordDoctorAnalyticsEvent, getDoctorQuickStats } from '../src/services/doctorAnalyticsService.js';

// A new, isolated database is created for each opt-in run. No application rows are touched.
const suite = process.env.CLINIC_MYSQL_TEST === '1' ? describe : describe.skip;
suite('Clinic features on actual MySQL storage', function () {
  this.timeout(60000);
  const app = express();
  app.use(express.json(), cookieParser());
  for (const [path, router] of Object.entries({ staff: staffRoutes, clinics: clinicRoutes, availability: availabilityRoutes,
    appointments: appointmentRoutes, walkins: walkinRoutes, followups: followupRoutes, leaves: leaveRoutes,
    medications: medicationRoutes, breaks: breakRoutes })) app.use('/' + path, router);
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: err.message }));
  let server, database, doctor, other, patient, staff, clinicId, token, otherToken, patientToken, staffToken;
  let oldAccess, oldRefresh;
  const auth = (method, path, body, bearer = token) => {
    let r = request(app)[method](path).set('Authorization', 'Bearer ' + bearer);
    return body ? r.send(body) : r;
  };
  const loginToken = async user => {
    const session = await Session.create({ userId: user._id, refreshToken: 'test-' + user._id, isActive: true });
    return jwt.sign({ userId: String(user._id), sessionId: String(session._id), role: user.role }, process.env.ACCESS_SECRET, { expiresIn: '1h' });
  };
  before(async function () {
    this.timeout(180000);
    oldAccess = process.env.ACCESS_SECRET; oldRefresh = process.env.REFRESH_SECRET;
    process.env.ACCESS_SECRET = 'clinic-integration-secret'; process.env.REFRESH_SECRET = 'clinic-refresh-secret';
    await loadModels();
    const { database: ignored, ...config } = mysqlConfig();
    server = await mysql.createConnection(config);
    database = 'humaeli_test_clinic_' + Date.now();
    assert.match(database, /^humaeli_test_clinic_\d+$/);
    await server.query('CREATE DATABASE `' + database + '`');
    console.log('Created isolated clinic test database');
    await connectMySQL({ ...config, database });
    const featureCollections = ['users', 'sessions', 'appointments', 'clinics', 'date_ranges', 'unavailable_dates',
      'walkin_appointments', 'follow_ups', 'leaves', 'medications', 'doctor_breaks', 'doctor_analytics_events',
      'appointment_counters', 'appointment_slots', 'notifications', 'notificationtokens'];
    for (const model of Object.values(mongoose.models).filter(m => featureCollections.includes(m.collection.name))) {
      await model.createCollection(); await model.createIndexes();
    }
    console.log('Clinic test schema initialized');
    const base = { password: 'unused-test-hash', isActive: true, isOnline: true, profileCompleted: true };
    doctor = await User.create({ ...base, fullName: 'Doctor One', email: 'doctor@test.example', phoneNumber: '9100000001', role: 'doctor', accountType: 'doctor', qualification: 'MBBS', specialization: ['Medicine'], experience: 1, location: 'City' });
    other = await User.create({ ...base, fullName: 'Doctor Two', email: 'other@test.example', phoneNumber: '9100000002', role: 'doctor', qualification: 'MBBS', specialization: ['Medicine'], experience: 1, location: 'City' });
    patient = await User.create({ ...base, fullName: 'Patient', email: 'patient@test.example', phoneNumber: '9100000003', role: 'user' });
    token = await loginToken(doctor); otherToken = await loginToken(other); patientToken = await loginToken(patient);
  });
  after(async () => {
    await mongoose.disconnect();
    if (server && database) { assert.match(database, /^humaeli_test_clinic_\d+$/); await server.query('DROP DATABASE `' + database + '`'); }
    await server?.end();
    if (oldAccess === undefined) delete process.env.ACCESS_SECRET; else process.env.ACCESS_SECRET = oldAccess;
    if (oldRefresh === undefined) delete process.env.REFRESH_SECRET; else process.env.REFRESH_SECRET = oldRefresh;
  });
  it('creates all feature tables in MySQL with string user IDs', async () => {
    const [rows] = await server.execute('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [database]);
    const tables = rows.map(r => r.TABLE_NAME);
    for (const name of ['clinics', 'date_ranges', 'unavailable_dates', 'walkin_appointments', 'follow_ups', 'leaves', 'medications', 'doctor_breaks', 'doctor_analytics_events', 'appointment_counters', 'appointment_slots']) assert.ok(tables.includes(name), name);
  });
  it('adds staff with persisted assignment, protects other doctors, and excludes secrets', async () => {
    const r = await auth('post', '/staff', { fullName: 'Nurse', email: 'nurse@test.example', phoneNumber: '9100000004', password: 'StrongTest1!', role: 'nurse', staff_id: 'N-1', nursing_license: 'L-1' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.user.password, undefined);
    staff = await User.findById(r.body.user._id);
    assert.equal(String(staff.assignedDoctor), String(doctor._id)); assert.equal(staff.staffId, 'N-1');
    staffToken = await loginToken(staff);
    assert.equal((await auth('patch', '/staff/' + staff._id, { department: 'No' }, otherToken)).status, 404);
    assert.equal((await auth('patch', '/staff/' + staff._id, { department: 'Ward' })).status, 200);
    assert.equal((await auth('get', '/staff', null, otherToken)).body.data.length, 0);
  });
  it('creates a clinic, persists changes and rejects unauthenticated or cross-doctor writes', async () => {
    const r = await auth('post', '/clinics', { clinic_name: 'Clinic', phone_number: '9100000000', location: 'City' });
    assert.equal(r.status, 201, JSON.stringify(r.body)); clinicId = r.body.clinicId;
    assert.equal((await Clinic.findById(clinicId)).clinic_name, 'Clinic');
    assert.equal((await request(app).patch('/clinics/' + clinicId).send({ clinic_name: 'Bad' })).status, 401);
    assert.equal((await auth('patch', '/clinics/' + clinicId, { clinic_name: 'Bad' }, otherToken)).status, 403);
    assert.equal((await auth('patch', '/clinics/' + clinicId, { clinic_name: 'Updated' })).status, 200);
  });
  it('creates dated availability, rejects invalid dates, and scopes unavailable dates', async () => {
    const payload = { clinic_id: clinicId, date: '2099-01-12', start_time: '09:00', end_time: '11:00', slot_duration: 15 };
    const r = await auth('post', '/availability/ranges', payload);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await Availability.findById(r.body.rangeId)).slot_duration, 15);
    assert.equal((await auth('post', '/availability/ranges', { ...payload, date: '2099-02-31' })).status, 400);
    assert.equal((await auth('post', '/availability/ranges', payload, otherToken)).status, 403);
    assert.equal((await auth('post', '/availability/unavailable', { date: '2099-01-13' })).status, 200);
    assert.equal((await auth('get', '/availability/ranges', null, otherToken)).body.unavailableDates.length, 0);
    const publicSchedule = await request(app).get('/availability/available').query({ doctor_id: String(doctor._id) });
    assert.equal(publicSchedule.status, 200, JSON.stringify(publicSchedule.body));
    assert.equal(publicSchedule.body.availableRanges.length, 1);
  });
  let appointmentId;
  it('books a real patient appointment, checks availability and rejects duplicate slots', async () => {
    const payload = { counselorId: String(doctor._id), date: '2099-01-12T09:00:00+05:30', clinic_id: clinicId };
    const r = await auth('post', '/appointments', payload, patientToken);
    assert.equal(r.status, 201, JSON.stringify(r.body)); appointmentId = r.body._id;
    const saved = await Appointment.findById(appointmentId);
    assert.equal(String(saved.patient), String(patient._id)); assert.equal(saved.token_number, 1);
    assert.equal(await AppointmentSlot.countDocuments({}), 0);
    assert.equal((await auth('post', '/appointments', payload, patientToken)).status, 409);
    assert.equal((await auth('post', '/appointments', { ...payload, date: '2099-01-12T12:00:00+05:30' }, patientToken)).status, 409);
    assert.equal((await auth('post', '/appointments', { ...payload, date: '2099-01-12T09:00:01+05:30' }, patientToken)).status, 409);
    assert.equal((await auth('patch', '/appointments/' + appointmentId + '/check-in', { pulse: 75 }, staffToken)).status, 200);
    assert.equal((await Appointment.findById(appointmentId)).vitals.pulse, 75);
  });
  it('allocates unique tokens across concurrent requests', async () => {
    const values = await Promise.all(Array.from({ length: 6 }, () => nextAppointmentToken(doctor._id, '2099-01-12')));
    assert.equal(new Set(values).size, 6);
  });
  it('allows an assigned nurse to book for a patient and rejects another doctor clinic', async () => {
    const body = { doctor_id: String(doctor._id), patient_id: String(patient._id), clinic_id: clinicId,
      appointment_date: '2099-01-12', appointment_time: '09:15' };
    const r = await auth('post', '/appointments', body, staffToken);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(String((await Appointment.findById(r.body._id)).patient), String(patient._id));
    assert.equal((await auth('post', '/appointments', body, otherToken)).status, 403);
  });
  let walkinId;
  it('saves public walk-in intake without creating or modifying login accounts', async () => {
    const count = await User.countDocuments({});
    const r = await request(app).post('/walkins').send({ doctor_id: String(doctor._id), patient_name: 'Walk-in', phone_number: '9100000003', symptoms: 'Headache', date_of_birth: '2000-01-01', booking_source: 'qr' });
    assert.equal(r.status, 201, JSON.stringify(r.body)); walkinId = r.body.id;
    assert.equal(await User.countDocuments({}), count);
    assert.equal((await WalkinAppointment.findById(walkinId)).booking_source, 'qr');
    assert.equal((await auth('get', '/walkins/' + walkinId, null, otherToken)).status, 404);
    assert.equal((await auth('patch', '/walkins/' + walkinId, { follow_up_required: true, follow_up_date: '2099-01-15' })).status, 200);
    assert.equal(await FollowUp.countDocuments({ walkin_id: walkinId }), 1);
    await auth('patch', '/walkins/' + walkinId, { follow_up_required: true, follow_up_date: '2099-01-16' });
    assert.equal(await FollowUp.countDocuments({ walkin_id: walkinId }), 1);
  });
  const intake = (time, phone = '9100000003') => ({ doctor_id: String(doctor._id), patient_name: 'Patient',
    phone_number: phone, symptoms: 'Review', appointment_date: '2099-02-01', appointment_time: time });
  const walk = body => request(app).post('/walkins').send(body);
  it('serializes simultaneous identical walk-ins and returns a saved token', async () => {
    const responses = await Promise.all([walk(intake('10:00')), walk(intake('10:00:35', '+919100000003'))]);
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409], JSON.stringify(responses.map(r => r.body)));
    const saved = responses.find(r => r.status === 201);
    assert.equal(saved.body.token_number, (await WalkinAppointment.findById(saved.body.id)).token_number);
    assert.equal(responses.find(r => r.status === 409).body.code, 'DUPLICATE_APPOINTMENT');
    assert.equal(await WalkinAppointment.countDocuments({ doctor_id: doctor._id, appointment_date: '2099-02-01', appointment_time: '10:00:00' }), 1);
    assert.equal((await walk(intake('10:00', '9100000099'))).status, 201);
    assert.equal((await walk({ ...intake('10:00'), doctor_id: String(other._id) })).status, 201);
  });
  it('prevents cross-API duplicates concurrently and in either creation order', async () => {
    const online = time => auth('post', '/appointments', { doctor_id: String(doctor._id),
      appointment_date: '2099-02-01', appointment_time: time }, patientToken);
    const results = await Promise.all([online('11:00'), walk(intake('11:00'))]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409], JSON.stringify(results.map(r => r.body)));
    assert.equal((await online('11:15')).status, 201);
    assert.equal((await walk(intake('11:15', '+919100000003'))).status, 409);
    assert.equal((await walk(intake('11:30'))).status, 201);
    assert.equal((await online('11:30')).status, 409);
    const duplicates = await Promise.all([online('11:45'), online('11:45')]);
    assert.deepEqual(duplicates.map(r => r.status).sort(), [201, 409]);
  });
  it('releases failed saves and permits rebooking after cancellation but prevents reactivation duplicates', async () => {
    assert.equal((await walk({ ...intake('12:00'), gender: 'invalid' })).status, 400);
    const first = await walk(intake('12:00'));
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal((await auth('patch', '/walkins/' + first.body.id, { status: 'cancelled' })).status, 200);
    assert.equal((await walk(intake('12:00'))).status, 201);
    assert.equal((await auth('patch', '/walkins/' + first.body.id, { status: 'booked' })).status, 409);
    assert.equal((await walk({ ...intake('12:15'), appointment_date: '2099-02-31' })).status, 400);
    assert.equal((await walk(intake('25:00'))).status, 400);
  });
  it('persists follow-up CRUD with doctor ownership', async () => {
    const r = await auth('post', '/followups', { patient_id: String(patient._id), appointment_id: appointmentId, follow_up_date: '2099-01-17', type: 'review' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await auth('get', '/followups/' + r.body.id, null, otherToken)).status, 404);
    assert.equal((await auth('put', '/followups/' + r.body.id, { status: 'completed' })).status, 200);
    assert.equal((await FollowUp.findById(r.body.id)).status, 'completed');
    assert.equal((await auth('delete', '/followups/' + r.body.id)).status, 200);
  });
  it('stores leave under the authenticated staff member and only their doctor can approve', async () => {
    const r = await auth('post', '/leaves/apply-leave', { user_id: String(other._id), leave_type: 'personal', start_date: '2099-01-17', end_date: '2099-01-18', reason: 'Personal' }, staffToken);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(String((await Leave.findById(r.body.data.id)).user_id), String(staff._id));
    const path = '/leaves/update-leave-status/' + r.body.data.id;
    assert.equal((await auth('put', path, { status: 'approved' }, staffToken)).status, 403);
    assert.equal((await auth('put', path, { status: 'approved' }, otherToken)).status, 404);
    assert.equal((await auth('put', path, { status: 'approved' })).status, 200);
  });
  it('persists medication and prevents cross-clinic updates', async () => {
    const r = await auth('post', '/medications/add-medication', { medication_name: 'Test', dose: 'Test', timing: 'Test', route: 'Test', patient_name: 'Patient', room_number: '1' }, staffToken);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const path = '/medications/update-status/' + r.body.data.id;
    assert.equal((await auth('patch', path, { status: 'given' }, otherToken)).status, 404);
    assert.equal((await auth('patch', path, { status: 'invalid' }, staffToken)).status, 400);
    assert.equal((await auth('patch', path, { status: 'given' }, staffToken)).status, 200);
    assert.equal((await Medication.findById(r.body.data.id)).status, 'given');
  });
  it('persists breaks, rejects concurrent active breaks and records analytics', async () => {
    const r = await auth('post', '/breaks/start', { duration_minutes: 15 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await auth('post', '/breaks/start', { duration_minutes: 10 })).status, 409);
    assert.equal((await auth('patch', '/breaks/' + r.body.break.id + '/end')).status, 200);
    assert.equal((await DoctorBreak.findById(r.body.break.id)).status, 'ended');
    await recordDoctorAnalyticsEvent({ doctorId: doctor._id, eventType: 'qr_scan' });
    const stats = await getDoctorQuickStats(doctor._id);
    assert.equal(stats.qrScans, 1); assert.equal(stats.qrAppointments, 1);
    assert.equal(await DoctorAnalyticsEvent.countDocuments({ doctor_id: doctor._id }), 1);
  });
  it('deactivates staff and revokes their authenticated access', async () => {
    assert.equal((await auth('delete', '/staff/' + staff._id)).status, 200);
    assert.equal((await User.findById(staff._id)).isActive, false);
    assert.equal((await auth('get', '/medications/medications', null, staffToken)).status, 401);
  });
});
