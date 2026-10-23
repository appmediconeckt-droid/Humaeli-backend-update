// Probe only; never replay application writes after a connection error.
export function createDatabaseMonitor({ probe, onHealthy, onUnavailable, intervalMs = 5000, timeoutMs = 12000, timers = globalThis }) {
  let stopped = false, inFlight = null, interval;
  const check = () => {
    if (stopped) return Promise.resolve();
    if (inFlight) return inFlight.promise;
    const controller = new AbortController();
    const operation = { controller };
    let resolve;
    operation.promise = new Promise(done => { resolve = done; });
    inFlight = operation;
    const finish = error => {
      // Ignore late results from a timed-out probe after a new check starts.
      if (inFlight !== operation) return;
      timers.clearTimeout(operation.deadline);
      inFlight = null;
      if (!stopped) {
        if (error) onUnavailable(error);
        else onHealthy();
      }
      resolve();
    };
    operation.cancel = () => { controller.abort(); finish(); };
    operation.deadline = timers.setTimeout(() => {
      const error = Object.assign(new Error('Database health check timed out'), { code: 'ETIMEDOUT' });
      controller.abort(error);
      finish(error);
    }, timeoutMs);
    operation.deadline?.unref?.();
    Promise.resolve().then(() => probe(controller.signal)).then(() => finish(), finish);
    return operation.promise;
  };
  return {
    check,
    start() { if (!interval && !stopped) { interval = timers.setInterval(check, intervalMs); interval?.unref?.(); } return check(); },
    stop() { stopped = true; timers.clearInterval(interval); inFlight?.cancel(); },
  };
}

// Bound pool acquisition as well as the ping. Late connections are released;
// cancellation destroys only the connection owned by this read-only probe.
export function probeMySQLPool(pool, signal) {
  return new Promise((resolve, reject) => {
    let client, settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      if (error) client?.destroy();
      else client?.release();
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(signal.reason || new Error('Database probe cancelled'));
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => pool.getConnection()).then(connection => {
      if (settled) { connection.release(); return; }
      client = connection;
      return client.query({ sql: 'SELECT 1', timeout: 5000 }).then(() => finish(), finish);
    }).catch(finish);
  });
}
