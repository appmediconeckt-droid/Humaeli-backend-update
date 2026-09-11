import 'dotenv/config';
import mysql from 'mysql2/promise';
import { mkdir, writeFile } from 'node:fs/promises';
import mongoose from '../src/persistence/mongoose.js';
import { loadModels } from '../src/persistence/models.js';
import { mysqlConfig } from '../src/persistence/mysqlDriver.js';
import { buildColumns, collectionSchema, quote } from '../src/persistence/columns.js';

await loadModels();
const client = await mysql.createConnection(mysqlConfig());
try {
  const backup = '.migration-backups/order-' + new Date().toISOString().replace(/[:.]/g, '-');
  await mkdir(backup, { recursive: true });
  const names = [...new Set(Object.values(mongoose.models).map(model => model.collection.name))];
  for (const name of names) {
    const [saved] = await client.execute('SELECT definition FROM `_humaeli_columns` WHERE collection_name = ?', [name]);
    if (!saved.length) throw new Error(`Missing column mapping for ${name}`);
    const prior = typeof saved[0].definition === 'string' ? JSON.parse(saved[0].definition) : saved[0].definition;
    const desired = buildColumns(collectionSchema(mongoose.models, name), [], prior);
    const [columns] = await client.query(`SHOW FULL COLUMNS FROM ${quote(name)}`);
    if (columns.length !== desired.length || desired.some(field => !columns.some(column => column.Field === field.column))) throw new Error(`Column set mismatch in ${name}; refusing a non-order change`);
    if (columns.every((column, index) => column.Field === desired[index].column)) { console.log(`${name}: order already correct`); continue; }
    const [ddl] = await client.query(`SHOW CREATE TABLE ${quote(name)}`);
    await writeFile(`${backup}/${name}.sql`, ddl[0]['Create Table'] + ';\n');
    const changes = desired.map((field, index) => {
      const column = columns.find(column => column.Field === field.column);
      if (column.Extra || column.Comment || column.Default !== null) throw new Error(`Nonstandard definition for ${name}.${field.column}; refusing to change it`);
      const collation = column.Collation ? ` COLLATE ${quote(column.Collation)}` : '';
      const nullable = column.Null === 'YES' ? ' NULL DEFAULT NULL' : ' NOT NULL';
      const position = index === 0 ? ' FIRST' : ` AFTER ${quote(desired[index - 1].column)}`;
      return `MODIFY COLUMN ${quote(field.column)} ${column.Type}${collation}${nullable}${position}`;
    });
    // MODIFY ... FIRST/AFTER changes display order; values and index definitions
    // remain in place. A single ALTER avoids an intermediate order per column.
    await client.query(`ALTER TABLE ${quote(name)} ${changes.join(', ')}`);
    const [after] = await client.query(`SHOW FULL COLUMNS FROM ${quote(name)}`);
    if (after.some((column, index) => column.Field !== desired[index].column)) throw new Error(`Order verification failed for ${name}`);
    await client.execute('UPDATE `_humaeli_columns` SET definition = ? WHERE collection_name = ?', [JSON.stringify(desired), name]);
    console.log(`${name}: reordered ${after.length} columns`);
  }
  console.log(`Previous table definitions saved in ${backup}`);
} finally { await client.end(); }
