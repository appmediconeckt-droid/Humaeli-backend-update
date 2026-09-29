import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import { getPool } from '../src/config/mysql.js';
import { initQueueTables } from '../src/services/initQueueTables.js';
import displayRoutes from '../src/routes/displayRoutes.js';
import facilityRoutes from '../src/routes/facilityRoutes.js';
import queueRoutes from '../src/routes/queueRoutes.js';
import { queueToday } from '../src/utils/queueDate.js';

const suite = process.env.LED_MYSQL_TEST === '1' ? describe : describe.skip;
suite('LED display isolated MySQL integration', function () {
  this.timeout(30000);
  let admin, pool, owned = false;
  const name = process.env.MYSQL_DATABASE;
  const app = express(); app.use(express.json());
  app.use('/api/displays', displayRoutes); app.use('/api/facilities', facilityRoutes); app.use('/api/queue', queueRoutes);
  before(async () => {
    assert.match(name, /^humaeli_test_led_[a-z0-9_]+$/);
    assert.equal(process.env.MYSQL_HOST, '127.0.0.1');
    admin = await mysql.createConnection({ host: '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: 'root', password: '' });
    await admin.query(`CREATE DATABASE \`${name}\``); owned = true;
    pool = getPool(); await initQueueTables(); await initQueueTables();
    await pool.query('CREATE TABLE users (id VARCHAR(191) PRIMARY KEY, fullName VARCHAR(100), specialization VARCHAR(100))');
    await pool.query("INSERT INTO users VALUES ('doc1','Dr Amit','Cardiology'),('doc2','Dr Neha','General')");
    await pool.query("INSERT INTO facilities (id,name) VALUES ('f1','Test hospital')");
    await pool.query("INSERT INTO departments (id,facilityId,name,code,floor) VALUES ('dep1','f1','Cardiology','CARD','1')");
    await pool.query("INSERT INTO doctor_facilities (id,doctorId,facilityId,departmentId,roomId) VALUES ('m1','doc1','f1','dep1','101'),('m2','doc2','f1','dep1','102')");
    await pool.query("INSERT INTO displays (id,facilityId,name,displayType,doctorId,departmentId,floor) VALUES ('tv1','f1','Amit TV','doctor','doc1',NULL,NULL),('tv2','f1','Hospital TV','hospital',NULL,NULL,NULL),('tv3','f1','Department TV','department',NULL,'dep1',NULL),('tv4','f1','Floor TV','floor',NULL,NULL,'1')");
    for (const [i,status] of ['completed','called','waiting','waiting'].entries()) {
      await pool.query('INSERT INTO queue_entries (id,patientName,patientPhone,facilityId,doctorId,tokenNumber,queueDate,queuePosition,status) VALUES (?,?,?,?,?,?,?,?,?)', [`q${i}`, 'PRIVATE PATIENT', 'PRIVATE PHONE', 'f1','doc1',`AM-00${i+1}`,queueToday(),i+1,status]);
    }
    await pool.query('INSERT INTO queue_entries (id,patientName,facilityId,doctorId,tokenNumber,queueDate,queuePosition) VALUES (?,?,?,?,?,?,?)', ['other','PRIVATE','f1','doc2','NN-001',queueToday(),1]);
  });
  after(async () => {
    if (pool) await pool.end();
    if (admin) { if (owned) await admin.query(`DROP DATABASE \`${name}\``); await admin.end(); }
  });
  it('shows only the configured doctor, with current/next tokens, room and accurate counts', async () => {
    const response = await request(app).get('/api/displays/tv1/queue');
    assert.equal(response.status,200); assert.equal(response.headers['cache-control'],'no-store');
    assert.equal(response.body.doctor.name,'Dr Amit'); assert.equal(response.body.roomId,'101');
    assert.equal(response.body.current.token,'AM-002'); assert.deepEqual(response.body.nextTokens,['AM-003','AM-004']);
    assert.equal(response.body.waitingCount,2); assert.equal(response.body.completedCount,1); assert.equal(response.body.totalPatients,4);
    assert.doesNotMatch(response.text,/PRIVATE|patientName|patientPhone|NN-001/);
  });
  it('returns new queue state on the next refresh', async () => {
    await pool.query("UPDATE queue_entries SET status='completed' WHERE id='q1'");
    await pool.query("UPDATE queue_entries SET status='called' WHERE id='q2'");
    const { body } = await request(app).get('/api/displays/tv1/queue');
    assert.equal(body.current.token,'AM-003'); assert.equal(body.waitingCount,1);
  });
  it('supports department, floor and hospital views', async () => {
    for (const id of ['tv2','tv3','tv4']) {
      const response = await request(app).get(`/api/displays/${id}/queue`);
      assert.equal(response.status,200); assert.match(response.text,/Dr Amit/); assert.match(response.text,/Dr Neha/);
      assert.doesNotMatch(response.text,/PRIVATE|patientPhone|patientName/);
    }
  });
  it('rejects missing/inactive displays and protects configuration endpoints', async () => {
    assert.equal((await request(app).get('/api/displays/missing/queue')).status,404);
    await pool.query("UPDATE displays SET isActive=0 WHERE id='tv1'");
    assert.equal((await request(app).get('/api/displays/tv1/queue')).status,403);
    assert.equal((await request(app).post('/api/displays').send({})).status,401);
  });
});
