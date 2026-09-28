import 'dotenv/config';
import mysql from 'mysql2/promise';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import mongoose from '../src/persistence/mongoose.js';
import { loadModels } from '../src/persistence/models.js';
import { mysqlConfig } from '../src/persistence/mysqlDriver.js';
import { buildColumns, quote, tableDDL, fromRow, writeRow, addSqlIndex, collectionSchema, initializeRowState, readRows } from '../src/persistence/columns.js';

const EJSON = mongoose.mongo.BSON.EJSON;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const contentHash = documents => createHash('sha256').update(documents.map(doc => JSON.stringify(canonical(EJSON.serialize(doc, { relaxed: false })))).sort().join('\n')).digest('hex');

export async function migrateColumns({ dryRun = false } = {}) {
  await loadModels();
  const config = mysqlConfig();
  const client = await mysql.createConnection(config);
  const lockName = 'humaeli-convert-' + createHash('sha256').update(config.database).digest('hex').slice(0, 24);
  let locked = false;
  try {
    const [lock] = await client.execute('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
    if (Number(lock[0].acquired) !== 1) throw new Error('Another column migration is running');
    locked = true;
    const assertOffline = async () => {
      const [connections] = await client.query('SELECT ID FROM information_schema.PROCESSLIST WHERE DB = DATABASE() AND ID <> CONNECTION_ID()');
      if (connections.length) throw new Error('Stop the backend and close other connections to this database before column conversion');
    };
    if (!dryRun) await assertOffline();
    const [names] = await client.execute("SELECT TABLE_NAME AS name, COLUMN_NAME AS format FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND COLUMN_NAME IN ('document', '_sql_state') AND TABLE_NAME NOT LIKE '\\_col\\_%'", [config.database]);
    if (!names.length) { console.log('No old document tables remain; column migration is already complete.'); return { alreadyComplete: true }; }
    const [storedIndexes] = await client.query('SELECT * FROM `_humaeli_indexes`');
    const plans = [];
    for (const { name, format } of names) {
      const [rows] = await client.query(`SELECT * FROM ${quote(name)}`);
      let oldFields;
      if (format === '_sql_state') {
        const [mapping] = await client.execute('SELECT definition FROM `_humaeli_columns` WHERE collection_name = ?', [name]);
        if (!mapping.length) throw new Error(`Missing old column mapping for ${name}`);
        oldFields = typeof mapping[0].definition === 'string' ? JSON.parse(mapping[0].definition) : mapping[0].definition;
      }
      const documents = rows.map(row => format === 'document' ? EJSON.parse(typeof row.document === 'string' ? row.document : JSON.stringify(row.document), { relaxed: true }) : fromRow(row, oldFields));
      if (rows.some((row, i) => row.id !== String(documents[i]._id))) throw new Error(`Mismatched IDs in ${name}`);
      const schema = collectionSchema(mongoose.models, name);
      const fields = buildColumns(schema, documents);
      const archiveOnly = !schema && !documents.length;
      const shadow = '_col_' + createHash('sha256').update(name).digest('hex').slice(0, 20);
      plans.push({ name, format, oldFields, documents, fields, archiveOnly, shadow, hash: contentHash(documents) });
      console.log(`${name}: ${documents.length} rows, ${archiveOnly ? 'archive unused empty legacy table' : fields.length + ' field columns'}`);
    }
    if (dryRun) return { tables: plans.length, dryRun: true };
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
    const backupDatabase = `${config.database.slice(0, 25)}_schema_backup_${stamp}`;
    const directory = resolve('.migration-backups', 'columns-' + stamp);
    await mkdir(directory, { recursive: true });
    const manifest = { database: config.database, backupDatabase, startedAt: new Date().toISOString(), verified: false, tables: plans.map(({ name, fields, oldFields, documents, hash, archiveOnly }) => ({ name, columns: fields, oldColumns: oldFields, count: documents.length, sha256: hash, archiveOnly })) };
    await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    await writeFile(resolve(directory, 'indexes.ejson'), EJSON.stringify(storedIndexes), { mode: 0o600 });
    for (const plan of plans) await writeFile(resolve(directory, `${plan.name}.ejson`), EJSON.stringify(plan.documents, { relaxed: false }), { mode: 0o600 });
    await client.query(`CREATE DATABASE ${quote(backupDatabase)} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
    await client.query('CREATE TABLE IF NOT EXISTS `_humaeli_columns` (collection_name VARCHAR(64) COLLATE utf8mb4_bin PRIMARY KEY, definition JSON NOT NULL) ENGINE=InnoDB');
    await initializeRowState(client);
    // Old tables remain intact until every replacement passes a full round trip.
    for (const plan of plans.filter(plan => !plan.archiveOnly)) {
      await client.query(tableDDL(plan.shadow, plan.fields));
      await client.beginTransaction();
      try {
        for (const doc of plan.documents) await writeRow(client, plan.shadow, plan.fields, doc);
        await client.commit();
      } catch (error) { await client.rollback(); throw error; }
      const rows = await readRows(client, plan.shadow);
      if (contentHash(rows.map(row => fromRow(row, plan.fields))) !== plan.hash) throw new Error(`Round-trip verification failed for ${plan.name}; original table untouched`);
      for (const index of storedIndexes.filter(index => index.collection_name === plan.name)) {
        const definition = EJSON.parse(typeof index.definition === 'string' ? index.definition : JSON.stringify(index.definition), { relaxed: true });
        if (definition.name !== '_id_') await addSqlIndex(client, plan.shadow, plan.fields, definition.key, definition.name);
      }
    }
    await assertOffline();
    for (const plan of plans) {
      const [rows] = await client.query(`SELECT * FROM ${quote(plan.name)}`);
      const current = rows.map(row => plan.format === 'document' ? EJSON.parse(typeof row.document === 'string' ? row.document : JSON.stringify(row.document), { relaxed: true }) : fromRow(row, plan.oldFields));
      if (contentHash(current) !== plan.hash) throw new Error(`Source table ${plan.name} changed. Originals retained; stop writes before retrying.`);
    }
    const renames = plans.flatMap(plan => [
      `${quote(plan.name)} TO ${quote(backupDatabase)}.${quote(plan.name)}`,
      ...(!plan.archiveOnly ? [`${quote(plan.shadow)} TO ${quote(plan.name)}`] : []),
    ]);
    // One rename statement publishes the verified tables. Backups also remain
    // on disk because older MariaDB releases are not crash-atomic for multi-rename.
    await client.query('RENAME TABLE ' + renames.join(', '));
    await client.beginTransaction();
    try {
      for (const plan of plans.filter(plan => !plan.archiveOnly)) {
        await client.execute('INSERT INTO `_humaeli_columns` (collection_name, definition) VALUES (?, ?) ON DUPLICATE KEY UPDATE definition = VALUES(definition)', [plan.name, JSON.stringify(plan.fields)]);
        await client.execute('DELETE FROM `_humaeli_row_state` WHERE collection_name = ?', [plan.name]);
        await client.execute('UPDATE `_humaeli_row_state` SET collection_name = ? WHERE collection_name = ?', [plan.name, plan.shadow]);
      }
      await client.commit();
    } catch (error) { await client.rollback(); throw error; }
    for (const plan of plans) {
      if (plan.archiveOnly) {
        await client.execute('DELETE FROM `_humaeli_locks` WHERE collection_name = ?', [plan.name]);
        await client.execute('DELETE FROM `_humaeli_indexes` WHERE collection_name = ?', [plan.name]);
        continue;
      }
      const rows = await readRows(client, plan.name);
      if (contentHash(rows.map(row => fromRow(row, plan.fields))) !== plan.hash) throw new Error(`Post-conversion verification failed for ${plan.name}; restore using ${backupDatabase}`);
    }
    manifest.verified = true; manifest.completedAt = new Date().toISOString();
    await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    console.log(`Verified ${plans.reduce((sum, plan) => sum + plan.documents.length, 0)} rows. Original tables retained in ${backupDatabase}. Manifest: ${directory}`);
    return manifest;
  } finally {
    if (locked) await client.execute('SELECT RELEASE_LOCK(?)', [lockName]);
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  migrateColumns({ dryRun: process.argv.includes('--dry-run') }).catch(error => {
    console.error(`Column migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}
