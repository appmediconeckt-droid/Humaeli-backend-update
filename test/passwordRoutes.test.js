import { describe, it } from 'mocha';
import request from 'supertest';
import { expect } from 'chai';
import { app } from '../src/app.js';

describe('Password endpoints (basic smoke tests)', function () {
  this.timeout(10000);

  it('POST /api/auth/set-password-by-otp -> 400 when email not verified', async () => {
    const res = await request(app)
      .post('/api/auth/set-password-by-otp')
      .send({ email: 'noone@example.com', password: 'NewPass123' })
      .set('Accept', 'application/json');

    expect(res.status).to.equal(400);
    expect(res.body).to.have.property('success', false);
    expect(res.body).to.have.property('message');
  });

  it('POST /api/auth/setPassword -> 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/auth/setPassword')
      .send({ password: 'NewPass123' })
      .set('Accept', 'application/json');

    expect(res.status).to.equal(401);
    expect(res.body).to.have.property('success', false);
  });

  it('POST /api/auth/changePassword -> 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/auth/changePassword')
      .send({ oldPassword: 'x', newPassword: 'y' })
      .set('Accept', 'application/json');

    expect(res.status).to.equal(401);
    expect(res.body).to.have.property('success', false);
  });

  it('DELETE /api/auth/delete -> 401 when unauthenticated', async () => {
    const res = await request(app)
      .delete('/api/auth/delete')
      .set('Accept', 'application/json');

    expect(res.status).to.equal(401);
    expect(res.body).to.have.property('success', false);
  });
});
