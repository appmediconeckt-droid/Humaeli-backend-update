// Probe only; never replay application writes after a connection error.
export function createDatabaseMonitor({ probe, onHealthy, onUnavailable, intervalMs = 15000, timeoutMs = 10000, timers = globalThis }) {
  let stopped = false, inFlight = null, interval, deadline;
  const check = () => {
    if (stopped) return Promise.resolve();
    if (inFlight) return inFlight;
    deadline = timers.setTimeout(() => {
      if (!stopped) onUnavailable(Object.assign(new Error('Database health check timed out'), { code: 'ETIMEDOUT' }));
    }, timeoutMs);
    deadline?.unref?.();
    inFlight = Promise.resolve().then(probe).then(
      () => { if (!stopped) onHealthy(); },
      error => { if (!stopped) onUnavailable(error); },
    ).finally(() => { timers.clearTimeout(deadline); inFlight = null; });
    return inFlight;
  };
  return {
    check,
    start() { if (!interval && !stopped) { interval = timers.setInterval(check, intervalMs); interval?.unref?.(); } return check(); },
    stop() { stopped = true; timers.clearInterval(interval); timers.clearTimeout(deadline); },
  };
}
