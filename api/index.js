// api/index.js
// Vercel serverless entry point
import 'dotenv/config';

import connectDB, { verifyMySQLConnection } from "../src/config/db.js";
import { app } from "../src/app.js";
import { getPool } from '../src/config/mysql.js';
import { createDatabaseRequestGate } from '../src/config/databaseRequestGate.js';
import { databaseFailureDetails } from '../src/config/databaseStartup.js';

const ensureDatabase = createDatabaseRequestGate({
  initialize: connectDB,
  probe: async connection => {
    await verifyMySQLConnection(connection);
    await getPool().query({ sql: 'SELECT 1', timeout: 5000 });
  },
});

export default async function handler(req, res) {
  try {
    await ensureDatabase();
    app.locals.databaseReady = true;
    app.locals.databaseLastError = null;
  } catch (error) {
    app.locals.databaseReady = false;
    app.locals.databaseLastError = databaseFailureDetails(error);
    console.error(`MySQL request initialization failed: ${app.locals.databaseLastError}`);
    res.setHeader('Retry-After', '5');
    return res.status(503).json({ success: false, code: 'DATABASE_UNAVAILABLE', message: 'Database is temporarily unavailable. Please try again shortly.' });
  }
  return app(req, res);
}
