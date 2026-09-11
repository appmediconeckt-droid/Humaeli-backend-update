import 'dotenv/config';
import dns from 'node:dns';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import mongoose from '../src/persistence/mongoose.js';
import connectDB from '../src/config/db.js';

const dryRun = process.argv.includes('--dry-run');
const resumeIndex = process.argv.indexOf('--resume-from');
const resumeDirectory = resumeIndex >= 0 ? process.argv[resumeIndex + 1] : null;
const uri = process.env.MONGO_MIGRATION_URI || process.env.MONGO_URI || process.env.MONGODB_URI;
const { BSON, MongoClient } = mongoose.mongo;
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
};
const encoded = doc => JSON.stringify(canonical(BSON.EJSON.serialize(doc, { relaxed: false })));
const digest = docs => createHash('sha256').update(docs.map(encoded).sort().join('\n')).digest('hex');
const equal = (a, b) => encoded(a) === encoded(b);
let source, session;
try {
  if (!uri) throw new Error('Set MONGO_MIGRATION_URI (or existing MONGO_URI) for the source');
  if (process.env.MONGO_DNS_SERVERS) dns.setServers(process.env.MONGO_DNS_SERVERS.split(',').map(value => value.trim()));
  source = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await source.connect();
  // Atlas supports a single point-in-time view across all collections. Keep
  // copying this view even if live session heartbeats continue during import.
  session = source.startSession({ snapshot: true });
  await connectDB();
  const db = source.db();
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).filter(item => !item.name.startsWith('system.')).sort((a, b) => a.name.localeCompare(b.name));
  const snapshots = [];
  // Preflight every collection before importing any documents.
  for (const { name } of collections) {
    const docs = await db.collection(name).find({}, { session }).toArray();
    if (!docs.length && !Object.values(mongoose.models).some(model => model.collection.name === name)) {
      console.log(`${name}: unused empty legacy collection skipped`);
      continue;
    }
    const target = mongoose.connection.db.collection(name);
    const existing = new Map((await target.read(undefined, undefined, true)).map(doc => [String(doc._id), doc]));
    const baseline = resumeDirectory ? new Map(BSON.EJSON.parse(await readFile(resolve(resumeDirectory, `${name}.ejson`), 'utf8')).map(doc => [String(doc._id), doc])) : new Map();
    const sourceIds = new Set(docs.map(doc => String(doc._id)));
    for (const [id, prior] of baseline) if (!sourceIds.has(id) && existing.has(id) && !equal(existing.get(id), prior)) throw new Error(`Deletion conflict in ${name}, ID ${id}; no source data imported`);
    for (const doc of docs) if (existing.has(String(doc._id)) && !equal(existing.get(String(doc._id)), doc) && !(baseline.has(String(doc._id)) && equal(existing.get(String(doc._id)), baseline.get(String(doc._id))))) {
      throw new Error(`Conflicting target document in ${name}, ID ${doc._id}; no source data imported`);
    }
    const indexes = await db.collection(name).indexes();
    snapshots.push({ name, docs, indexes, baseline, hash: digest(docs) });
    console.log(`${name}: source=${docs.length}, target=${existing.size}`);
  }
  if (dryRun) console.log('Preflight complete. No source documents imported. Pause source writes before running without --dry-run.');
  else {
    const backup = resolve('.migration-backups', new Date().toISOString().replace(/[:.]/g, '-'));
    await mkdir(backup, { recursive: true });
    for (const snapshot of snapshots) {
      // Collection identifiers were validated by the MySQL adapter above.
      await writeFile(resolve(backup, `${snapshot.name}.ejson`), BSON.EJSON.stringify(snapshot.docs, { relaxed: false }), { flag: 'wx', mode: 0o600 });
    }
    const manifest = { startedAt: new Date().toISOString(), target: mongoose.connection.name, snapshotTime: session.snapshotTime?.toString(), verified: false, collections: snapshots.map(({ name, docs, hash, indexes }) => ({ name, count: docs.length, sha256: hash, indexes })) };
    await writeFile(resolve(backup, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    // Detect a changing source before writes. Verification below detects changes
    // during the import too; a successful report is required before cutover.
    for (const item of snapshots) if (digest(await db.collection(item.name).find({}, { session }).toArray()) !== item.hash) throw new Error(`Source snapshot changed for ${item.name}`);
    for (const item of snapshots) {
      const target = mongoose.connection.db.collection(item.name);
      const result = await target.importDocuments(item.docs, equal, item.baseline);
      // Preserve indexes on legacy collections too. Schema indexes take priority
      // for known models (e.g. corrected partial phone uniqueness).
      const existingIndexes = new Set((await target.indexes()).map(index => index.name));
      for (const { key, v, ns, ...options } of item.indexes) {
        if (!existingIndexes.has(options.name)) await target.createIndex(key, options);
      }
      console.log(`${item.name}: inserted=${result.inserted}, already-identical=${result.skipped}, refreshed-from-prior-import=${result.refreshed}, removed-since-prior-import=${result.removed}`);
    }
    for (const item of snapshots) {
      const current = await db.collection(item.name).find({}, { session }).toArray();
      if (digest(current) !== item.hash) throw new Error(`Source ${item.name} changed during import; verification failed. Keep source paused and reconcile before cutover.`);
      const ids = new Set(item.docs.map(doc => String(doc._id)));
      const copied = (await mongoose.connection.db.collection(item.name).read(undefined, undefined, true)).filter(doc => ids.has(String(doc._id)));
      if (digest(copied) !== item.hash) throw new Error(`Content verification failed for ${item.name}`);
    }
    manifest.verified = true; manifest.completedAt = new Date().toISOString();
    await writeFile(resolve(backup, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    console.log(`Verified snapshot: ${snapshots.reduce((sum, item) => sum + item.docs.length, 0)} documents across ${snapshots.length} collections. Backup: ${backup}`);
    console.log('This is a point-in-time copy. Stop writes to the old backend and perform a final resume before production cutover.');
  }
} catch (error) {
  console.error(`Migration failed: ${String(error.message).replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, '[redacted URI]')}`);
  console.error('Source data was not changed. A failed import may leave copied collections; identical records are safe to resume.');
  process.exitCode = 1;
} finally { await session?.endSession(); await source?.close(); await mongoose.disconnect(); }
