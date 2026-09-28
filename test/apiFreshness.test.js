import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { apiFreshness } from '../src/middleware/apiFreshness.js';

describe('API response freshness', () => {
  it('returns a changed value immediately after saving without a cache/304 response', async () => {
    const app = express();
    app.disable('etag');
    app.use(express.json());
    app.use('/api', apiFreshness);
    let value = 'before';
    app.get('/api/example', (_req, res) => res.json({ value }));
    app.post('/api/example', (req, res) => { value = req.body.value; res.json({ value }); });
    const first = await request(app).get('/api/example').expect(200);
    expect(first.headers['cache-control']).to.include('no-store');
    expect(first.headers.etag).to.equal(undefined);
    await request(app).post('/api/example').send({ value: 'after' }).expect(200);
    const after = await request(app).get('/api/example').set('If-None-Match', 'old-etag').expect(200);
    expect(after.body.value).to.equal('after');
  });
});
