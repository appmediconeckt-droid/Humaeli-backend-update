import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import mongoose from '../src/persistence/mongoose.js';
import { mysqlConfig } from '../src/persistence/mysqlDriver.js';
import { fromRow, readRows } from '../src/persistence/columns.js';
import { contentHash, migrateColumns } from '../scripts/migrate-mysql-columns.js';

const suite = process.env.MYSQL_TEST_DATABASE ? describe : describe.skip;
suite('Migration from document storage to SQL columns', function () {
  this.timeout(60000);
  it('preserves data exactly, archives originals and can be rerun safely', async () => {
    const database = 'humaeli_test_convert_' + Date.now();
    const { database: ignored, connectionLimit, ...config } = mysqlConfig();
    let client = await mysql.createConnection(config);
    await client.query(`CREATE DATABASE \`${database}\``);
    await client.changeUser({ database });
    await client.query('CREATE TABLE users (id VARCHAR(191) PRIMARY KEY, document JSON NOT NULL) ENGINE=InnoDB');
    await client.query('CREATE TABLE `_humaeli_locks` (collection_name VARCHAR(64) PRIMARY KEY) ENGINE=InnoDB');
    await client.query('CREATE TABLE `_humaeli_indexes` (collection_name VARCHAR(64), index_name VARCHAR(191), definition JSON) ENGINE=InnoDB');
    await client.query('CREATE TABLE `_humaeli_columns` (collection_name VARCHAR(64) PRIMARY KEY, definition JSON NOT NULL) ENGINE=InnoDB');
    await client.query('CREATE TABLE legacy_records (id VARCHAR(191) PRIMARY KEY, info_name LONGTEXT, info_count DOUBLE, _sql_state JSON) ENGINE=InnoDB');
    const oldFields = [{ path: '_id', column: 'id', kind: 'objectId' }, { path: 'info.name', column: 'info_name', kind: 'string' }, { path: 'info.count', column: 'info_count', kind: 'number' }];
    await client.execute('INSERT INTO `_humaeli_columns` VALUES (?, ?)', ['legacy_records', JSON.stringify(oldFields)]);
    const legacy = { _id: new mongoose.Types.ObjectId(), info: { name: 'Nested', count: 7 } };
    await client.execute('INSERT INTO legacy_records VALUES (?, ?, ?, ?)', [String(legacy._id), legacy.info.name, legacy.info.count, JSON.stringify({present: ['_id','info.name','info.count'], containers:{},stringReferences:[]})]);
    await client.query("INSERT INTO `_humaeli_locks` VALUES ('users')");
    const documents = [
      { _id: new mongoose.Types.ObjectId(), email: 'migration@example.test', fullName: 'Column migration', walletBalance: 23.45, isActive: true, createdAt: new Date('2024-04-03T01:02:03.456Z'), address: { city: 'Delhi', country: '' }, emailOTP: null, profilePhoto: {}, languages: ['Hindi', 'English'], profileCompleted: false },
      { _id: new mongoose.Types.ObjectId(), email: 'minimal@example.test', fullName: 'Minimal', walletBalance: 0, address: null, legacyOnlyField: { archived: true } },
    ];
    for (const doc of documents) await client.execute('INSERT INTO users VALUES (?, ?)', [String(doc._id), mongoose.mongo.BSON.EJSON.stringify(doc, { relaxed: false })]);
    await client.end();
    const priorDatabase = process.env.MYSQL_DATABASE;
    const run = async () => {
      process.env.MYSQL_DATABASE = database;
      try { return await migrateColumns(); }
      finally { if (priorDatabase === undefined) delete process.env.MYSQL_DATABASE; else process.env.MYSQL_DATABASE = priorDatabase; }
    };
    const result = await run();
    assert.equal(result.verified, true);
    client = await mysql.createConnection({ ...config, database });
    try {
      const [columns] = await client.query('SHOW COLUMNS FROM users');
      assert.equal(columns.length, 70);
      assert(columns.some(column => column.Field === 'fullName')); assert(columns.some(column => column.Field === 'address'));
      assert(!columns.some(column => ['document', '_sql_state', 'address_city', 'legacyOnlyField'].includes(column.Field)));
      const [mapping] = await client.query("SELECT definition FROM `_humaeli_columns` WHERE collection_name='users'");
      const fields = typeof mapping[0].definition === 'string' ? JSON.parse(mapping[0].definition) : mapping[0].definition;
      const rows = await readRows(client, 'users');
      assert.equal(contentHash(rows.map(row => fromRow(row, fields))), contentHash(documents));
      const backup = result.backupDatabase;
      const [backups] = await client.query(`SELECT COUNT(*) AS count FROM \`${backup}\`.users`);
      assert.equal(backups[0].count, 2);
      const [legacyMapping] = await client.query("SELECT definition FROM `_humaeli_columns` WHERE collection_name='legacy_records'");
      const legacyFields = typeof legacyMapping[0].definition === 'string' ? JSON.parse(legacyMapping[0].definition) : legacyMapping[0].definition;
      assert.equal(contentHash((await readRows(client, 'legacy_records')).map(row => fromRow(row, legacyFields))), contentHash([legacy]));
    } finally { await client.end(); }
    const again = await run();
    assert.equal(again.alreadyComplete, true);
  });
});
