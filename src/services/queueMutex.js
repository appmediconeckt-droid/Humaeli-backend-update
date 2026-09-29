import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import { mysqlConfig } from '../persistence/mysqlDriver.js';

export async function withQueueMutex(facilityId, doctorId, date, action) {
  const { connectionLimit, ...config } = mysqlConfig();
  const key = 'queue:' + createHash('sha256').update(`${config.database}:${facilityId}:${doctorId}:${date}`).digest('hex').slice(0, 55);
  const connection = await mysql.createConnection(config);
  let acquired = false;
  try {
    const [result] = await connection.query('SELECT GET_LOCK(?,15) AS acquired', [key]);
    acquired = Number(result[0].acquired) === 1;
    if (!acquired) throw Object.assign(new Error('Queue is busy; please retry'), { statusCode: 503 });
    return await action(connection);
  } finally {
    try { if (acquired) await connection.query('SELECT RELEASE_LOCK(?)', [key]); }
    finally { await connection.end(); }
  }
}
