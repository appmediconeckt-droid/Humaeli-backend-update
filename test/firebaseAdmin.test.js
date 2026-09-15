import { expect } from 'chai';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';

const runConfig = (variables) => spawnSync(process.execPath, ['--input-type=module', '-e', `
  const { firebaseApp, messaging } = await import('./src/config/firebaseAdmin.js');
  console.log(JSON.stringify({ enabled: Boolean(messaging), projectId: firebaseApp?.options.projectId }));
`], {
  cwd: new URL('../', import.meta.url),
  encoding: 'utf8',
  env: {
    ...process.env,
    DOTENV_CONFIG_PATH: 'nonexistent-firebase-test.env',
    FIREBASE_SERVICE_ACCOUNT: '',
    GOOGLE_APPLICATION_CREDENTIALS: '',
    GOOGLE_CLOUD_PROJECT: '',
    GCLOUD_PROJECT: '',
    ...variables,
  },
});

describe('Firebase credentials configuration', () => {
  it('reports a missing credentials file at startup', () => {
    const result = runConfig({ GOOGLE_APPLICATION_CREDENTIALS: 'C:\\missing-firebase-test\\credentials.json' });
    expect(result.status).to.equal(0);
    expect(result.stdout).to.include('"enabled":false');
    expect(result.stderr).to.include('On Railway');
  });

  it('uses inline JSON despite a stale local credentials path', () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const result = runConfig({
      GOOGLE_APPLICATION_CREDENTIALS: 'C:\\missing-firebase-test\\credentials.json',
      FIREBASE_SERVICE_ACCOUNT: JSON.stringify({
        project_id: 'firebase-config-test',
        client_email: 'test@firebase-config-test.iam.gserviceaccount.com',
        private_key: privateKey.replace(/\n/g, '\\n'),
      }),
    });
    expect(result.status).to.equal(0);
    expect(result.stderr).to.equal('');
    expect(result.stdout).to.include('"enabled":true');
    expect(result.stdout).to.include('"projectId":"firebase-config-test"');
  });

  it('rejects malformed JSON without logging its contents', () => {
    const result = runConfig({ FIREBASE_SERVICE_ACCOUNT: 'private-secret-invalid-json' });
    expect(result.status).to.equal(0);
    expect(result.stdout).to.include('"enabled":false');
    expect(result.stderr).to.include('must contain valid service-account JSON');
    expect(result.stderr).not.to.include('private-secret');
  });
});
