import modelStorage, { connectMySQL } from '../persistence/mongoose.js';
import { mysqlConfig } from '../persistence/mysqlDriver.js';
import { loadModels } from '../persistence/models.js';
import { initQueueTables } from '../services/initQueueTables.js';

let connecting;
const phoneIndexPattern = /^\+?\d{7,15}$/;

function phoneRepairRank(user) {
  return [
    user.isActive === false ? 1 : 0,
    user.profileCompleted ? 0 : 1,
    user.password ? 0 : 1,
    user.createdAt instanceof Date ? user.createdAt.getTime() : Number.MAX_SAFE_INTEGER,
    String(user._id),
  ];
}

function comparePhoneRepairRank(left, right) {
  const a = phoneRepairRank(left);
  const b = phoneRepairRank(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
}

async function repairLegacyUserPhoneNumbers() {
  const User = modelStorage.models.User;
  if (!User) return;
  const collection = modelStorage.connection.db.collection(User.collection.name);
  await collection.mutate((users) => {
    let invalid = 0;
    let duplicate = 0;
    const byPhone = new Map();

    for (const user of users) {
      if (user.phoneNumber === undefined || user.phoneNumber === null) continue;
      const phone = String(user.phoneNumber).trim();
      if (!phoneIndexPattern.test(phone)) {
        delete user.phoneNumber;
        invalid += 1;
        continue;
      }
      if (phone !== user.phoneNumber) user.phoneNumber = phone;
      const matches = byPhone.get(phone) || [];
      matches.push(user);
      byPhone.set(phone, matches);
    }

    for (const matches of byPhone.values()) {
      if (matches.length < 2) continue;
      matches.sort(comparePhoneRepairRank);
      for (const user of matches.slice(1)) {
        delete user.phoneNumber;
        duplicate += 1;
      }
    }

    return { invalid, duplicate };
  }).then(({ invalid, duplicate }) => {
    if (invalid || duplicate) {
      console.warn(`Repaired legacy user phone data before indexes: removed ${invalid} invalid and ${duplicate} duplicate phoneNumber value(s).`);
    }
  });
}

function isDuplicatePhoneIndexError(error) {
  return error?.code === 11000 && (
    error?.keyPattern?.phoneNumber ||
    /unique index phoneNumber_1/i.test(error?.message || '')
  );
}

async function createModelIndexes(model) {
  try {
    await model.createIndexes();
  } catch (error) {
    if (model.modelName === 'User' && isDuplicatePhoneIndexError(error)) {
      await model.collection.dropIndex('phoneNumber_1').catch(() => {});
      console.warn(
        'Skipped dirty legacy users.phoneNumber_1 index so MySQL can start. ' +
          'Clean duplicate user phoneNumber values, then restart with MYSQL_REPAIR_DUPLICATE_USER_PHONES=true once to recreate the unique index.',
      );
      return;
    }
    throw error;
  }
}

function connectionDetails(connection = modelStorage.connection) {
  const config = mysqlConfig();
  return {
    database: connection.name || config.database,
    host: connection.host || config.host,
    port: connection.port || config.port,
  };
}

export async function verifyMySQLConnection(connection = modelStorage.connection) {
  if (!connection || connection.readyState !== 1 || !connection.db) {
    throw new Error('MySQL connection is not ready');
  }

  // Routed through the installed custom MySQL driver; SQLDatabase.command()
  // executes SELECT 1 on the existing mysql2 pool.
  await connection.db.command({ ping: 1 });
  return connectionDetails(connection);
}

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
      }
      if (process.env.MYSQL_REPAIR_DUPLICATE_USER_PHONES === 'true') {
        await repairLegacyUserPhoneNumbers();
      }
      for (const model of Object.values(modelStorage.models)) {
        await createModelIndexes(model);
      }
      await initQueueTables();
      const details = await verifyMySQLConnection(connection);
      console.log('✅ MySQL connected successfully');
      console.log(`Database: ${details.database}`);
      console.log(`Host: ${details.host}${details.port ? `:${details.port}` : ''}`);
      return connection;
    } catch (error) {
      await modelStorage.disconnect().catch(() => {});
      throw error;
    } finally { connecting = null; }
  })();
  return connecting;
}
