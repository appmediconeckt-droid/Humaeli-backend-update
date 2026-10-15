// Serverless runtimes may suspend timers. Recheck on requests rather than
// relying on an interval, and never cache a failed cold-start promise forever.
export function createDatabaseRequestGate({ initialize, probe, now = Date.now, intervalMs = 15000 }) {
  let pending, lastHealthy = null;
  return function ensureDatabase() {
    if (pending) return pending;
    if (lastHealthy !== null && now() - lastHealthy < intervalMs) return Promise.resolve();
    pending = Promise.resolve().then(initialize).then(probe).then(() => { lastHealthy = now(); })
      .catch(error => { lastHealthy = null; throw error; })
      .finally(() => { pending = null; });
    return pending;
  };
}
