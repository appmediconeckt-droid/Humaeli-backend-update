import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BSON, ObjectId } = require('mongoose').mongo;
const json = value => BSON.EJSON.stringify(value, { relaxed: true });
const parse = value => BSON.EJSON.parse(typeof value === 'string' ? value : JSON.stringify(value), { relaxed: true });

export function quote(name) {
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(name)) throw new Error(`Invalid SQL identifier: ${name}`);
  return '`' + name + '`';
}

function columnName(path) {
  if (path === '_id') return 'id';
  let name = path.replace(/[^a-zA-Z0-9_]/g, '_');
  if (['id', 'document', '_sql_state'].includes(name)) name = 'field_' + name;
  if (name.length > 54) name = name.slice(0, 45) + '_' + createHash('sha256').update(path).digest('hex').slice(0, 12);
  return name;
}

const schemaKind = type => ({ String: 'string', Number: 'number', Boolean: 'boolean', Date: 'date', ObjectId: 'objectId' })[type.instance] || 'json';
const valueKind = value => {
  if (value == null) return null;
  if (value instanceof Date) return 'date';
  if (value?._bsontype === 'ObjectId') return 'objectId';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number' && Number.isFinite(value)) return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'json';
};
const isObject = value => value && Object.getPrototypeOf(value) === Object.prototype;

// Display order requested from the existing Compass user document. Optional
// schema fields absent from that document follow in model declaration order.
const userColumnOrder = `
_id fullName email anonymous phoneNumber phoneCountryCode password googleEmail
authProvider sessionId walletCreditPaymentIds age gender role profileCompleted
chatContext isEmailVerified isPhoneVerified dateOfBirth bloodGroup address
emergencyContact medicalInfo insuranceInfo specialization consultationMode
languages education rating ratingCount totalSessions activeClients
profilePhotoPublicId chatPermission isActive isVerified isOnline lastSeen
walletBalance devicePlatform instantPayoutCount payoutAccount locationConsent
locationData certifications createdAt updatedAt __v googleId
activeWalletRefundRequest prescriptionSeal prescriptionSignature
lastActiveAt fcmToken
`.trim().split(/\s+/);

export function collectionSchema(models, name) {
  const schemas = Object.values(models).filter(model => model.collection.name === name).map(model => model.schema);
  return schemas.length ? { columnOrder: name === 'users' ? userColumnOrder : [], eachPath(callback) { for (const schema of schemas) schema.eachPath(callback); } } : undefined;
}

// One physical column per top-level model field. Nested objects, arrays and
// Mixed values have their own JSON column. Legacy fields outside a known model
// are retained in the private row metadata instead of adding surprise columns.
export function buildColumns(schema, documents = [], existing = []) {
  const fields = new Map();
  const prior = new Map(existing.filter(field => !field.path.includes('.')).map(field => [field.path, field]));
  const add = (path, kind) => {
    if (path === '_id') kind = 'objectId';
    if (!fields.has(path)) fields.set(path, { path, column: columnName(path), kind, ...(prior.get(path) || {}) });
    if (kind === 'json') fields.get(path).kind = 'json';
  };
  if (schema) schema.eachPath((path, type) => {
    const root = path.split('.')[0];
    add(root, path.includes('.') || type.schema ? 'json' : schemaKind(type));
  });
  else for (const field of existing) add(field.path.split('.')[0], field.path.includes('.') ? 'json' : field.kind);
  add('_id', 'objectId');
  for (const doc of documents) for (const [path, value] of Object.entries(doc)) {
    if (schema && !fields.has(path)) continue;
    const kind = valueKind(value);
    if (!fields.has(path)) add(path, kind || 'json');
    const field = fields.get(path);
    if (value == null || field.kind === 'json' || path === '_id') continue;
    if (field.kind === 'objectId' && kind === 'string') continue;
    if (field.kind !== kind) field.kind = 'json';
  }
  const names = new Set();
  for (const field of fields.values()) {
    if (names.has(field.column.toLowerCase())) field.column += '_' + createHash('sha256').update(field.path).digest('hex').slice(0, 8);
    quote(field.column); names.add(field.column.toLowerCase());
  }
  const order = ['_id', ...(schema?.columnOrder || []), ...fields.keys()];
  return [...fields.values()].sort((a, b) => order.indexOf(a.path) - order.indexOf(b.path));
}

export function sqlType(field) {
  if (field.path === '_id') return 'VARCHAR(191)';
  return { string: 'LONGTEXT', objectId: 'VARCHAR(191)', number: 'DOUBLE', boolean: 'TINYINT(1)', date: 'DATETIME(3)', json: 'JSON' }[field.kind];
}

export function tableDDL(table, fields) {
  return `CREATE TABLE ${quote(table)} (${fields.map(field => `${quote(field.column)} ${sqlType(field)} ${field.path === '_id' ? 'NOT NULL PRIMARY KEY' : 'NULL'}`).join(', ')}) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`;
}

function getPath(doc, path) { return path.split('.').reduce((value, key) => value?.[key], doc); }
function setPath(doc, path, value) {
  const parts = path.split('.');
  if (parts.some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) throw new Error('Unsafe document field path');
  let target = doc;
  for (const key of parts.slice(0, -1)) { target[key] ??= {}; target = target[key]; }
  target[parts.at(-1)] = value;
}

export function toRow(doc, fields) {
  const row = {};
  const state = { present: [], containers: {}, stringReferences: [] };
  const known = new Set(fields.map(field => field.path));
  const legacy = Object.fromEntries(Object.entries(doc).filter(([key, value]) => !known.has(key) && value !== undefined));
  if (Object.keys(legacy).length) state.legacy = BSON.EJSON.serialize(legacy, { relaxed: true });
  for (const field of fields) {
    const value = getPath(doc, field.path);
    if (value !== undefined) state.present.push(field.path);
    if (value == null) row[field.column] = null;
    else if (field.kind === 'json') row[field.column] = json(value);
    else if (field.kind === 'objectId') {
      row[field.column] = String(value);
      if (typeof value === 'string') state.stringReferences.push(field.path);
    }
    else if (field.kind === 'boolean') row[field.column] = value ? 1 : 0;
    else if (field.kind === 'date') {
      if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error(`Invalid date in ${field.path}`);
      row[field.column] = value;
    } else {
      if (valueKind(value) !== field.kind) throw new Error(`Unexpected value type in ${field.path}; migrate the column before writing`);
      row[field.column] = value;
    }
  }
  row._sql_state = JSON.stringify(state);
  return row;
}

export function fromRow(row, fields) {
  const state = row._sql_state ? (typeof row._sql_state === 'string' ? JSON.parse(row._sql_state) : row._sql_state) : null;
  const present = new Set(state?.present || []);
  const doc = {};
  for (const field of fields) {
    let value = row[field.column];
    if (value == null) { if (state && !present.has(field.path)) continue; value = null; }
    else if (field.kind === 'json') value = parse(value);
    else if (field.kind === 'objectId') value = state?.stringReferences?.includes(field.path) ? value : new ObjectId(value);
    else if (field.kind === 'boolean') value = Boolean(value);
    else if (field.kind === 'number') value = Number(value);
    else if (field.kind === 'date') value = value instanceof Date ? value : new Date(value);
    setPath(doc, field.path, value);
  }
  for (const [path, kind] of Object.entries(state?.containers || {})) {
    // Direct SQL updates to a child column take precedence over empty-container
    // metadata from the original import.
    const hasChildValue = fields.some(field => field.path.startsWith(path + '.') && row[field.column] != null);
    if (!hasChildValue) setPath(doc, path, kind === 'null' ? null : {});
  }
  if (state?.legacy) {
    const legacy = BSON.EJSON.deserialize(state.legacy, { relaxed: true });
    for (const [key, value] of Object.entries(legacy)) if (!Object.hasOwn(doc, key)) setPath(doc, key, value);
  }
  return doc;
}

export async function writeRow(client, table, fields, document) {
  const row = toRow(document, fields);
  const metadata = row._sql_state;
  delete row._sql_state;
  const names = Object.keys(row);
  // Use id only for conflict detection. Secondary indexes remain nonunique so
  // application uniqueness checks never update a different row accidentally.
  await client.execute(`INSERT INTO ${quote(table)} (${names.map(quote).join(',')}) VALUES (${names.map(() => '?').join(',')}) ON DUPLICATE KEY UPDATE ${names.filter(name => name !== 'id').map(name => `${quote(name)} = VALUES(${quote(name)})`).join(',')}`, Object.values(row));
  await client.execute('INSERT INTO `_humaeli_row_state` (collection_name, row_id, state) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE state = VALUES(state)', [table, String(document._id), metadata]);
}

export async function initializeRowState(client) {
  await client.query('CREATE TABLE IF NOT EXISTS `_humaeli_row_state` (collection_name VARCHAR(64) COLLATE utf8mb4_bin NOT NULL, row_id VARCHAR(191) COLLATE utf8mb4_bin NOT NULL, state JSON NOT NULL, PRIMARY KEY (collection_name, row_id)) ENGINE=InnoDB');
}

export async function readRows(client, table, predicate = { sql: '', parameters: [] }) {
  const [rows] = await client.execute(`SELECT * FROM ${quote(table)}${predicate.sql ? ' WHERE ' + predicate.sql : ''}`, predicate.parameters);
  if (!rows.length) return [];
  const [metadata] = await client.execute(`SELECT row_id, state FROM \`_humaeli_row_state\` WHERE collection_name = ? AND row_id IN (${rows.map(() => '?').join(',')})`, [table, ...rows.map(row => String(row.id))]);
  const states = new Map(metadata.map(row => [row.row_id, row.state]));
  return rows.map(row => ({ ...row, _sql_state: states.get(String(row.id)) || null }));
}

export async function addSqlIndex(client, table, fields, key, name) {
  const matched = Object.keys(key).map(path => fields.find(field => field.path === path));
  if (matched.some(field => !field || field.kind === 'json')) return;
  const indexName = 'idx_' + createHash('sha256').update(name).digest('hex').slice(0, 16);
  const [indexes] = await client.query(`SHOW INDEX FROM ${quote(table)} WHERE Key_name = ?`, [indexName]);
  if (indexes.length) return;
  const terms = matched.map(field => quote(field.column) + (field.kind === 'string' ? '(191)' : ''));
  // Cap composite prefixes to fit utf8mb4 InnoDB's 3072-byte key limit.
  if (matched.filter(field => ['string', 'objectId'].includes(field.kind)).length > 3) return;
  await client.query(`ALTER TABLE ${quote(table)} ADD INDEX ${quote(indexName)} (${terms.join(',')})`);
}

// Push safe scalar predicates into SQL so id/email/reference lookups use native
// indexes. Mingo still checks the complete filter after loading candidate rows.
// Unsupported expressions return no prefilter, never a narrower approximation.
export function sqlPrefilter(filter, fields) {
  const parts = [], parameters = [];
  for (const [path, expression] of Object.entries(filter || {})) {
    if (path === '$and' || path === '$or') {
      const branches = expression.map(branch => sqlPrefilter(branch, fields));
      if (path === '$or' && branches.some(branch => !branch.sql)) continue;
      const usable = branches.filter(branch => branch.sql);
      if (usable.length) {
        parts.push('(' + usable.map(branch => '(' + branch.sql + ')').join(path === '$or' ? ' OR ' : ' AND ') + ')');
        parameters.push(...usable.flatMap(branch => branch.parameters));
      }
      continue;
    }
    const field = fields.find(field => field.path === path);
    if (!field || field.kind === 'json') continue;
    const comparisons = isObject(expression) ? Object.entries(expression) : [['$eq', expression]];
    const value = item => field.kind === 'objectId' ? String(item) : field.kind === 'boolean' ? Number(item) : item;
    const safe = item => item != null && !(item instanceof RegExp) && (valueKind(item) === field.kind || (field.kind === 'objectId' && ['string', 'objectId'].includes(valueKind(item))));
    for (const [operator, operand] of comparisons) {
      if (operator === '$in' && Array.isArray(operand) && operand.length && operand.every(safe)) {
        parts.push(`${quote(field.column)} IN (${operand.map(() => '?').join(',')})`); parameters.push(...operand.map(value));
      } else if (['$eq', '$gt', '$gte', '$lt', '$lte'].includes(operator) && safe(operand)) {
        // Ordered string comparisons depend on Mongo's binary/type ordering;
        // leave those to the compatibility evaluator.
        if (operator !== '$eq' && !['number', 'date'].includes(field.kind)) continue;
        const sqlOperator = { $eq: '=', $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' }[operator];
        parts.push(`${quote(field.column)} ${sqlOperator} ?`); parameters.push(value(operand));
      }
    }
  }
  return { sql: parts.join(' AND '), parameters };
}
