import assert from 'node:assert/strict';
import sinon from 'sinon';
import mysql from 'mysql2/promise';
import storage, { connectMySQL } from '../src/persistence/mongoose.js';
import { mysqlConfig } from '../src/persistence/mysqlDriver.js';
import { fromRow, toRow } from '../src/persistence/columns.js';

describe('MySQL model connection', () => {
  it('keeps scalar JSON encoded for the storage decoder', () => {
    assert.equal(mysqlConfig({}).jsonStrings, true);
    const fields = [{ path: 'permanentAddress', column: 'permanentAddress', kind: 'json' }];
    for (const value of ['Test street Indore', '', '123', 'null', '{"city":"Delhi"}', { city: 'Delhi' }]) {
      assert.deepEqual(fromRow(toRow({ permanentAddress: value }, fields), fields), { permanentAddress: value });
    }
  });
  afterEach(async () => {
    await storage.disconnect();
    sinon.restore();
  });

  it('opens a mysql2 pool with mapped credentials, probes it, and releases it on failure', async () => {
    const config = mysqlConfig({
      MYSQL_HOST: 'mysql.test.internal', MYSQL_PORT: '3307',
      MYSQL_USER: 'test_user', MYSQL_PASSWORD: 'test_password',
      MYSQL_DATABASE: 'humaeli_test_connection',
    });
    const refused = Object.assign(new Error('test connection refused'), { code: 'ECONNREFUSED' });
    const pool = { query: sinon.stub().rejects(refused), end: sinon.stub().resolves() };
    const createPool = sinon.stub(mysql, 'createPool').returns(pool);

    await assert.rejects(connectMySQL(config), { code: 'ECONNREFUSED' });
    sinon.assert.calledOnceWithExactly(createPool, config);
    sinon.assert.calledOnceWithExactly(pool.query, 'SELECT 1');
    sinon.assert.calledOnce(pool.end);
    assert.equal(storage.connection.readyState, 0);
  });
});
