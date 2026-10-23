import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import routes from '../src/routes/appointmentRoutes.js';
import Appointment from '../src/models/appointmentModel.js';
import { Clinic } from '../src/models/clinicModels.js';
import User from '../src/models/userModel.js';
import Session from '../src/models/sessionModel.js';

describe('Doctor rating summary routing', () => {
  const app = express();
  app.use('/api/appointments', routes);
  let token;
  beforeEach(() => {
    const doctor = { _id: '507f1f77bcf86cd799439011', role: 'doctor', isActive: true, isOnline: true };
    token = jwt.sign({ userId: doctor._id, sessionId: 'test-session' }, process.env.ACCESS_SECRET || 'route-test-secret');
    sinon.stub(jwt, 'verify').returns({ userId: doctor._id, sessionId: 'test-session' });
    sinon.stub(User, 'findById').resolves(doctor);
    sinon.stub(Session, 'findOne').resolves({ _id: 'test-session', isActive: true });
    sinon.stub(Session, 'updateOne').resolves({});
    sinon.stub(Appointment, 'find').returns({ select() { return this; }, populate() { return this; }, lean: async () => [] });
    sinon.stub(Clinic, 'find').returns({ select() { return this; }, populate() { return this; }, lean: async () => [] });
    sinon.stub(Appointment, 'findOne');
  });
  afterEach(() => sinon.restore());
  for (const path of ['/doctor/ratings-summary', '/doctor-ratings-summary']) {
    it(`serves ${path} without treating the URL as an appointment ID`, async () => {
      const response = await request(app).get(`/api/appointments${path}`).auth(token, { type: 'bearer' });
      expect(response.status).to.equal(200);
      expect(response.body).to.include({ rating: 0, ratingCount: 0 });
      expect(Appointment.findOne.called).to.equal(false);
    });
  }
  it('rejects a malformed appointment ID before querying the database', async () => {
    const response = await request(app).get('/api/appointments/not-an-id').auth(token, { type: 'bearer' });
    expect(response.status).to.equal(400);
    expect(response.body.message).to.equal('Invalid appointment ID');
    expect(Appointment.findOne.called).to.equal(false);
  });
});
