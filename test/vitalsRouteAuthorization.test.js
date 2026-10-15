import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import staffRoutes from '../src/routes/staffRoutes.js';
import User from '../src/models/userModel.js';
import Session from '../src/models/sessionModel.js';
import Appointment from '../src/models/appointmentModel.js';
import { todayIST } from '../src/utils/clinicAccess.js';

describe('Vitals route authorization through the staff router', () => {
  let sandbox, app, user, update, originalSecret;
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    originalSecret = process.env.ACCESS_SECRET;
    process.env.ACCESS_SECRET = 'local-vitals-route-test-secret';
    user = { _id: 'staff', role: 'receptionist', assignedDoctor: 'doctor', clinic_id: 'clinic', isActive: true, isOnline: true };
    sandbox.stub(User, 'findById').callsFake(() => Object.assign(Promise.resolve(user), { select: async () => user }));
    sandbox.stub(Session, 'findOne').resolves({ _id: 'session', isActive: true });
    sandbox.stub(Session, 'updateOne').resolves({ matchedCount: 1 });
    sandbox.stub(Appointment, 'findOne').resolves({ appointment_date: todayIST(), status: 'confirmed', queue_status: 'waiting' });
    update = sandbox.stub(Appointment, 'updateOne').resolves({ matchedCount: 1 });
    app = express(); app.use(express.json()); app.use('/api/staff', staffRoutes);
  });
  afterEach(() => {
    sandbox.restore();
    if (originalSecret === undefined) delete process.env.ACCESS_SECRET;
    else process.env.ACCESS_SECRET = originalSecret;
  });
  const url = '/api/staff/appointments/6ad070c6805b0ef076e8971b/vitals';
  const payload = { source: 'online', vitals: { pulse: 75 } };
  const token = () => jwt.sign({ userId: 'staff', sessionId: 'session' }, process.env.ACCESS_SECRET, { expiresIn: '1h' });
  it('allows a receptionist to PATCH vitals before the doctor/admin-only staff management guard', async () => {
    const res = await request(app).patch(url).set('Authorization', `Bearer ${token()}`).send(payload);
    expect(res.status).to.equal(200);
    expect(res.body.vitals).to.include({ pulse: 75, recorded_role: 'receptionist' });
    expect(update.calledOnce).to.equal(true);
  });
  it('rejects unrelated staff roles without writing', async () => {
    user.role = 'billing';
    const res = await request(app).patch(url).set('Authorization', `Bearer ${token()}`).send(payload);
    expect(res.status).to.equal(403);
    expect(update.called).to.equal(false);
  });
  it('requires a valid login', async () => {
    const res = await request(app).patch(url).send(payload);
    expect(res.status).to.equal(401);
    expect(update.called).to.equal(false);
  });
  it('keeps staff management restricted to doctors and admins', async () => {
    const res = await request(app).patch('/api/staff/some-staff').set('Authorization', `Bearer ${token()}`).send({ role: 'doctor' });
    expect(res.status).to.equal(403);
  });
});
