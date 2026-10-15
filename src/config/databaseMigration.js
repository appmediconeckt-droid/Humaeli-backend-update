import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';

// Use a dedicated connection for the advisory lock: the repair itself needs
// connections from the application pool, including when its limit is one.
export async function runDatabaseMigration(config, name, action, { force = false, connect = mysql.createConnection } = {}) {
  const client = await connect(config);
  const key = `humaeli-migration:${createHash('sha256').update(`${config.database}:${name}`).digest('hex').slice(0, 40)}`;
  let locked = false;
  try {
    await client.query('CREATE TABLE IF NOT EXISTS `_humaeli_migrations` (migration_name VARCHAR(191) NOT NULL PRIMARY KEY, completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB');
    const [lock] = await client.execute('SELECT GET_LOCK(?, 20) AS acquired', [key]);
    locked = Number(lock[0]?.acquired) === 1;
    if (!locked) throw new Error('Another worker is running the database startup migration; retrying shortly');
    const [done] = await client.execute('SELECT migration_name FROM `_humaeli_migrations` WHERE migration_name = ?', [name]);
    if (done.length && !force) return { skipped: true };
    await action();
    await client.execute('INSERT INTO `_humaeli_migrations` (migration_name) VALUES (?) ON DUPLICATE KEY UPDATE completed_at = CURRENT_TIMESTAMP', [name]);
    return { skipped: false };
  } finally {
    try { if (locked) await client.execute('SELECT RELEASE_LOCK(?)', [key]); }
    finally { await client.end(); }
  }
}
