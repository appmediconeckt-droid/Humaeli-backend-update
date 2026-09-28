import 'dotenv/config';
import mysql from 'mysql2/promise';
import mongoose from '../src/persistence/mongoose.js';
import { loadModels } from '../src/persistence/models.js';
import { buildColumns, collectionSchema } from '../src/persistence/columns.js';
import { mysqlConfig } from '../src/persistence/mysqlDriver.js';

await loadModels();
const client = await mysql.createConnection(mysqlConfig());
try {
  const names = [...new Set(Object.values(mongoose.models).map(model => model.collection.name))].sort();
  for (const name of names) {
    const expected = buildColumns(collectionSchema(mongoose.models, name)).map(field => field.column);
    const [rows] = await client.execute('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION', [name]);
    const actual = rows.map(row => row.COLUMN_NAME);
    const missing = expected.filter(field => !actual.includes(field));
    const extra = actual.filter(field => !expected.includes(field));
    const orderMatches = actual.every((column, index) => column === expected[index]);
    console.log(`${name}: ${actual.length}/${expected.length} model columns${missing.length || extra.length ? `; missing=${missing.join(',')}; extra=${extra.join(',')}` : orderMatches ? ' OK (order verified)' : '; order mismatch'}`);
    if (missing.length || extra.length || !orderMatches) process.exitCode = 1;
  }
} finally { await client.end(); }
