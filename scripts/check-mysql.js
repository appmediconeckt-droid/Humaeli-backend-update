import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { mysqlConfig } from '../src/persistence/mysqlDriver.js';
import { databaseFailureDetails } from '../src/config/databaseStartup.js';

dotenv.config({ quiet: true });
if (process.env.DOTENV_PATH) {
  dotenv.config({ path: process.env.DOTENV_PATH, override: true, quiet: true });
}

let pool;
try {
  pool = mysql.createPool(mysqlConfig());
  await pool.query('SELECT 1');
  console.log('MySQL connection and authentication succeeded. Schema was not modified.');
} catch (error) {
  console.error(databaseFailureDetails(error));
  process.exitCode = 1;
} finally {
  await pool?.end();
}
