# Humaeli backend

Express API with MySQL storage. Application entry point: `server.js`.

## Run

1. Run `npm ci` in this directory.
2. Copy `.env.example` to `.env` and supply your environment values.
3. Run `npm run dev` for development or `npm start` for normal startup.

The API port comes from `PORT`; the default is 5001. Use the same port in the frontend API URL.

## Maintained commands

- `npm test`: backend tests.
- `npm run db:check`: database connection check.
- `npm run db:setup`: initialize database tables.
- `npm run db:verify-schema`: check schema consistency.

Deployment and database recovery guidance is in `docs/`. Application code is in `src/`, regression tests in `test/`, and maintained database tools in `scripts/`.

## Railway database readiness

Deploy with this directory as the service root so `railway.json` configures
`/api/health` as the deployment health check (300-second startup allowance).
If using a different service root, select this configuration file explicitly in
Railway or set the same health check path in the service settings. The `/` route
is a diagnostic endpoint, not a readiness check.

For a backend and MySQL in the same Railway project/environment, reference the
database service's private variables. For a database service named `MySQL`:

```text
MYSQL_HOST=${{MySQL.MYSQLHOST}}
MYSQL_PORT=${{MySQL.MYSQLPORT}}
MYSQL_USER=${{MySQL.MYSQLUSER}}
MYSQL_PASSWORD=${{MySQL.MYSQLPASSWORD}}
MYSQL_DATABASE=${{MySQL.MYSQLDATABASE}}
```

Replace `MySQL` with the actual service name. Remove conflicting old database
variables: explicit `MYSQL_HOST`/`MYSQL_PORT` values override `MYSQL_URL`.
Local development needs the public TCP proxy address/port instead; Railway
private hostnames are not reachable from a local computer.

The runtime monitor retries read-only health probes every five seconds, bounds
each check to twelve seconds, and releases/destroys only its own connections on
cancellation. It does not retry writes or hide real database outages. If outages
continue, check Railway backend logs for `MySQL health check failed` or `MySQL
unavailable`, alongside MySQL restart/OOM and connection-limit events. Deployment
health checks do not continuously monitor a running service.

References: [Railway MySQL](https://docs.railway.com/databases/mysql),
[Railway health checks](https://docs.railway.com/deployments/healthchecks).
