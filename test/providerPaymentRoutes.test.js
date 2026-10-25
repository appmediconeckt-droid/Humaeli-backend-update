import { expect } from 'chai';
import request from 'supertest';
import { app } from '../src/app.js';

describe('Payment route authentication', () => {
  for (const [method, path] of [
    ['get', '/api/payments/preferences'],
    ['put', '/api/payments/preferences'],
    ['get', '/api/payments/providers/provider/methods'],
    ['post', '/api/payments/appointments/appointment/order'],
    ['post', '/api/payments/appointments/appointment/verify'],
    ['post', '/api/payments/appointments/appointment/reconcile'],
  ]) {
    it(`protects ${method.toUpperCase()} ${path}`, async () => {
      const response = await request(app)[method](path).send({});
      expect(response.status).to.equal(401);
      expect(response.body).not.to.have.property('bankAccount');
    });
  }
});
