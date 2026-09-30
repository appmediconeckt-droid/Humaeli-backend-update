import modelStorage, { connectMySQL } from '../persistence/mongoose.js';
import { mysqlConfig } from '../persistence/mysqlDriver.js';
import { loadModels } from '../persistence/models.js';
import { initQueueTables } from '../services/initQueueTables.js';
import { quote } from '../persistence/columns.js';

let connecting;
const phoneIndexPattern = /^\+?\d{7,15}$/;

function generatedLegacyChatId(chat, used) {
  const rawTime = chat.startedAt || chat.createdAt || chat.updatedAt;
  const date = rawTime instanceof Date ? rawTime : new Date(rawTime || Date.now());
  const timestamp = Number.isFinite(date.getTime()) ? date.getTime() : Date.now();
  const base = `chat_${timestamp}_${String(chat._id).slice(-12) || Math.random().toString(36).slice(2, 11)}`;
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function generatedLegacyMessageId(message, used) {
  const rawTime = message.createdAt || message.updatedAt;
  const date = rawTime instanceof Date ? rawTime : new Date(rawTime || Date.now());
  const timestamp = Number.isFinite(date.getTime()) ? date.getTime() : Date.now();
  const base = `msg_${timestamp}_${String(message._id).slice(-12) || Math.random().toString(36).slice(2, 11)}`;
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function repairLegacyChatIds() {
  const Chat = modelStorage.models.Chat;
  if (!Chat) return;

  const collection = modelStorage.connection.db.collection(Chat.collection.name);
  await collection.mutate((chats) => {
    let repaired = 0;
    const used = new Set();
    const normalized = chats
      .map((chat) => ({ chat }))
      .sort((left, right) => {
        const leftTime = left.chat.startedAt instanceof Date ? left.chat.startedAt.getTime() : Number.MAX_SAFE_INTEGER;
        const rightTime = right.chat.startedAt instanceof Date ? right.chat.startedAt.getTime() : Number.MAX_SAFE_INTEGER;
        if (leftTime !== rightTime) return leftTime - rightTime;
        return String(left.chat._id).localeCompare(String(right.chat._id));
      });

    for (const { chat } of normalized) {
      const value = typeof chat.chatId === 'string' ? chat.chatId.trim() : '';
      if (value && !used.has(value)) {
        if (chat.chatId !== value) {
          chat.chatId = value;
          repaired += 1;
        }
        used.add(value);
        continue;
      }

      chat.chatId = generatedLegacyChatId(chat, used);
      used.add(chat.chatId);
      repaired += 1;
    }

    return { repaired };
  }).then(({ repaired }) => {
    if (repaired) {
      console.warn(`Repaired ${repaired} legacy chatId value(s) before creating chat indexes.`);
    }
  });
}

async function repairLegacyMessageIds() {
  const Message = modelStorage.models.Message;
  if (!Message) return;

  const collection = modelStorage.connection.db.collection(Message.collection.name);
  await collection.mutate((messages) => {
    let repaired = 0;
    const used = new Set();
    const normalized = messages
      .map((message) => ({ message }))
      .sort((left, right) => {
        const leftTime = left.message.createdAt instanceof Date ? left.message.createdAt.getTime() : Number.MAX_SAFE_INTEGER;
        const rightTime = right.message.createdAt instanceof Date ? right.message.createdAt.getTime() : Number.MAX_SAFE_INTEGER;
        if (leftTime !== rightTime) return leftTime - rightTime;
        return String(left.message._id).localeCompare(String(right.message._id));
      });

    for (const { message } of normalized) {
      const value = typeof message.messageId === 'string' ? message.messageId.trim() : '';
      if (value && !used.has(value)) {
        if (message.messageId !== value) {
          message.messageId = value;
          repaired += 1;
        }
        used.add(value);
        continue;
      }

      message.messageId = generatedLegacyMessageId(message, used);
      used.add(message.messageId);
      repaired += 1;
    }

    return { repaired };
  }).then(({ repaired }) => {
    if (repaired) {
      console.warn(`Repaired ${repaired} legacy messageId value(s) before creating message indexes.`);
    }
  });
}

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

async function repairLegacyProfileQrUrlColumn(connection = modelStorage.connection) {
  const db = connection?.db;
  if (!db?.pool) return;

  const [mappingRows] = await db.pool.execute(
    'SELECT definition FROM `_humaeli_columns` WHERE collection_name = ?',
    ['users'],
  );
  if (!mappingRows.length) return;

  const fields = typeof mappingRows[0].definition === 'string'
    ? JSON.parse(mappingRows[0].definition)
    : mappingRows[0].definition;
  const field = fields.find(item => item.path === 'profileQrUrl');
  if (!field) return;

  let changed = false;
  const column = field.column || 'profileQrUrl';
  const [tables] = await db.pool.execute(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    ['users'],
  );
  if (!tables.length) return;
  const [columns] = await db.pool.execute(
    'SELECT DATA_TYPE AS dataType FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    ['users', column],
  );

  if (!columns.length) {
    await db.pool.query(`ALTER TABLE ${quote('users')} ADD COLUMN ${quote(column)} LONGTEXT NULL`);
    changed = true;
  } else if (columns[0].dataType?.toLowerCase() === 'json') {
    const temporaryColumn = `${column}_text_repair`;
    const [temporaryColumns] = await db.pool.execute(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      ['users', temporaryColumn],
    );
    if (temporaryColumns.length) {
      await db.pool.query(`ALTER TABLE ${quote('users')} DROP COLUMN ${quote(temporaryColumn)}`);
    }
    await db.pool.query(`ALTER TABLE ${quote('users')} ADD COLUMN ${quote(temporaryColumn)} LONGTEXT NULL`);
    await db.pool.query(
      `UPDATE ${quote('users')} SET ${quote(temporaryColumn)} = CASE ` +
        `WHEN ${quote(column)} IS NULL THEN NULL ` +
        `WHEN JSON_TYPE(${quote(column)}) = 'STRING' THEN JSON_UNQUOTE(${quote(column)}) ` +
        `ELSE CAST(${quote(column)} AS CHAR) END`,
    );
    await db.pool.query(`ALTER TABLE ${quote('users')} DROP COLUMN ${quote(column)}`);
    await db.pool.query(`ALTER TABLE ${quote('users')} CHANGE ${quote(temporaryColumn)} ${quote(column)} LONGTEXT NULL`);
    changed = true;
  } else if (columns.length && columns[0].dataType?.toLowerCase() !== 'longtext') {
    await db.pool.query(`ALTER TABLE ${quote('users')} MODIFY ${quote(column)} LONGTEXT NULL`);
    changed = true;
  }

  if (field.kind !== 'string') {
    field.kind = 'string';
    changed = true;
  }

  if (changed) {
    await db.pool.execute(
      'UPDATE `_humaeli_columns` SET definition = ? WHERE collection_name = ?',
      [JSON.stringify(fields), 'users'],
    );
    console.warn('Repaired legacy users.profileQrUrl MySQL column mapping.');
  }
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
      console.log('MySQL transport connected; validating application schema.');
      await repairLegacyProfileQrUrlColumn(connection);
      // Install constraints before accepting requests; no background index races.
      for (const model of Object.values(modelStorage.models)) {
        if (process.env.MYSQL_STARTUP_DEBUG === 'true') console.log(`MySQL startup: collection ${model.modelName}`);
        await model.createCollection();
      }
      console.log('MySQL tables ready; checking legacy chat/message IDs.');
      await repairLegacyChatIds();
      await repairLegacyMessageIds();
      if (process.env.MYSQL_REPAIR_DUPLICATE_USER_PHONES === 'true') {
        await repairLegacyUserPhoneNumbers();
      }
      for (const model of Object.values(modelStorage.models)) {
        if (process.env.MYSQL_STARTUP_DEBUG === 'true') console.log(`MySQL startup: indexes ${model.modelName}`);
        await createModelIndexes(model);
      }
      console.log('MySQL model indexes ready; initializing queue tables.');
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
