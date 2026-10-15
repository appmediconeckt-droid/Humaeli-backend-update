# MySQL startup and imported databases

The application stores data in MySQL through `mysql2`. The Mongoose package is
used for existing schemas, validation, hooks and model APIs; its connection driver
is replaced by `src/persistence/mysqlDriver.js`. No MongoDB server is required.

## Missing column metadata

`Table users has no column mapping` means the MySQL table exists but its entry in
`_humaeli_columns` is missing. A successful TCP connection or `SELECT 1` does not
establish that application initialization has completed.

Startup now recovers missing metadata from registered model schemas and matching
physical SQL columns. Recovery requires a string `id` primary key and compatible
field types. It uses a MySQL advisory lock to serialize concurrent workers,
preserves existing rows and extra native SQL columns, and adds missing model
columns without replacing tables. Unknown or incompatible layouts still require
an explicit migration; they are never silently overwritten.

Back up and restore all application tables **and** `_humaeli_columns`,
`_humaeli_indexes`, `_humaeli_locks`, and `_humaeli_row_state`. Row-state metadata
preserves absent/null distinctions and legacy fields and cannot always be
reconstructed from physical columns alone. Legacy `document` or `_sql_state`
table layouts still use the backed-up offline `npm run db:columns` migration.

## Deployment checks

- Set the MySQL connection variables in the backend deployment. A local `.env`
  change does not update Railway's environment.
- Run `npm start` with `NODE_ENV=production`. `npm run dev` watches source files
  and intentionally restarts the process after edits; use it only for development.
- Configure the deployment readiness/health check as `/api/health` with a startup
  grace period of at least 300 seconds for a new/imported database. Keep the old
  healthy instance serving traffic until the replacement is ready.
- Restart/redeploy the backend after updating code. An already-running Node
  process continues to use its loaded driver.
- Verify `/api/health` returns HTTP 200 with `db.engine: "mysql"` and
  `db.state: "connected"`; verify `/api/db-test` also succeeds.
- For local devtunnels, forward the actual backend `PORT`. A tunnel ending in
  `-5000.inc1.devtunnels.ms` must forward port 5000; forwarding 5000 while the
  backend listens on 5001 will not reach that backend.

The regression suites `mysqlColumnMapping.test.js`,
`mysqlColumnRecovery.integration.test.js` and `mysqlStorage.integration.test.js`
cover restored metadata, preserved data, reconnects, IDs, query operations and
concurrent wallet updates. Integration tests require a separate
`MYSQL_TEST_DATABASE=humaeli_test_<name>`; never point them at the live database.

## Restart time and runtime recovery

Legacy chat/message identifier repairs are checkpointed in `_humaeli_migrations`.
The marker is written only after both repairs succeed, under a dedicated advisory
lock. Subsequent startups skip the full record scans. Back up this table too. If
old chat/message records are imported later, set `MYSQL_REPAIR_LEGACY_IDS=true`
for one controlled restart, then remove it. Table and index validation still run
before readiness; independent models initialize in bounded batches of up to four.
Ordinary nonunique index initialization no longer reads the entire collection.
Unique indexes still validate existing records before accepting traffic.

Both MySQL pools use TCP keepalive, 30-second idle cleanup and a bounded waiting
queue (`MYSQL_QUEUE_LIMIT=100` by default). Budget connections for **two pools per
backend worker**, plus a temporary migration connection. Set
`MYSQL_CONNECTION_LIMIT` according to your database capacity and replica count.

After startup the server probes both pools every 15 seconds. A failed/slow probe
marks readiness unhealthy; a successful later probe restores it automatically.
Concurrent probes are suppressed. Closed pooled connections are replaced by
mysql2; the application does not replay writes, payments or transactions whose
commit status is uncertain. An actual database/network outage can still cause
503 responses; readiness routing, database uptime and deployment configuration
remain necessary.

The Vercel entry point also retries initialization on later requests after a failed
cold start, and probes warm instances on incoming requests. It does not depend on
background timers being scheduled by the serverless runtime. For this app's live
Socket.IO queues and persistent background jobs, deploy the backend as a long
running service with readiness routing; the frontend can be hosted separately.

`databaseRecovery.test.js` covers simulated outage/recovery, probe timeouts,
bounded startup concurrency and migration checkpoints. The opt-in
`databaseRecovery.integration.test.js` creates a **new** isolated test database,
kills only its own pooled connection, verifies subsequent reads/writes and removes
that test database afterward. It refuses an existing database name.
