import 'dotenv/config';
import mongoose, { connectMySQL } from '../src/persistence/mongoose.js';
import { mysqlConfig } from '../src/persistence/mysqlDriver.js';
import Appointment from '../src/models/appointmentModel.js';

// Uses the existing column mapping/schema machinery (including its DDL lock).
// Idempotent; existing records are preserved and new columns are nullable.
try {
  await connectMySQL(mysqlConfig());
  await mongoose.connection.db.ensureColumns(Appointment.collection.name);
  console.log('Appointment cancellation audit columns ready.');
} catch (error) {
  console.error('Appointment lateness migration failed:', error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
