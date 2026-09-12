// Keep schema validation, hooks, populate and API IDs while persisting in MySQL.
// Import this module instead of mongoose throughout application code.
import mongoose from 'mongoose';
import driver from './mysqlDriver.js';

mongoose.setDriver(driver);
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

// Mongoose supplies schemas/hooks; the installed driver opens a mysql2 pool.
// The URI is only a driver label. Credentials are passed as structured options.
export async function connectMySQL(config) {
  await mongoose.connect('mysql://storage', { mysql: config });
  return mongoose.connection;
}

export default mongoose;
