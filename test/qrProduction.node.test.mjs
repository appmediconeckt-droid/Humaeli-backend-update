import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePublicAppOrigin } from '../src/services/qrLinks.js';

test('production QR defaults to the public frontend and uses the explicit configured domain', () => {
 assert.equal(resolvePublicAppOrigin({ NODE_ENV: 'production' }), 'https://humaeli.com');
 assert.equal(resolvePublicAppOrigin({ NODE_ENV: 'production', PUBLIC_APP_URL: 'https://www.humaeli.com/walkin' }), 'https://www.humaeli.com');
 assert.equal(resolvePublicAppOrigin({ NODE_ENV: 'production', FRONTEND_URL: 'https://frontend.example', CLIENT_URL: 'http://localhost:5173' }), 'https://frontend.example');
 assert.equal(resolvePublicAppOrigin({ NODE_ENV: 'production', CLIENT_URL: 'https://frontend.example,https://www.frontend.example' }), 'https://frontend.example');
});

test('production QR never silently encodes a localhost, LAN or insecure HTTP address', () => {
 for (const PUBLIC_APP_URL of ['http://humaeli.com', 'https://localhost:5173', 'https://127.0.0.1', 'https://192.168.0.138:5173', 'https://10.0.0.8', 'https://172.16.0.1', 'https://[::1]:5173', 'https://pc.local']) {
  assert.throws(() => resolvePublicAppOrigin({ NODE_ENV: 'production', PUBLIC_APP_URL }), /public HTTPS/);
 }
 assert.throws(() => resolvePublicAppOrigin({ PUBLIC_APP_URL: 'javascript:alert(1)' }), /HTTP/);
});

test('local backend URL settings remain usable in development', () => {
 assert.equal(resolvePublicAppOrigin({ NODE_ENV: 'development', PUBLIC_APP_URL: 'http://localhost:5173' }), 'http://localhost:5173');
});
