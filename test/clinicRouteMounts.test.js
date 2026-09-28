import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';

describe('Mounted clinic API paths', () => {
  for (const [method, path] of [
    ['post', '/api/staff'], ['get', '/api/staff'],
    ['post', '/api/clinics'], ['post', '/api/availability/ranges'],
    ['post', '/api/appointments'], ['post', '/api/followups'],
    ['post', '/api/leaves/apply-leave'], ['post', '/api/medications/add-medication'],
    ['post', '/api/doctor-breaks/start'], ['get', '/api/walkin-appointments'],
    ['post', '/api/notifications'], ['post', '/api/notifications/notifications'],
  ]) {
    it(`${method.toUpperCase()} ${path} reaches authentication`, async () => {
      const result = await request(app)[method](path).send({});
      assert.equal(result.status, 401, JSON.stringify(result.body));
    });
  }
});
