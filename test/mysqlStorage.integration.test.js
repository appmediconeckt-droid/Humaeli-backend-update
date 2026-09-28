import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import mysql from 'mysql2/promise';
import mongoose from '../src/persistence/mongoose.js';
import { mysqlConfig } from '../src/persistence/mysqlDriver.js';
import { loadModels } from '../src/persistence/models.js';

// Opt-in: never connect to or clear the user's application database in npm test.
const suite = process.env.MYSQL_TEST_DATABASE ? describe : describe.skip;
suite('MySQL storage integration', function () {
  this.timeout(30000);
  let Account, Entry, pool;
  before(async () => {
    const database = process.env.MYSQL_TEST_DATABASE;
    assert.match(database, /^humaeli_test_[a-z0-9_]+$/);
    const config = { ...mysqlConfig(), database };
    const { database: ignored, connectionLimit, ...serverConfig } = config;
    pool = await mysql.createConnection(serverConfig);
    await pool.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
    await mongoose.connect('mysql://test', { mysql: config });
    const schema = new mongoose.Schema({
      email: { type: String, unique: true, required: true },
      phone: String, balance: { type: Number, default: 0 },
      password: { type: String, select: false },
      nested: { state: String }, items: [{ name: String, value: Number }],
      tags: [String], expiresAt: Date,
    }, { timestamps: true });
    schema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } });
    schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    Account = mongoose.models.SQLTestAccount || mongoose.model('SQLTestAccount', schema);
    Entry = mongoose.models.SQLTestEntry || mongoose.model('SQLTestEntry', new mongoose.Schema({ owner: { type: mongoose.Schema.Types.ObjectId, ref: 'SQLTestAccount' }, amount: Number }));
    await loadModels();
    for (const model of Object.values(mongoose.models)) { await model.createCollection(); await model.createIndexes(); }
  });
  beforeEach(async () => { await Account.deleteMany({}); await Entry.deleteMany({}); });
  after(async () => { await mongoose.disconnect(); await pool?.end(); });
  it('preserves schema defaults, validation, IDs, dates, projections and populated references', async () => {
    await assert.rejects(Account.create({}), /required/);
    const account = await Account.create({ email: 'a@example.test', password: 'hidden' });
    assert.equal(account.balance, 0);
    const entry = await Entry.create({ owner: account._id, amount: 3 });
    const populated = await Entry.findById(entry._id).populate('owner');
    assert.equal(populated.owner.email, account.email);
    const plain = await Account.findById(account._id).lean();
    assert(plain._id.equals(account._id)); assert(plain.createdAt instanceof Date);
    assert.equal(plain.password, undefined);
    assert.equal((await Account.findById(account._id).select('+password')).password, 'hidden');
    account.balance = 7; await account.save();
    assert.equal((await Account.findById(account._id)).balance, 7);
  });
  it('enforces partial uniqueness and prevents concurrent overdrafts', async () => {
    const account = await Account.create({ email: 'a', balance: 10 });
    await Account.create({ email: 'b' });
    const inserts = await Promise.allSettled([Account.create({ email: 'c', phone: '123' }), Account.create({ email: 'd', phone: '123' })]);
    assert.equal(inserts.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(inserts.find(item => item.status === 'rejected').reason.code, 11000);
    const debits = await Promise.all(Array.from({ length: 8 }, () => Account.updateOne({ _id: account._id, balance: { $gte: 3 } }, { $inc: { balance: -3 } })));
    assert.equal(debits.reduce((sum, item) => sum + item.modifiedCount, 0), 3);
    assert.equal((await Account.findById(account._id)).balance, 1);
  });
  it('supports upserts, return metadata, arrays, positional updates and pipeline updates', async () => {
    const first = await Account.findOneAndUpdate({ email: 'upsert' }, { $set: { balance: 4 }, $setOnInsert: { phone: '1' } }, { upsert: true, returnDocument: 'after', includeResultMetadata: true });
    assert.equal(first.value.balance, 4); assert.equal(first.lastErrorObject.updatedExisting, false);
    await Account.updateOne({ email: 'upsert' }, { $setOnInsert: { phone: '2' }, $push: { items: { name: 'x', value: 1 } }, $addToSet: { tags: 'hello' } }, { upsert: true });
    await Account.updateOne({ email: 'upsert', 'items.name': 'x' }, { $inc: { 'items.$.value': 2 } });
    await Account.collection.updateOne({ email: 'upsert' }, [{ $set: { balance: { $add: ['$balance', 2] } } }]);
    const doc = await Account.findOne({ email: 'upsert' });
    assert.equal(doc.phone, '1'); assert.equal(doc.items[0].value, 3); assert.equal(doc.balance, 6);
    assert.deepEqual(await Account.distinct('tags'), ['hello']);
    const before = await Account.findOneAndDelete({ email: 'upsert' });
    assert.equal(before.email, 'upsert'); assert.equal(await Account.countDocuments(), 0);
  });
  it('supports aggregation joins, dates, regex, sorting and cursor iteration', async () => {
    const account = await Account.create({ email: 'Alice' });
    await Entry.create([{ owner: account._id, amount: 2 }, { owner: account._id, amount: 5 }]);
    const result = await Entry.aggregate([{ $match: { owner: account._id } }, { $group: { _id: '$owner', total: { $sum: '$amount' } } }, { $lookup: { from: Account.collection.name, localField: '_id', foreignField: '_id', as: 'account' } }, { $unwind: '$account' }]);
    assert.equal(result[0].total, 7); assert.equal(result[0].account.email, 'Alice');
    assert.equal(await Account.countDocuments({ email: /^ali/i, createdAt: { $lte: new Date() } }), 1);
    const ids = []; for await (const doc of Account.find().lean().cursor()) ids.push(String(doc._id));
    assert.deepEqual(ids, [String(account._id)]);
  });
  it('expires OTP-style records and persists across reconnects', async () => {
    await Account.create({ email: 'expired', expiresAt: new Date(Date.now() - 1000) });
    const live = await Account.create({ email: 'live', expiresAt: new Date(Date.now() + 60000) });
    assert.equal(await Account.countDocuments(), 1);
    const config = { ...mysqlConfig(), database: process.env.MYSQL_TEST_DATABASE };
    await mongoose.disconnect(); await mongoose.connect('mysql://test', { mysql: config });
    assert.equal((await Account.findById(live._id)).email, 'live');
  });
  it('rolls back uniqueness conflicts and handles bulk operations', async () => {
    const first = await Account.create({ email: 'first', balance: 2 });
    await Account.create({ email: 'second', balance: 5 });
    await assert.rejects(Account.updateMany({}, { $set: { email: 'duplicate' } }), error => error.code === 11000);
    assert.deepEqual(await Account.distinct('email'), ['first', 'second']);
    const result = await Account.bulkWrite([
      { updateOne: { filter: { _id: first._id }, update: { $inc: { balance: 1 } } } },
      { deleteOne: { filter: { email: 'second' } } },
    ]);
    assert.equal(result.modifiedCount, 1); assert.equal(result.deletedCount, 1);
    assert.equal((await Account.findById(first._id)).balance, 3);
  });
  it('resumes imports only while target records still match the saved baseline', async () => {
    const collection = mongoose.connection.db.collection(Account.collection.name);
    const id = new mongoose.Types.ObjectId();
    const original = { _id: id, email: 'imported', balance: 5 };
    const equal = isDeepStrictEqual;
    await collection.importDocuments([original], equal);
    assert.equal((await collection.importDocuments([original], equal)).skipped, 1);
    const baseline = new Map([[String(id), original]]);
    await collection.importDocuments([{ ...original, balance: 6 }], equal, baseline);
    assert.equal((await Account.findById(id)).balance, 6);
    await assert.rejects(collection.importDocuments([{ ...original, balance: 7 }], equal, baseline), /conflict/);
    assert.equal((await Account.findById(id)).balance, 6);
    const current = { ...original, balance: 6 };
    const removed = await collection.importDocuments([], equal, new Map([[String(id), current]]));
    assert.equal(removed.removed, 1); assert.equal(await Account.countDocuments(), 0);
  });
  it('stores exactly the top-level schema columns, with SQL edits visible to model reads', async () => {
    const account = await Account.create({ email: 'columns', balance: 12.5, nested: { state: 'ready' }, tags: ['one', 'two'] });
    const db = mongoose.connection.db.pool;
    const [columns] = await db.query(`SHOW COLUMNS FROM \`${Account.collection.name}\``);
    const names = columns.map(column => column.Field);
    const expected = [...new Set(Object.keys(Account.schema.paths).map(path => path.split('.')[0] === '_id' ? 'id' : path.split('.')[0]))];
    assert.deepEqual([...names].sort(), expected.sort());
    const [rows] = await db.execute(`SELECT email, balance, nested, tags FROM \`${Account.collection.name}\` WHERE id = ?`, [String(account._id)]);
    assert.equal(rows[0].email, 'columns'); assert.equal(rows[0].balance, 12.5);
    assert.equal((typeof rows[0].nested === 'string' ? JSON.parse(rows[0].nested) : rows[0].nested).state, 'ready');
    assert.deepEqual(typeof rows[0].tags === 'string' ? JSON.parse(rows[0].tags) : rows[0].tags, ['one', 'two']);
    await db.execute(`UPDATE \`${Account.collection.name}\` SET balance = ?, nested = JSON_SET(nested, '$.state', ?) WHERE id = ?`, [15, 'updated', String(account._id)]);
    const loaded = await Account.findById(account._id);
    assert.equal(loaded.balance, 15); assert.equal(loaded.nested.state, 'updated');
  });
});
