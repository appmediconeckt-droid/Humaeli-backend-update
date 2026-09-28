import modelStorage, { connectMySQL } from '../persistence/mongoose.js';
import { mysqlConfig } from '../persistence/mysqlDriver.js';
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
  if (modelStorage.connection.readyState === 1) return modelStorage.connection;
  connecting = (async () => {
    try {
      // Reads MYSQL_HOST/PORT/USER/PASSWORD/DATABASE, provider aliases or MYSQL_URL.
      // connectMySQL uses the custom mysql2 driver shared by all application models.
      const config = mysqlConfig();
      await loadModels();
      const connection = await connectMySQL(config);
      // Install constraints before accepting requests; no background index races.
      for (const model of Object.values(modelStorage.models)) {
        await model.createCollection();
        await model.createIndexes();
      }
      console.log(`MySQL connected: ${connection.name}`);
      return connection;
    } catch (error) {
      await modelStorage.disconnect().catch(() => {});
      throw error;
    } finally { connecting = null; }
  })();
  return connecting;
}
