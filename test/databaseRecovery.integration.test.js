import 'dotenv/config';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import storage, { connectMySQL } from '../src/persistence/mongoose.js';
import { mysqlConfig } from '../src/persistence/mysqlDriver.js';
import { runDatabaseMigration } from '../src/config/databaseMigration.js';
import { createDatabaseMonitor } from '../src/config/databaseMonitor.js';

const suite = process.env.MYSQL_TEST_DATABASE ? describe : describe.skip;
suite('Real MySQL connection recovery in an isolated database', function () {
  this.timeout(60000);
  let config, admin, created = false, Account;
  before(async () => {
    const database = process.env.MYSQL_TEST_DATABASE;
    assert.match(database, /^humaeli_test_[a-z0-9_]+$/);
    config = { ...mysqlConfig(), database, connectionLimit: 1, maxIdle: 0 };
    const { database: ignored, ...server } = config;
    admin = await mysql.createConnection(server);
    // Never adopt or delete an existing database, even if it has a test prefix.
    await admin.query(`CREATE DATABASE \`${database}\``); created = true;
    await connectMySQL(config);
    Account = storage.models.RecoveryProbe || storage.model('RecoveryProbe', new storage.Schema({ name: String }));
    await Account.createCollection();
  });
  after(async () => {
    await storage.disconnect();
    if (created) await admin.query(`DROP DATABASE \`${config.database}\``);
    await admin?.end();
  });
  it('runs repairs using a dedicated lock connection even with a one-connection model pool, then skips completed repairs', async () => {
    let runs = 0;
    const action = async () => { runs++; await Account.create({ name: 'migration-probe' }); };
    await runDatabaseMigration(config, 'integration-repair-v1', action);
    assert.deepEqual(await runDatabaseMigration(config, 'integration-repair-v1', action), { skipped: true });
    assert.equal(runs, 1);
    assert.equal(await Account.countDocuments({ name: 'migration-probe' }), 1);
  });
  it('recovers a killed pooled connection without duplicating a saved write', async () => {
    const pool = storage.connection.db.pool;
    const client = await pool.getConnection();
    const [[{ id }]] = await client.query('SELECT CONNECTION_ID() AS id');
    client.release();
    assert(Number.isInteger(Number(id)));
    await admin.query(`KILL CONNECTION ${Number(id)}`);
    let healthy = false;
    const monitor = createDatabaseMonitor({
      probe: () => storage.connection.db.command({ ping: 1 }),
      onHealthy: () => { healthy = true; }, onUnavailable: () => { healthy = false; },
    });
    try {
      for (let attempt = 0; attempt < 3 && !healthy; attempt++) await monitor.check();
      assert.equal(healthy, true);
      assert.equal(await Account.countDocuments({ name: 'migration-probe' }), 1);
      const account = await Account.create({ name: 'after-reconnect' });
      assert.equal((await Account.findById(account._id)).name, 'after-reconnect');
    } finally { monitor.stop(); }
  });
  it('skips full scans for nonunique indexes while still detecting duplicates for unique indexes', async () => {
    await Account.create({ name: 'duplicate-name' });
    await Account.create({ name: 'duplicate-name' });
    const collection = storage.connection.db.collection(Account.collection.name);
    const originalRead = collection.read;
    let reads = 0;
    collection.read = function (...args) { reads++; return originalRead.apply(this, args); };
    try {
      await collection.createIndex({ name: 1 }, { name: 'ordinary_name' });
      assert.equal(reads, 0);
      await assert.rejects(collection.createIndex({ name: 1 }, { name: 'unique_name', unique: true }), error => error.code === 11000);
      assert.equal(reads, 1);
    } finally { collection.read = originalRead; }
  });
});
