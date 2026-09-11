import mongoose from '../persistence/mongoose.js';
import { loadModels } from '../persistence/models.js';

let connecting;
export default async function connectDB() {
  if (process.env.NODE_ENV === 'test') {
    if (!/^humaeli_test_[a-z0-9_]+$/.test(process.env.MYSQL_TEST_DATABASE || '')) {
      throw new Error('Database tests require MYSQL_TEST_DATABASE=humaeli_test_<name>');
    }
    process.env.MYSQL_DATABASE = process.env.MYSQL_TEST_DATABASE;
  }
  if (connecting) return connecting;
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  connecting = (async () => {
    try {
      await loadModels();
      await mongoose.connect('mysql://configured-by-environment');
      // Install constraints before accepting requests; no background index races.
      for (const model of Object.values(mongoose.models)) {
        await model.createCollection();
        await model.createIndexes();
      }
      console.log(`MySQL connected: ${mongoose.connection.name}`);
      return mongoose.connection;
    } catch (error) {
      await mongoose.disconnect().catch(() => {});
      throw error;
    } finally { connecting = null; }
  })();
  return connecting;
}
