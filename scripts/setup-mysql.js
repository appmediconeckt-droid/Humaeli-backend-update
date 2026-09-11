import 'dotenv/config';
import mysql from 'mysql2/promise';
import { mysqlConfig } from '../src/persistence/mysqlDriver.js';
import connectDB from '../src/config/db.js';
import mongoose from '../src/persistence/mongoose.js';

const { database, connectionLimit, ...options } = mysqlConfig();
let connection;
try {
  connection = await mysql.createConnection(options);
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
  await connection.end(); connection = null;
  await connectDB();
  console.log(`Database ${database} and all model tables are ready.`);
} catch (error) {
  console.error(`MySQL setup failed: ${error.code || error.message}`);
  process.exitCode = 1;
} finally { await connection?.end(); await mongoose.disconnect(); }
