import { createRequire } from 'node:module';
import { BSON } from 'bson';
import { ObjectId, parseStoredValue } from './storageValues.js';
import mysql from 'mysql2/promise';
import { Query, aggregate, updateMany } from 'mingo';
import { buildColumns, tableDDL, fromRow, writeRow, addSqlIndex, sqlType, quote, collectionSchema, sqlPrefilter, initializeRowState, readRows } from './columns.js';
import { recoverColumnMapping } from './columnMapping.js';

const require = createRequire(import.meta.url);
const BaseConnection = require('mongoose/lib/connection');
const MongooseCollection = require('mongoose/lib/collection');
function plain(value) {
  if (value?.$__ && typeof value.toObject === 'function') return plain(value.toObject({ transform: false, depopulate: true }));
  if (Array.isArray(value)) return Array.from(value, plain);
  if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof RegExp) && !value._bsontype && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, plain(item)]));
  }
  return value;
}
const encode = value => BSON.EJSON.stringify(plain(value), { relaxed: false });
const decode = parseStoredValue;
const clone = value => decode(encode(value));
const queryOptions = { scriptEnabled: false };

function identifier(name) {
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(name)) throw new Error(`Invalid MySQL identifier: ${name}`);
  return '`' + name + '`';
}

export function mysqlConfig(env = process.env) {
  let url;
  const hasExplicitConfig = Boolean(
    env.MYSQL_URL ||
      env.MYSQL_HOST ||
      env.MYSQLHOST ||
      env.MYSQL_PORT ||
      env.MYSQLPORT ||
      env.MYSQL_USER ||
      env.MYSQLUSER ||
      env.MYSQL_PASSWORD ||
      env.MYSQLPASSWORD ||
      env.MYSQL_DATABASE ||
      env.MYSQLDATABASE,
  );
  if (env.NODE_ENV === 'production' && !hasExplicitConfig) {
    throw new Error('Missing MySQL configuration. Set MYSQL_URL or Railway MYSQLHOST, MYSQLPORT, MYSQLUSER, MYSQLPASSWORD and MYSQLDATABASE variables.');
  }
  if (env.MYSQL_URL) {
    try {
      url = new URL(env.MYSQL_URL);
      if (url.protocol !== 'mysql:') throw new Error();
    } catch {
      throw new Error('Invalid MYSQL_URL; expected mysql://user:password@host:port/database');
    }
  }
  const config = {
    host: env.MYSQL_HOST || env.MYSQLHOST || url?.hostname || '127.0.0.1',
    port: Number(env.MYSQL_PORT || env.MYSQLPORT || url?.port || 3306),
    user: env.MYSQL_USER || env.MYSQLUSER || (url && decodeURIComponent(url.username)) || 'root',
    password: env.MYSQL_PASSWORD ?? env.MYSQLPASSWORD ?? (url ? decodeURIComponent(url.password) : ''),
    database: env.MYSQL_DATABASE || env.MYSQLDATABASE || (url && decodeURIComponent(url.pathname.slice(1))) || 'humaeli',
    connectionLimit: Number(env.MYSQL_CONNECTION_LIMIT || 10),
    connectTimeout: 10000,
    charset: 'utf8mb4',
    // fromRow decodes EJSON itself. Keep JSON strings encoded so a scalar
    // address is not parsed twice (and strings like "123" retain their type).
    jsonStrings: true,
    timezone: 'Z',
    multipleStatements: false,
  };
  identifier(config.database);
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Invalid MYSQL_PORT');
  if (!Number.isInteger(config.connectionLimit) || config.connectionLimit < 1) throw new Error('Invalid MYSQL_CONNECTION_LIMIT');
  if (env.MYSQL_SSL === 'true') config.ssl = { rejectUnauthorized: true };
  return config;
}

// A cursor is intentionally lazy: native collection callers and Mongoose both
// expect find()/aggregate() to return a cursor rather than a promise of an array.
class Cursor {
  constructor(load, options = {}) { this.load = load; this.options = { ...options }; this.position = 0; }
  sort(value) { this.options.sort = value; return this; }
  skip(value) { this.options.skip = value; return this; }
  limit(value) { this.options.limit = value; return this; }
  project(value) { this.options.projection = value; return this; }
  batchSize() { return this; }
  async toArray() {
    if (!this.result) this.result = this.load().then(docs => {
      let cursor = new Query({}, queryOptions).find(docs);
      if (this.options.sort) cursor = cursor.sort(this.options.sort);
      if (this.options.skip) cursor = cursor.skip(this.options.skip);
      if (this.options.limit) cursor = cursor.limit(Math.abs(this.options.limit));
      const result = cursor.all();
      return this.options.projection && Object.keys(this.options.projection).length
        ? new Query({}, queryOptions).find(result, this.options.projection).all()
        : result;
    });
    return this.result;
  }
  async next() { return (await this.toArray())[this.position++] ?? null; }
  async close() { this.result = Promise.resolve([]); }
  async *[Symbol.asyncIterator]() { let doc; while ((doc = await this.next()) !== null) yield doc; }
}

function duplicate(index, document) {
  const error = new Error(`Duplicate key for unique index ${index.name}`);
  error.code = 11000;
  error.keyPattern = index.key;
  error.keyValue = Object.fromEntries(Object.keys(index.key).map(key => [key, getPath(document, key)]));
  return error;
}
function getPath(document, path) { return path.split('.').reduce((value, key) => value?.[key], document); }
function sameKey(left, right) { return encode(left) === encode(right); }
function canRefreshIndexDefinition(existing, definition) {
  if (!existing || existing.name !== definition.name || !sameKey(existing.key, definition.key)) return false;
  if (!existing.unique || !definition.unique) return false;
  const withoutPartial = ({ partialFilterExpression, ...rest }) => rest;
  return encode(withoutPartial(existing)) === encode(withoutPartial(definition));
}

function mergeColumnDefinitions(current, required) {
  const merged = [...current.map(field => ({ ...field }))];
  const byPath = new Map(merged.map(field => [field.path, field]));
  for (const field of required) {
    if (byPath.has(field.path)) {
      Object.assign(byPath.get(field.path), field);
    } else {
      merged.push(field);
    }
  }
  return merged;
}

function checkUnique(documents, indexes) {
  for (const index of indexes.filter(index => index.unique)) {
    const seen = new Set();
    const fields = Object.keys(index.key);

    const partial =
      index.partialFilterExpression &&
      new Query(index.partialFilterExpression, queryOptions);

    for (const doc of documents) {
      const values = fields.map(key => getPath(doc, key));

      // ---------------------------------------------------------
      // IMPORTANT:
      // MySQL UNIQUE columns allow multiple NULL values.
      //
      // Our document-compatible layer must therefore ignore documents
      // where an indexed value is missing/null when the index is
      // sparse or partial.
      // ---------------------------------------------------------
      if (
        values.some(
          value =>
            value === null ||
            value === undefined
        )
      ) {
        if (index.sparse || index.partialFilterExpression) {
          continue;
        }
      }

      // Apply partial index condition.
      if (partial && !partial.test(doc)) {
        continue;
      }

      // Extra protection for {$type: "string"} partial indexes.
      // Only actual non-empty string values participate in the
      // unique phone/google style indexes.
      if (index.partialFilterExpression) {
        let matchesPartialTypes = true;

        for (const field of fields) {
          const rule = index.partialFilterExpression?.[field];
          const value = getPath(doc, field);

          if (rule?.$type === "string") {
            if (typeof value !== "string" || value.trim() === "") {
              matchesPartialTypes = false;
              break;
            }
          }
        }

        if (!matchesPartialTypes) {
          continue;
        }
      }

      if (index.sparse && values.every(value => value == null)) {
        continue;
      }

      if (values.some(Array.isArray)) {
        throw new Error(
          `Multikey unique index is unsupported: ${index.name}`
        );
      }

      const key = encode(values);

      if (seen.has(key)) {
        throw duplicate(index, doc);
      }

      seen.add(key);
    }
  }
}

class SQLCollection {
  constructor(db, name) { this.db = db; this.name = name; this.table = identifier(name); }
  async ready() { await this.db.ensureTable(this.name); }
  async indexes(client = this.db.pool) {
    await this.ready();
    const [rows] = await client.execute('SELECT definition FROM `_humaeli_indexes` WHERE collection_name = ?', [this.name]);
    return [{ name: '_id_', key: { _id: 1 }, unique: true }, ...rows.map(row => decode(row.definition))];
  }
  listIndexes() { return new Cursor(() => this.indexes()); }
  async read(client = this.db.pool, indexes, includeExpired = false, filter = {}) {
    await this.ready();
    const predicate = sqlPrefilter(filter, this.db.columns.get(this.name));
    const rows = await readRows(client, this.name, predicate);
    const docs = rows.map(row => fromRow(row, this.db.columns.get(this.name), { collection: this.name }));
    if (includeExpired) return docs;
    const ttl = (indexes || await this.indexes(client)).filter(index => index.expireAfterSeconds !== undefined);
    const now = Date.now();
    return docs.filter(doc => !ttl.some(index => {
      const value = getPath(doc, Object.keys(index.key)[0]);
      const dates = Array.isArray(value) ? value : [value];
      return dates.some(date => date instanceof Date && date.getTime() + Number(index.expireAfterSeconds) * 1000 <= now);
    }));
  }
  find(filter = {}, options = {}) {
    return new Cursor(async () => new Query(filter, { ...queryOptions, collation: options.collation }).find(await this.read(undefined, undefined, false, options.collation ? {} : filter)).all(), options);
  }
  async findOne(filter = {}, options = {}) { return this.find(filter, { ...options, limit: 1 }).next(); }
  async countDocuments(filter = {}) { return (await this.find(filter).toArray()).length; }
  async estimatedDocumentCount() { return this.countDocuments(); }
  async distinct(field, filter = {}) {
    const docs = await this.find(filter).toArray();
    return aggregate(docs, [{ $unwind: { path: '$' + field, preserveNullAndEmptyArrays: false } }, { $group: { _id: '$' + field } }], queryOptions).map(doc => doc._id);
  }
  aggregate(pipeline = [], options = {}) {
    return new Cursor(async () => {
      if (pipeline.some(stage => stage.$out || stage.$merge)) throw new Error('Writing aggregation stages are unsupported');
      const collections = new Map();
      const collect = async value => {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
          const from = key === '$lookup' || key === '$graphLookup' ? child.from : key === '$unionWith' ? (typeof child === 'string' ? child : child.coll) : null;
          if (from && !collections.has(from)) collections.set(from, await this.db.collection(from).read());
          await collect(child);
        }
      };
      await collect(pipeline);
      return aggregate(await this.read(undefined, undefined, false, options.collation ? {} : pipeline[0]?.$match || {}), pipeline, { ...queryOptions, collation: options.collation, collectionResolver: name => {
        if (!collections.has(name)) throw new Error(`Unresolved collection ${name}`);
        return collections.get(name);
      } });
    });
  }
  // The collection mutex row is locked before loading documents. This makes
  // filter + update, unique validation and persistence atomic across processes.
  async mutate(action, { includeExpired = false } = {}) {
    await this.ready();
    const client = await this.db.pool.getConnection();
    try {
      await client.beginTransaction();
      await client.execute('SELECT collection_name FROM `_humaeli_locks` WHERE collection_name = ? FOR UPDATE', [this.name]);
      const indexes = await this.indexes(client);
      const docs = await this.read(client, indexes, includeExpired);
      const before = new Map(docs.map(doc => [String(doc._id), encode(doc)]));
      const result = await action(docs);
      checkUnique(docs, indexes);
      const after = new Set();
      for (const doc of docs) {
        const id = String(doc._id);
        after.add(id);
        const serialized = encode(doc);
        if (before.get(id) !== serialized) {
          await writeRow(client, this.name, this.db.columns.get(this.name), doc);
        }
      }
      for (const id of before.keys()) if (!after.has(id)) {
        await client.execute(`DELETE FROM ${this.table} WHERE id = ?`, [id]);
        await client.execute('DELETE FROM `_humaeli_row_state` WHERE collection_name = ? AND row_id = ?', [this.name, id]);
      }
      // Expired records are hidden on reads and physically removed on writes.
      const [stored] = await client.query(`SELECT id FROM ${this.table}`);
      for (const { id } of stored) if (!after.has(id)) {
        await client.execute(`DELETE FROM ${this.table} WHERE id = ?`, [id]);
        await client.execute('DELETE FROM `_humaeli_row_state` WHERE collection_name = ? AND row_id = ?', [this.name, id]);
      }
      await client.commit();
      return result;
    } catch (error) { await client.rollback(); throw error; }
    finally { client.release(); }
  }
  async insertOne(document) {
    const doc = clone(document);
    doc._id ??= new ObjectId();
    await this.db.ensureColumns(this.name, [doc]);
    return this.mutate(docs => { docs.push(doc); return { acknowledged: true, insertedId: doc._id }; });
  }
  // Used only by the offline importer, preserving expired records for an exact
  // audit. Application reads still hide them according to the schema TTL.
  async importDocuments(documents, equal, baseline = new Map()) {
    await this.db.ensureColumns(this.name, documents.map(plain));
    return this.mutate(docs => {
      const existing = new Map(docs.map(doc => [String(doc._id), doc]));
      let inserted = 0, skipped = 0, refreshed = 0, removed = 0;
      const sourceIds = new Set(documents.map(doc => String(doc._id)));
      for (const [id, prior] of baseline) {
        if (!sourceIds.has(id) && existing.has(id)) {
          if (!equal(existing.get(id), prior)) throw new Error(`Import deletion conflict in ${this.name} at ID ${id}`);
          docs.splice(docs.indexOf(existing.get(id)), 1); existing.delete(id); removed++;
        }
      }
      for (const source of documents) {
        const id = String(source._id);
        if (existing.has(id)) {
          if (!equal(existing.get(id), source)) {
            if (!baseline.has(id) || !equal(existing.get(id), baseline.get(id))) throw new Error(`Import conflict in ${this.name} at ID ${id}; target was not overwritten`);
            const next = clone(source);
            docs[docs.indexOf(existing.get(id))] = next; existing.set(id, next); refreshed++;
          } else skipped++;
        } else { const doc = clone(source); docs.push(doc); existing.set(id, doc); inserted++; }
      }
      return { inserted, skipped, refreshed, removed };
    }, { includeExpired: true });
  }
  async insertMany(documents, options = {}) {
    const insertedIds = {};
    const writeErrors = [];
    for (const [index, doc] of documents.entries()) {
      try { insertedIds[index] = (await this.insertOne(doc)).insertedId; }
      catch (error) { writeErrors.push({ index, code: error.code, errmsg: error.message, err: error }); if (options.ordered !== false) break; }
    }
    if (writeErrors.length) {
      const error = new Error('One or more inserts failed');
      Object.assign(error, { code: writeErrors[0].code, writeErrors, insertedIds, insertedDocs: documents.filter((_, i) => i in insertedIds), result: { insertedIds, insertedCount: Object.keys(insertedIds).length } });
      throw error;
    }
    return { acknowledged: true, insertedCount: documents.length, insertedIds };
  }
  async insert(documents, options = {}) { return Array.isArray(documents) ? this.insertMany(documents, options) : this.insertOne(documents, options); }
  async save(document) { return this.replaceOne({ _id: document._id }, document, { upsert: true }); }
  async modify(filter, update, options = {}, many = false, replacement = false) {
    return this.mutate(docs => {
      let matched = new Query(filter, { ...queryOptions, collation: options.collation }).find(docs);
      if (options.sort) matched = matched.sort(options.sort);
      let targets = matched.all();
      if (!many) targets = targets.slice(0, 1);
      const matchedCount = targets.length;
      const old = targets[0] ? clone(targets[0]) : null;
      let upsertedId = null;
      if (!targets.length && options.upsert) {
        const seed = {};
        for (const [key, value] of Object.entries(filter)) {
          if (key.startsWith('$')) continue;
          if (value && typeof value === 'object' && !(value instanceof Date) && !value._bsontype && !(value instanceof RegExp)) {
            if ('$eq' in value) updateMany([seed], {}, { $set: { [key]: value.$eq } });
          } else updateMany([seed], {}, { $set: { [key]: value } });
        }
        seed._id ??= new ObjectId();
        upsertedId = seed._id;
        docs.push(seed); targets = [seed];
      }
      let modifiedCount = 0;
      let current = null;
      for (const target of targets) {
        const initial = encode(target);
        let next;
        if (replacement) next = { ...clone(update), _id: update._id ?? target._id };
        else {
          const modifier = clone(update);
          if (!Array.isArray(modifier)) {
            if (upsertedId && modifier.$setOnInsert) updateMany([target], {}, { $set: modifier.$setOnInsert });
            delete modifier.$setOnInsert;
          }
          const items = [target];
          updateMany(items, upsertedId ? {} : filter, modifier, { arrayFilters: options.arrayFilters }, queryOptions);
          next = items[0];
        }
        if (String(next._id) !== String(target._id)) throw new Error('Cannot change immutable _id');
        docs[docs.indexOf(target)] = next;
        current ??= clone(next);
        if (initial !== encode(next) && !upsertedId) modifiedCount++;
      }
      const value = options.returnDocument === 'after' || options.returnOriginal === false ? current : old;
      return { acknowledged: true, matchedCount, modifiedCount, upsertedCount: upsertedId ? 1 : 0, upsertedId, value, lastErrorObject: { n: targets.length, updatedExisting: matchedCount > 0, ...(upsertedId ? { upserted: upsertedId } : {}) } };
    });
  }
  async updateOne(filter, update, options) { return this.modify(filter, update, options); }
  async updateMany(filter, update, options) { return this.modify(filter, update, options, true); }
  async replaceOne(filter, replacement, options) { return this.modify(filter, replacement, options, false, true); }
  async findOneAndUpdate(filter, update, options = {}) { const result = await this.modify(filter, update, options); return options.includeResultMetadata ? result : result.value; }
  async findOneAndReplace(filter, replacement, options = {}) { const result = await this.modify(filter, replacement, options, false, true); return options.includeResultMetadata ? result : result.value; }
  async findAndModify(filter, sort, update, options = {}) { return this.findOneAndUpdate(filter, update, { ...options, sort }); }
  async remove(filter, options = {}, many = false) {
    return this.mutate(docs => {
      let matches = new Query(filter, queryOptions).find(docs);
      if (options.sort) matches = matches.sort(options.sort);
      const targets = many ? matches.all() : matches.limit(1).all();
      for (const doc of targets) docs.splice(docs.indexOf(doc), 1);
      return { acknowledged: true, deletedCount: targets.length, value: targets[0] || null };
    });
  }
  async deleteOne(filter, options) { return this.remove(filter, options); }
  async deleteMany(filter, options) { return this.remove(filter, options, true); }
  async findOneAndDelete(filter, options = {}) { const result = await this.remove(filter, options); return options.includeResultMetadata ? result : result.value; }

  
  async createIndex(key, options = {}) {
    const name = options.name || Object.entries(key).map(([key, order]) => `${key}_${order}`).join('_');
    if (name === '_id_') return name;
    const definition = { ...options, key, name };
    await this.ready();
    const client = await this.db.pool.getConnection();
    try {
      await client.beginTransaction();
      await client.execute('SELECT collection_name FROM `_humaeli_locks` WHERE collection_name = ? FOR UPDATE', [this.name]);
      const existing = (await this.indexes(client)).find(index => index.name === name);
      if (existing && encode(existing) !== encode(definition) && !canRefreshIndexDefinition(existing, definition)) {
        throw new Error(`Index ${name} has conflicting options; migrate the index explicitly`);
      }
      checkUnique(await this.read(client), [definition]);
      await client.execute('INSERT INTO `_humaeli_indexes` (collection_name, index_name, definition) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE definition = VALUES(definition)', [this.name, name, encode(definition)]);
      await client.commit();
      await addSqlIndex(client, this.name, this.db.columns.get(this.name), key, name);
      return name;
    } catch (error) { await client.rollback(); throw error; }
    finally { client.release(); }
  }
  async ensureIndex(key, options = {}) { return this.createIndex(key, options); }
  async createIndexes(indexes) { const names = []; for (const { key, ...options } of indexes) names.push(await this.createIndex(key, options)); return names; }
  async dropIndex(name) { await this.db.pool.execute('DELETE FROM `_humaeli_indexes` WHERE collection_name = ? AND index_name = ?', [this.name, name]); }
  async getIndexes() { return this.indexes(); }
  watch() { throw new Error('Change streams are not supported by MySQL storage'); }
  async bulkWrite(operations, options = {}) {
    const result = { acknowledged: true, insertedCount: 0, matchedCount: 0, modifiedCount: 0, deletedCount: 0, upsertedCount: 0, insertedIds: {}, upsertedIds: {} };
    const errors = [];
    for (const [i, operation] of operations.entries()) {
      try {
        const [kind, spec] = Object.entries(operation)[0];
        let item;
        if (kind === 'insertOne') { item = await this.insertOne(spec.document); result.insertedIds[i] = item.insertedId; result.insertedCount++; }
        else if (kind === 'deleteOne' || kind === 'deleteMany') item = await this[kind](spec.filter, spec);
        else if (['updateOne', 'updateMany', 'replaceOne'].includes(kind)) item = await this[kind](spec.filter, spec.update ?? spec.replacement, spec);
        else throw new Error(`Unsupported bulk operation ${kind}`);
        for (const key of ['matchedCount', 'modifiedCount', 'deletedCount', 'upsertedCount']) result[key] += item[key] || 0;
        if (item.upsertedId) result.upsertedIds[i] = item.upsertedId;
      } catch (error) { errors.push({ index: i, code: error.code, errmsg: error.message }); if (options.ordered !== false) break; }
    }
    if (errors.length) throw Object.assign(new Error('Bulk write failed'), { writeErrors: errors, result, code: errors[0].code });
    return result;
  }
}

class MySQLMongooseCollection extends MongooseCollection {
  constructor(name, conn, options = {}) {
    super(name, conn, options);
    this.collection = this.collection || null;
  }

  onOpen() {
    this.collection = this.conn.db.collection(this.name);
    super.onOpen();
    return this.collection;
  }

  _getCollection() {
    if (this.collection) return this.collection;
    if (this.conn.db) {
      this.collection = this.conn.db.collection(this.name);
      return this.collection;
    }
    return null;
  }

  createIndex(...args) {
    return this._getCollection().createIndex(...args);
  }

  ensureIndex(...args) {
    return this._getCollection().ensureIndex(...args);
  }

  createIndexes(...args) {
    return this._getCollection().createIndexes(...args);
  }

  dropIndex(...args) {
    return this._getCollection().dropIndex(...args);
  }

  indexes(...args) {
    return this._getCollection().indexes(...args);
  }

  listIndexes(...args) {
    return this._getCollection().listIndexes(...args);
  }

  getIndexes(...args) {
    return this._getCollection().getIndexes(...args);
  }

  find(...args) {
    return this._getCollection().find(...args);
  }

  findOne(...args) {
    return this._getCollection().findOne(...args);
  }

  countDocuments(...args) { return this._getCollection().countDocuments(...args); }
  estimatedDocumentCount(...args) { return this._getCollection().estimatedDocumentCount(...args); }
  distinct(...args) { return this._getCollection().distinct(...args); }
  aggregate(...args) { return this._getCollection().aggregate(...args); }
  bulkWrite(...args) { return this._getCollection().bulkWrite(...args); }
  replaceOne(...args) { return this._getCollection().replaceOne(...args); }

  findAndModify(...args) {
    return this._getCollection().findAndModify(...args);
  }

  findOneAndUpdate(...args) {
    return this._getCollection().findOneAndUpdate(...args);
  }

  findOneAndDelete(...args) {
    return this._getCollection().findOneAndDelete(...args);
  }

  findOneAndReplace(...args) {
    return this._getCollection().findOneAndReplace(...args);
  }

  insert(...args) {
    return this._getCollection().insert(...args);
  }

  insertOne(...args) {
    return this._getCollection().insertOne(...args);
  }

  insertMany(...args) {
    return this._getCollection().insertMany(...args);
  }

  save(...args) {
    return this._getCollection().save(...args);
  }

  updateOne(...args) {
    return this._getCollection().updateOne(...args);
  }

  updateMany(...args) {
    return this._getCollection().updateMany(...args);
  }

  deleteOne(...args) {
    return this._getCollection().deleteOne(...args);
  }

  deleteMany(...args) {
    return this._getCollection().deleteMany(...args);
  }

  watch(...args) {
    return this._getCollection().watch(...args);
  }
}

class SQLDatabase {
  constructor(pool, name, models) { this.pool = pool; this.databaseName = name; this.models = models; this.tables = new Map(); this.collections = new Map(); this.columns = new Map(); }
  async initialize() {
    await this.pool.query('CREATE TABLE IF NOT EXISTS `_humaeli_locks` (collection_name VARCHAR(64) COLLATE utf8mb4_bin PRIMARY KEY) ENGINE=InnoDB');
    await this.pool.query('CREATE TABLE IF NOT EXISTS `_humaeli_indexes` (collection_name VARCHAR(64) COLLATE utf8mb4_bin NOT NULL, index_name VARCHAR(191) COLLATE utf8mb4_bin NOT NULL, definition JSON NOT NULL, PRIMARY KEY (collection_name, index_name)) ENGINE=InnoDB');
    await this.pool.query('CREATE TABLE IF NOT EXISTS `_humaeli_columns` (collection_name VARCHAR(64) COLLATE utf8mb4_bin PRIMARY KEY, definition JSON NOT NULL) ENGINE=InnoDB');
    await initializeRowState(this.pool);
  }
  schema(name) { return collectionSchema(this.models(), name); }
  async ensureTable(name) {
    quote(name);
    if (name.startsWith('_humaeli_')) throw new Error('Reserved collection name');
    if (!this.tables.has(name)) this.tables.set(name, (async () => {
      const client = await this.pool.getConnection();
      const lock = `humaeli-columns:${this.databaseName}:${name}`.slice(0, 64);
      let locked = false;
      try {
        const [result] = await client.execute('SELECT GET_LOCK(?, 20) AS acquired', [lock]);
        locked = Number(result[0].acquired) === 1;
        if (!locked) throw new Error('Timed out acquiring schema lock');
        const [tables] = await client.execute('SELECT COLUMN_NAME, DATA_TYPE, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [this.databaseName, name]);
        if (tables.some(row => ['document', '_sql_state'].includes(row.COLUMN_NAME))) throw new Error(`Table ${name} uses the old storage layout. Run npm run db:columns before starting this backend.`);
        const [saved] = await client.execute('SELECT definition FROM `_humaeli_columns` WHERE collection_name = ?', [name]);
        const fields = saved.length
          ? (typeof saved[0].definition === 'string' ? JSON.parse(saved[0].definition) : saved[0].definition)
          : tables.length ? recoverColumnMapping(name, this.schema(name), tables) : buildColumns(this.schema(name));
        if (!tables.length) await client.query(tableDDL(name, fields));
        else {
          const physical = new Set(tables.map(row => row.COLUMN_NAME));
          for (const field of fields) {
            if (!physical.has(field.column)) {
              if (field.path === '_id') throw new Error(`Table ${name} is missing its mapped primary key`);
              await client.query(`ALTER TABLE ${quote(name)} ADD COLUMN ${quote(field.column)} ${sqlType(field)} NULL`);
            }
          }
        }
        await client.execute('INSERT IGNORE INTO `_humaeli_columns` (collection_name, definition) VALUES (?, ?)', [name, JSON.stringify(fields)]);
        await client.execute('INSERT IGNORE INTO `_humaeli_locks` (collection_name) VALUES (?)', [name]);
        this.columns.set(name, fields);
        if (tables.length && !saved.length) console.info(`Recovered MySQL column mapping for ${name}; existing rows preserved.`);
      } finally {
        try { if (locked) await client.execute('SELECT RELEASE_LOCK(?)', [lock]); }
        finally { client.release(); }
      }
    })().catch(error => { this.tables.delete(name); throw error; }));
    return this.tables.get(name);
  }
  async ensureColumns(name, documents = []) {
    await this.ensureTable(name);
    const current = this.columns.get(name);
    const required = buildColumns(this.schema(name), documents, current);
    for (const field of current) {
      const next = required.find(item => item.path === field.path);
      if (next && next.kind !== field.kind) throw new Error(`Column type change required for ${name}.${field.path}; use an explicit migration`);
    }
    const desired = mergeColumnDefinitions(current, required);
    if (desired.length === current.length) return;
    // DDL is performed before write transactions, and serialized across workers.
    const client = await this.pool.getConnection();
    const lock = `humaeli-columns:${this.databaseName}:${name}`.slice(0, 64);
    try {
      const [result] = await client.execute('SELECT GET_LOCK(?, 20) AS acquired', [lock]);
      if (Number(result[0].acquired) !== 1) throw new Error('Timed out acquiring schema lock');
      const [rows] = await client.query(`SHOW COLUMNS FROM ${quote(name)}`);
      const physical = new Set(rows.map(row => row.Field));
      const [saved] = await client.execute('SELECT definition FROM `_humaeli_columns` WHERE collection_name = ?', [name]);
      const stored = typeof saved[0].definition === 'string' ? JSON.parse(saved[0].definition) : saved[0].definition;
      const additions = buildColumns(this.schema(name), documents, stored);
      const merged = mergeColumnDefinitions(stored, additions);
      for (const field of merged) if (!physical.has(field.column)) await client.query(`ALTER TABLE ${quote(name)} ADD COLUMN ${quote(field.column)} ${sqlType(field)} NULL`);
      await client.execute('UPDATE `_humaeli_columns` SET definition = ? WHERE collection_name = ?', [JSON.stringify(merged), name]);
      this.columns.set(name, merged);
    } finally { await client.execute('SELECT RELEASE_LOCK(?)', [lock]); client.release(); }
  }
  collection(name) { if (!this.collections.has(name)) this.collections.set(name, new SQLCollection(this, name)); return this.collections.get(name); }
  async createCollection(name) { await this.ensureColumns(name); return this.collection(name); }
  listCollections() { return new Cursor(async () => { const [rows] = await this.pool.query('SELECT collection_name AS name FROM `_humaeli_locks`'); return rows; }); }
  async command(command) { if (command.ping) { await this.pool.query('SELECT 1'); return { ok: 1 }; } throw new Error('Unsupported database command'); }
}

class Connection extends BaseConnection {
  async createClient(_uri, options = {}) {
    this.readyState = 2;
    this.config.autoIndex = false;
    this.config.autoCreate = false;
    const config = { ...mysqlConfig(), ...options.mysql };
    const pool = mysql.createPool(config);
    try {
      await pool.query('SELECT 1');
      this.db = new SQLDatabase(pool, config.database, () => this.models);
      await this.db.initialize();
      this.name = config.database; this.host = config.host; this.port = config.port;
      this.client = { close: () => pool.end() };
      this.onOpen();
      return this;
    } catch (error) { await pool.end(); this.client = null; this.db = undefined; this.readyState = 0; throw error; }
  }
  async doClose() {
    const client = this.client;
    this.client = null;
    this.db = undefined;
    await client?.close();
    return this;
  }
  async startSession() { throw new Error('Database sessions are not supported by MySQL storage'); }
}

export default { Connection, Collection: MySQLMongooseCollection };
