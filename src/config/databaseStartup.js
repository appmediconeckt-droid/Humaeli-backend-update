// Do not register timers or run database jobs while the initial connection retries.
export async function runDatabaseTasks(items, task, concurrency = 4) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid database startup concurrency');
  for (let index = 0; index < items.length; index += concurrency) {
    // Finish every task in the batch before closing the pool on a failure.
    const results = await Promise.allSettled(items.slice(index, index + concurrency).map(task));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
}

export function createDatabaseStartup(connection, initialize) {
  let startup;
  return function start() {
    if (connection.readyState !== 1) {
      return Promise.reject(new Error('Database must be connected before starting background jobs'));
    }
    if (!startup) {
      startup = Promise.resolve().then(initialize).catch(error => {
        startup = null;
        throw error;
      });
    }
    return startup;
  };
}

export function databaseFailureDetails(error, env = process.env) {
  const causes = error.errors?.length ? error.errors : [error];
  const hints = {
    ENOTFOUND: 'Database hostname could not be resolved. Check MYSQL_HOST; a private hostname must be reachable from this deployment.',
    ECONNREFUSED: 'MySQL refused the connection. Check that MySQL is running and the host/port are correct.',
    ETIMEDOUT: 'MySQL connection timed out. Check database networking and firewall access.',
    ER_ACCESS_DENIED_ERROR: 'MySQL rejected the credentials. Check MYSQL_USER and MYSQL_PASSWORD.',
    ER_BAD_DB_ERROR: 'The configured MySQL database does not exist. Check MYSQL_DATABASE.',
  };
  const secrets = Object.entries(env)
    .filter(([key, value]) => value && /PASSWORD|PASS$|SECRET|TOKEN|API_KEY|MYSQL_URL/i.test(key))
    .map(([, value]) => value).sort((a, b) => b.length - a.length);
  return causes.map(cause => {
    const code = cause.code || error.code || error.name || 'Error';
    let message = hints[code] || cause.message || 'Database initialization failed';
    message = message.replace(/mysql:\/\/[^\s]+/gi, '[redacted database URL]');
    for (const secret of secrets) message = message.split(secret).join('[redacted]');
    return `${code}: ${message}`;
  }).join('; ');
}
