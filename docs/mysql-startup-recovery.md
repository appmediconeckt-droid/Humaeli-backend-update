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
