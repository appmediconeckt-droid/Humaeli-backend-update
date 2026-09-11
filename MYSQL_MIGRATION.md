# MySQL schema matching the models

`humaeli` now uses one SQL column for each top-level model field.

| Table | Top-level model columns |
| --- | ---: |
| users | 70 |
| transactions | 22 |
| calls | 38 |
| messages | 16 |
| prescriptions | 17 |
| payouts | 26 |
| supporttickets | 18 |

Columns follow the requested Compass display order for users: `id`, `fullName`,
`email`, `anonymous`, `phoneNumber`, `phoneCountryCode`, `password`, and so on.
Optional fields absent from the supplied document follow at the end. Other tables
follow model declaration order. Run `npm run db:order-columns` to apply this order
on another installation; schema verification checks order as well as names.

`users` has exactly 70 columns, including `id` (the SQL name for MongoDB `_id`),
`createdAt`, `updatedAt` and `__v`. `fullName`, `email`, `phoneNumber`,
`walletBalance`, etc. are ordinary columns. Nested objects such as `address`,
`profilePhoto`, `payoutAccount` and `locationData` each have one JSON column, just
as each is one top-level model field. Arrays and Mixed fields also use their own
JSON column. There are no `address_city`-style flattened columns and no whole-row
`document` column.

The earlier 125-column users layout expanded nested properties. It has been
replaced to match the requested top-level schema. Compass can show only fields
present in a particular document, while the SQL schema includes every declared
model field, including optional fields.

The `ratings` table is shared by Rating and Review, so it contains the union of
both schemas (15 columns). Re-exported model aliases use their existing shared
tables. Populated legacy collections without a current model retain their
observed top-level fields; no populated legacy data was discarded.

## Run and verify

Start MySQL in XAMPP, then:

```powershell
npm install
npm run db:setup
npm run db:verify-schema
npm start
```

`db:verify-schema` compares every modeled table's actual column names against the
model schemas and exits unsuccessfully for any missing or extra column. It reads
only schema metadata. It reports `users: 70/70 model columns OK`.

Connection settings remain in private `.env`: `MYSQL_HOST`, `MYSQL_PORT`,
`MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_DATABASE=humaeli`. Existing JWT, email,
payment and other settings are preserved. `/api/health` reports the active DB.

Mongoose remains for validation, defaults, hooks, population and compatibility
with existing application queries. The driver uses mysql2 for SQL persistence.
Scalar fields use native text, numeric, boolean, date and reference types. Dates
retain milliseconds in UTC. Safe scalar queries use SQL WHERE predicates and
secondary indexes. Complex expressions and aggregations use the compatibility
evaluator. Uniqueness remains enforced inside locked write transactions; direct
SQL writers must respect application constraints. Legacy references do not have
foreign-key constraints, and arrays are not split into child tables.

Internal `_humaeli_*` tables hold schema/index definitions and row metadata.
Missing-versus-null state and legacy fields outside a known model are retained in
`_humaeli_row_state`, so application tables have exactly their model columns.
There is no technical `_sql_state` column in those application tables. These
internal records should not be deleted when browsing or editing the database.

## Current verified conversion

On 2026-09-11, **2,376 current MySQL records** were converted and verified using
full-content SHA-256 comparisons. All 30 populated/model/legacy business tables
now use top-level columns. Changes made locally after the original MongoDB import
were preserved.

The previous tables remain in this backup database:

```
humaeli_schema_backup_20260911120758200
```

The verified manifest, old/new column mappings and BSON-preserving data backups:

```
.migration-backups/columns-20260911120758200/
```

Earlier conversion and MongoDB import backups are also retained. Backup files
contain private data and are excluded from Git. Empty unused `feedbacks`, `reviews`
and `withdrawalrequests` were archived during the earlier conversion; the active
Review model uses `ratings`.

To convert another installation from either the old document layout or the
flattened nested-column layout:

```powershell
# Stop its backend and close other connections to that database first.
npm run db:columns -- --dry-run
npm run db:columns
npm run db:setup
npm run db:verify-schema
npm start
```

Replacement tables are built and fully verified before publishing. Original
tables remain in a separate backup database. A successful rerun is a no-op. If
conversion fails, retain its backups, manifest and temporary tables for recovery;
do not discard them or run the old backend against a partially changed schema.

## MongoDB source

The original MongoDB source was not modified. Its earlier import was a
point-in-time copy; this column conversion preserves current MySQL data and does
not synchronize a still-running remote MongoDB backend. Pause source writes and
reconcile before a remote production cutover. Do not overwrite newer MySQL data
with an old MongoDB snapshot.

The explicit import command still supports safe, conflict-detecting resumes:

```powershell
npm run db:migrate -- --dry-run
npm run db:migrate
npm run db:migrate -- --resume-from .migration-backups/<prior-mongo-snapshot>
```

Set `MONGO_MIGRATION_URI` or retain `MONGO_URI` only for this command. It requires
a source supporting snapshot sessions. `MONGO_DNS_SERVERS=8.8.8.8,1.1.1.1` can be
used if local SRV DNS resolution needs an override. Unknown empty legacy
collections are skipped rather than recreating schema-less tables.

## Tests

The full suite passed **113 tests**; two optional frontend checks were skipped
because the sibling frontend projects are absent. Validation uses local XAMPP
MariaDB 10.4.32, a MySQL-compatible server; Oracle MySQL 8 was not separately run.

Tests cover exact top-level column sets, a 70-column users conversion, both old
storage formats, full data preservation (including legacy fields), backup tables,
idempotent conversion, direct SQL edits, IDs/dates, population, unique rollback,
concurrent wallet debits, array updates, aggregation, expiry and safe import resume.

Ordinary `npm test` skips DB integration without an explicit test database:

```powershell
$env:MYSQL_DATABASE = 'humaeli_test_local'
$env:MYSQL_TEST_DATABASE = 'humaeli_test_local'
npm run db:setup
npm test
Remove-Item Env:MYSQL_DATABASE
Remove-Item Env:MYSQL_TEST_DATABASE
```

Use a new isolated database if an older test database still has the obsolete
layout, or convert that test database with `db:columns` first. `test:mysql` requires
`MYSQL_TEST_DATABASE=humaeli_test_<name>` and runs the focused storage suite.
SMTP tests are isolated from real mail transport.
