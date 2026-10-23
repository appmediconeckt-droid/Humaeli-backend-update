import { expect } from 'chai';
import sinon from 'sinon';
import { createDatabaseMonitor, probeMySQLPool } from '../src/config/databaseMonitor.js';
import { runDatabaseMigration } from '../src/config/databaseMigration.js';
import { mysqlConfig } from '../src/persistence/mysqlDriver.js';
import { runDatabaseTasks } from '../src/config/databaseStartup.js';
import { createDatabaseRequestGate } from '../src/config/databaseRequestGate.js';

describe('Database runtime recovery', () => {
  let clock;
  beforeEach(() => { clock = sinon.useFakeTimers(); });
  afterEach(() => clock.restore());
  it('marks unavailable on a dropped connection and automatically restores readiness after a successful probe', async () => {
    const probe = sinon.stub().onFirstCall().rejects(Object.assign(new Error('connection lost'), { code: 'ECONNRESET' })).onSecondCall().resolves();
    const onHealthy = sinon.spy(), onUnavailable = sinon.spy();
    const monitor = createDatabaseMonitor({ probe, onHealthy, onUnavailable, intervalMs: 100, timeoutMs: 50 });
    await monitor.start();
    expect(onUnavailable.calledOnce).to.equal(true);
    expect(onHealthy.called).to.equal(false);
    await clock.tickAsync(100);
    expect(onHealthy.calledOnce).to.equal(true);
    monitor.stop();
  });
  it('recovers after a hung probe and ignores its late success', async () => {
    let resolve;
    const probe = sinon.stub().onFirstCall().returns(new Promise(done => { resolve = done; })).onSecondCall().resolves();
    const onHealthy = sinon.spy(), onUnavailable = sinon.spy();
    const monitor = createDatabaseMonitor({ probe, onHealthy, onUnavailable, intervalMs: 100, timeoutMs: 50 });
    const pending = monitor.start();
    await clock.tickAsync(50);
    await pending;
    expect(onUnavailable.calledOnce).to.equal(true);
    expect(probe.calledOnce).to.equal(true);
    expect(probe.firstCall.args[0].aborted).to.equal(true);
    await clock.tickAsync(50);
    expect(onHealthy.calledOnce).to.equal(true);
    resolve(); await clock.tickAsync(0);
    expect(onHealthy.calledOnce).to.equal(true);
    monitor.stop();
  });
  it('does not let late success clear a subsequent outage', async () => {
    let resolve;
    const probe = sinon.stub().onFirstCall().returns(new Promise(done => { resolve = done; })).onSecondCall().rejects(new Error('still down'));
    const onHealthy = sinon.spy(), onUnavailable = sinon.spy();
    const monitor = createDatabaseMonitor({ probe, onHealthy, onUnavailable, intervalMs: 100, timeoutMs: 50 });
    monitor.start();
    await clock.tickAsync(100);
    resolve(); await clock.tickAsync(0);
    expect(onUnavailable.calledTwice).to.equal(true);
    expect(onHealthy.called).to.equal(false);
    monitor.stop();
  });
  it('shares a probe between simultaneous checks', async () => {
    const probe = sinon.stub().resolves();
    const monitor = createDatabaseMonitor({ probe, onHealthy: sinon.spy(), onUnavailable: sinon.spy() });
    await Promise.all([monitor.check(), monitor.check()]);
    expect(probe.calledOnce).to.equal(true);
    monitor.stop();
  });
  it('stops scheduled probes and ignores an old result after shutdown', async () => {
    let resolve;
    const onHealthy = sinon.spy();
    const monitor = createDatabaseMonitor({ probe: () => new Promise(done => { resolve = done; }), onHealthy, onUnavailable: sinon.spy() });
    const pending = monitor.start();
    await clock.tickAsync(0); monitor.stop(); resolve(); await pending;
    await clock.tickAsync(60000);
    expect(onHealthy.called).to.equal(false);
    expect(clock.countTimers()).to.equal(0);
  });
});

describe('Cancellable MySQL health probes', () => {
  const connection = () => ({ query: sinon.stub().resolves(), release: sinon.spy(), destroy: sinon.spy() });
  it('returns the connection to the pool after a successful ping', async () => {
    const client = connection();
    await probeMySQLPool({ getConnection: async () => client }, new AbortController().signal);
    expect(client.release.calledOnce).to.equal(true);
    expect(client.destroy.called).to.equal(false);
  });
  it('releases a connection acquired after the deadline without querying it', async () => {
    const client = connection(), controller = new AbortController();
    let acquire;
    const pending = probeMySQLPool({ getConnection: () => new Promise(done => { acquire = done; }) }, controller.signal);
    await Promise.resolve();
    controller.abort(new Error('deadline'));
    await pending.catch(error => expect(error.message).to.equal('deadline'));
    acquire(client); await new Promise(done => setImmediate(done));
    expect(client.release.calledOnce).to.equal(true);
    expect(client.query.called).to.equal(false);
  });
  it('destroys a stuck probe connection on timeout without affecting application connections', async () => {
    const client = connection(), controller = new AbortController();
    client.query.returns(new Promise(() => {}));
    const pending = probeMySQLPool({ getConnection: async () => client }, controller.signal);
    await new Promise(done => setImmediate(done));
    controller.abort(new Error('deadline'));
    await pending.catch(error => expect(error.message).to.equal('deadline'));
    expect(client.destroy.calledOnce).to.equal(true);
    expect(client.release.called).to.equal(false);
  });
  it('propagates pool connection errors', async () => {
    const error = new Error('pool unavailable');
    let caught;
    try { await probeMySQLPool({ getConnection: async () => { throw error; } }); } catch (value) { caught = value; }
    expect(caught).to.equal(error);
  });
});

describe('Checkpointed legacy data repairs', () => {
  const config = { database: 'humaeli_test_recovery' };
  const fixture = (done = false, acquired = true) => {
    const client = { query: sinon.stub().resolves([]), end: sinon.stub().resolves() };
    client.execute = sinon.stub().callsFake(async sql => {
      if (sql.includes('GET_LOCK')) return [[{ acquired: acquired ? 1 : 0 }]];
      if (sql.startsWith('SELECT migration_name')) return [done ? [{ migration_name: 'repair-v1' }] : []];
      return [[]];
    });
    return { client, connect: sinon.stub().resolves(client) };
  };
  it('runs once and records success only after repairs finish', async () => {
    const { client, connect } = fixture(); const action = sinon.stub().resolves();
    await runDatabaseMigration(config, 'repair-v1', action, { connect });
    const insert = client.execute.getCalls().find(call => call.args[0].startsWith('INSERT'));
    expect(insert).to.exist;
    expect(action.calledBefore(insert)).to.equal(true);
    expect(client.end.calledOnce).to.equal(true);
  });
  it('skips full scans on subsequent startups', async () => {
    const { client, connect } = fixture(true); const action = sinon.spy();
    expect(await runDatabaseMigration(config, 'repair-v1', action, { connect })).to.deep.equal({ skipped: true });
    expect(action.called).to.equal(false);
    expect(client.end.calledOnce).to.equal(true);
  });
  it('does not mark failed repairs complete and always releases the dedicated lock connection', async () => {
    const { client, connect } = fixture();
    let error;
    try { await runDatabaseMigration(config, 'repair-v1', async () => { throw new Error('failed repair'); }, { connect }); } catch (caught) { error = caught; }
    expect(error.message).to.equal('failed repair');
    expect(client.execute.getCalls().some(call => call.args[0].startsWith('INSERT'))).to.equal(false);
    expect(client.execute.getCalls().some(call => call.args[0].includes('RELEASE_LOCK'))).to.equal(true);
    expect(client.end.calledOnce).to.equal(true);
  });
  it('does not run a repair when another worker owns its migration lock', async () => {
    const { client, connect } = fixture(false, false); const action = sinon.spy();
    let failed = false;
    try { await runDatabaseMigration(config, 'repair-v1', action, { connect }); } catch { failed = true; }
    expect(failed).to.equal(true); expect(action.called).to.equal(false); expect(client.end.calledOnce).to.equal(true);
  });
  it('allows explicit repair after restoring legacy data', async () => {
    const { connect } = fixture(true); const action = sinon.stub().resolves();
    await runDatabaseMigration(config, 'repair-v1', action, { connect, force: true });
    expect(action.calledOnce).to.equal(true);
  });
  it('uses bounded pool queues, keepalive and idle cleanup for both MySQL code paths', () => {
    const config = mysqlConfig({ MYSQL_CONNECTION_LIMIT: '10' });
    expect(config).to.include({ enableKeepAlive: true, waitForConnections: true, queueLimit: 100, idleTimeout: 30000, maxIdle: 5 });
    expect(mysqlConfig({ MYSQL_CONNECTION_LIMIT: '1' }).maxIdle).to.equal(0);
    expect(() => mysqlConfig({ MYSQL_QUEUE_LIMIT: '0' })).to.throw('Invalid MYSQL_QUEUE_LIMIT');
  });
});

describe('Bounded schema initialization', () => {
  it('uses independent parallel tasks without exceeding the pool limit', async () => {
    let active = 0, peak = 0, completed = 0;
    await runDatabaseTasks([1, 2, 3, 4, 5], async () => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setImmediate(resolve));
      active--; completed++;
    }, 2);
    expect(peak).to.equal(2); expect(completed).to.equal(5);
  });
  it('waits for the running batch to finish before reporting a failure and does not start another batch', async () => {
    const started = [], finished = [];
    let failure;
    try {
      await runDatabaseTasks([1, 2, 3], async item => {
        started.push(item);
        if (item === 1) throw new Error('schema failed');
        await new Promise(resolve => setImmediate(resolve)); finished.push(item);
      }, 2);
    } catch (error) { failure = error; }
    expect(failure.message).to.equal('schema failed');
    expect(started).to.deep.equal([1, 2]); expect(finished).to.deep.equal([2]);
  });
});

describe('Serverless database recovery', () => {
  it('shares a cold-start connection across concurrent requests and retries after a failure', async () => {
    const initialize = sinon.stub().onFirstCall().rejects(new Error('temporary outage')).onSecondCall().resolves('connection');
    const probe = sinon.stub().resolves();
    const ensure = createDatabaseRequestGate({ initialize, probe });
    const first = await Promise.allSettled([ensure(), ensure()]);
    expect(first.every(result => result.status === 'rejected')).to.equal(true);
    expect(initialize.calledOnce).to.equal(true);
    await ensure();
    expect(initialize.calledTwice).to.equal(true);
    expect(probe.calledOnceWithExactly('connection')).to.equal(true);
  });
  it('revalidates warm instances after the probe interval without relying on timers', async () => {
    let time = 0;
    const initialize = sinon.stub().resolves('connection');
    const probe = sinon.stub().onFirstCall().resolves().onSecondCall().rejects(new Error('lost connection')).onThirdCall().resolves();
    const ensure = createDatabaseRequestGate({ initialize, probe, now: () => time, intervalMs: 100 });
    await ensure(); await ensure(); expect(probe.calledOnce).to.equal(true);
    time = 101;
    let failed = false; try { await ensure(); } catch { failed = true; }
    expect(failed).to.equal(true);
    await ensure(); expect(probe.calledThrice).to.equal(true);
  });
});
