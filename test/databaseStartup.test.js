import { expect } from 'chai';
import { createDatabaseStartup, databaseFailureDetails } from '../src/config/databaseStartup.js';
import { mysqlConfig } from '../src/persistence/mysqlDriver.js';

describe('Database startup', () => {
  it('does not run jobs until connected and starts only once after retries', async () => {
    const connection = { readyState: 0 };
    let runs = 0;
    const start = createDatabaseStartup(connection, async () => { runs += 1; });
    for (const state of [0, 2, 3]) {
      connection.readyState = state;
      let failure;
      try { await start(); } catch (error) { failure = error; }
      expect(failure?.message).to.contain('Database must be connected');
    }
    expect(runs).to.equal(0);
    connection.readyState = 1;
    await Promise.all([start(), start()]);
    await start();
    expect(runs).to.equal(1);
  });

  it('allows initialization to be retried after a startup failure', async () => {
    let runs = 0;
    const start = createDatabaseStartup({ readyState: 1 }, async () => {
      if (++runs === 1) throw new Error('presence reset failed');
    });
    await start().catch(() => {});
    await start();
    expect(runs).to.equal(2);
  });

  it('reports network error codes from aggregate errors without credentials', () => {
    const error = new AggregateError([{ code: 'ECONNREFUSED' }, { code: 'ENOTFOUND' }]);
    expect(databaseFailureDetails(error, {})).to.contain('ECONNREFUSED');
    expect(databaseFailureDetails(error, {})).to.contain('ENOTFOUND');
    const details = databaseFailureDetails(new Error('Failed mysql://root:private@host/db password private'), { MYSQL_PASSWORD: 'private' });
    expect(details).not.to.contain('private');
    expect(details).not.to.contain('root');
  });
});

describe('Deployment MySQL configuration', () => {
  it('accepts provider variable names', () => {
    expect(mysqlConfig({ MYSQLHOST: 'db.internal', MYSQLPORT: '3307', MYSQLUSER: 'app', MYSQLPASSWORD: 'pass', MYSQLDATABASE: 'railway' }))
      .to.include({ host: 'db.internal', port: 3307, user: 'app', password: 'pass', database: 'railway' });
  });

  it('accepts a URL with encoded credentials and explicit field overrides', () => {
    expect(mysqlConfig({ MYSQL_URL: 'mysql://app:p%40ss@db.internal:3307/railway', MYSQL_DATABASE: 'humaeli_test_startup', MYSQL_PASSWORD: '' }))
      .to.include({ host: 'db.internal', port: 3307, user: 'app', password: '', database: 'humaeli_test_startup' });
    expect(mysqlConfig({ MYSQL_URL: 'mysql://app:p%40ss@db.internal/railway' }).password).to.equal('p@ss');
  });

  it('rejects malformed URLs without echoing secrets', () => {
    const configure = () => mysqlConfig({ MYSQL_URL: 'bad-private-url' });
    expect(configure).to.throw('Invalid MYSQL_URL');
    expect(configure).not.to.throw('bad-private-url');
  });
});
