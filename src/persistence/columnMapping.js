import { buildColumns } from './columns.js';

const textTypes = new Set(['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum']);
const numberTypes = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'bigint', 'decimal', 'float', 'double']);

function incompatible(table, reason) {
  const error = new Error(`Cannot recover MySQL column mapping for ${table}: ${reason}. Restore the matching _humaeli_columns metadata or migrate this table explicitly.`);
  error.code = 'MYSQL_SCHEMA_MISMATCH';
  return error;
}

// Reconstruct only the known model layout. No table is renamed, emptied or
// converted, and extra SQL columns remain untouched (including native SQL fields).
export function recoverColumnMapping(table, schema, columns) {
  if (!schema) throw incompatible(table, 'no registered model schema');
  const physical = new Map(columns.map(column => [column.COLUMN_NAME, column]));
  if (physical.has('document') || physical.has('_sql_state')) {
    throw incompatible(table, 'legacy document storage requires npm run db:columns');
  }
  const primary = columns.filter(column => column.COLUMN_KEY === 'PRI');
  const id = physical.get('id');
  if (!id || primary.length !== 1 || primary[0] !== id || !['char', 'varchar'].includes(id.DATA_TYPE)) {
    throw incompatible(table, 'expected a single string id primary key');
  }
  const fields = buildColumns(schema).filter(field => physical.has(field.column));
  for (const field of fields) {
    const column = physical.get(field.column);
    const type = column.DATA_TYPE.toLowerCase();
    const compatible = field.kind === 'json' ? type === 'json' || textTypes.has(type)
      : field.kind === 'string' ? textTypes.has(type)
      : field.kind === 'objectId' ? ['char', 'varchar'].includes(type)
      : field.kind === 'number' ? numberTypes.has(type)
      : field.kind === 'boolean' ? ['tinyint', 'smallint', 'int'].includes(type)
      : field.kind === 'date' ? ['date', 'datetime', 'timestamp'].includes(type)
      : false;
    if (!compatible) throw incompatible(table, `${field.column} has SQL type ${type}, expected ${field.kind}`);
  }
  if (fields.length < 2) throw incompatible(table, 'no model fields match the existing table');
  return fields;
}
