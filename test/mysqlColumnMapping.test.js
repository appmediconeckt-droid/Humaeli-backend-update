import assert from 'node:assert/strict';
import { recoverColumnMapping } from '../src/persistence/columnMapping.js';

const schema = { eachPath(fn) {
  for (const [path, instance] of Object.entries({ _id: 'ObjectId', email: 'String', walletBalance: 'Number', isActive: 'Boolean', createdAt: 'Date', preferences: 'Mixed' })) fn(path, { instance });
} };
const columns = () => [
  { COLUMN_NAME: 'id', DATA_TYPE: 'varchar', COLUMN_KEY: 'PRI' },
  { COLUMN_NAME: 'email', DATA_TYPE: 'longtext' },
  { COLUMN_NAME: 'walletBalance', DATA_TYPE: 'double' },
  { COLUMN_NAME: 'isActive', DATA_TYPE: 'tinyint' },
  { COLUMN_NAME: 'createdAt', DATA_TYPE: 'datetime' },
  { COLUMN_NAME: 'preferences', DATA_TYPE: 'longtext' },
  { COLUMN_NAME: 'clinic_id', DATA_TYPE: 'varchar' },
];

describe('Missing MySQL column metadata recovery', () => {
  it('maps known fields from an imported table and leaves extra native SQL columns alone', () => {
    const fields = recoverColumnMapping('users', schema, columns());
    assert.equal(fields.length, 6);
    assert.deepEqual(fields.find(field => field.path === '_id'), { path: '_id', column: 'id', kind: 'objectId' });
    assert.equal(fields.find(field => field.path === 'preferences').kind, 'json');
    assert.equal(fields.some(field => field.column === 'clinic_id'), false);
  });
  it('leaves absent model fields for the additive schema migration', () => {
    assert.equal(recoverColumnMapping('users', schema, columns().slice(0, 2)).length, 2);
  });
  for (const invalid of [
    undefined,
    { eachPath() {} },
  ]) it('rejects an unknown table rather than inventing a mapping', () => {
    assert.throws(() => recoverColumnMapping('unknown', invalid, columns()), { code: 'MYSQL_SCHEMA_MISMATCH' });
  });
  for (const field of ['document', '_sql_state']) it(`refuses the old ${field} layout`, () => {
    assert.throws(() => recoverColumnMapping('users', schema, [...columns(), { COLUMN_NAME: field }]), /legacy document storage/);
  });
  it('refuses incompatible field types', () => {
    const physical = columns(); physical[2].DATA_TYPE = 'longtext';
    assert.throws(() => recoverColumnMapping('users', schema, physical), /walletBalance.*expected number/);
  });
  it('refuses integer or composite primary keys', () => {
    const physical = columns(); physical[0].DATA_TYPE = 'bigint';
    assert.throws(() => recoverColumnMapping('users', schema, physical), /string id primary key/);
    physical[0].DATA_TYPE = 'varchar'; physical[1].COLUMN_KEY = 'PRI';
    assert.throws(() => recoverColumnMapping('users', schema, physical), /string id primary key/);
  });
});
