import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import storage, { connectMySQL } from '../src/persistence/mongoose.js';
import { mysqlConfig } from '../src/persistence/mysqlDriver.js';

const suite = process.env.MYSQL_TEST_DATABASE ? describe : describe.skip;
suite('MySQL startup with missing imported metadata', function () {
  this.timeout(30000);
  let pool, config, Account;
  const table = 'column_recovery_accounts';
  const id = '507f1f77bcf86cd799439011';
  before(async () => {
    assert.match(process.env.MYSQL_TEST_DATABASE, /^humaeli_test_[a-z0-9_]+$/);
    config = { ...mysqlConfig(), database: process.env.MYSQL_TEST_DATABASE };
    const { database, ...serverConfig } = config;
    pool = mysql.createPool(serverConfig);
    await pool.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
    await pool.end(); pool = mysql.createPool(config);
    Account = storage.models.ColumnRecoveryAccount || storage.model('ColumnRecoveryAccount', new storage.Schema({
      email: String, balance: Number, preferences: storage.Schema.Types.Mixed, addedLater: String,
    }), table);
  });
  beforeEach(async () => {
    await storage.disconnect();
    await pool.query(`DROP TABLE IF EXISTS ${table}`);
    await connectMySQL(config);
    await pool.execute('DELETE FROM _humaeli_columns WHERE collection_name = ?', [table]);
    await pool.execute('DELETE FROM _humaeli_row_state WHERE collection_name = ?', [table]);
  });
  after(async () => {
    await storage.disconnect();
    storage.deleteModel('ColumnRecoveryAccount');
    await pool?.end();
  });

  const importedTable = async () => {
    await pool.query(`CREATE TABLE ${table} (id VARCHAR(191) PRIMARY KEY, email LONGTEXT, balance DOUBLE, preferences LONGTEXT, external_note LONGTEXT)`);
    await pool.execute(`INSERT INTO ${table} VALUES (?, ?, ?, ?, ?)`, [id, 'recovery@example.test', 42.5, '{"language":"Hindi"}', 'preserve this']);
  };
  it('recovers metadata, preserves rows and extra fields, and supports subsequent reads and writes', async () => {
    await importedTable();
    await Account.createCollection();
    let account = await Account.findById(id);
    assert.equal(account.email, 'recovery@example.test');
    assert.equal(account.balance, 42.5);
    assert.deepEqual(account.preferences, { language: 'Hindi' });
    account.balance += 2; account.addedLater = 'saved'; await account.save();
    const [rows] = await pool.query(`SELECT * FROM ${table}`);
    assert.equal(rows.length, 1); assert.equal(rows[0].external_note, 'preserve this');
    assert.equal(rows[0].balance, 44.5); assert.equal(rows[0].addedLater, 'saved');
    await storage.disconnect(); await connectMySQL(config);
    account = await Account.findById(id);
    assert.equal(account.balance, 44.5); assert.equal(account.addedLater, 'saved');
  });
  it('preserves absent/null semantics when row metadata survived the import', async () => {
    await importedTable();
    await pool.execute('INSERT INTO _humaeli_row_state VALUES (?, ?, ?)', [table, id, JSON.stringify({ present: ['_id', 'email', 'balance', 'preferences'], stringReferences: [] })]);
    await Account.createCollection();
    const account = await Account.findById(id).lean();
    assert.equal(Object.hasOwn(account, 'addedLater'), false);
    assert.equal(account.balance, 42.5);
  });
  it('repairs a missing physical column even when its saved mapping already exists', async () => {
    await importedTable(); await Account.createCollection();
    await storage.disconnect();
    await pool.query(`ALTER TABLE ${table} DROP COLUMN addedLater`);
    await connectMySQL(config); await Account.createCollection();
    await Account.updateOne({ _id: id }, { $set: { addedLater: 'repaired' } });
    assert.equal((await Account.findById(id)).addedLater, 'repaired');
  });
  it('fails safely on unrelated layouts without changing rows or saving a guessed mapping', async () => {
    await pool.query(`CREATE TABLE ${table} (id INT PRIMARY KEY, email LONGTEXT)`);
    await pool.query(`INSERT INTO ${table} VALUES (1, 'untouched@example.test')`);
    await assert.rejects(Account.createCollection(), { code: 'MYSQL_SCHEMA_MISMATCH' });
    const [rows] = await pool.query(`SELECT * FROM ${table}`);
    assert.equal(rows[0].email, 'untouched@example.test');
    const [mapping] = await pool.execute('SELECT * FROM _humaeli_columns WHERE collection_name = ?', [table]);
    assert.equal(mapping.length, 0);
  });
});
