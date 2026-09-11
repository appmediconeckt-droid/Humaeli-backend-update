// Keep schema validation, hooks, populate and API IDs while persisting in MySQL.
// Import this module instead of mongoose throughout application code.
import mongoose from 'mongoose';
import driver from './mysqlDriver.js';

mongoose.setDriver(driver);
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

export default mongoose;
