export function resolvePublicAppOrigin(env = process.env) {
  const configured = [env.PUBLIC_APP_URL, env.FRONTEND_URL, env.CLIENT_URL]
    .flatMap(value => String(value || '').split(',')).map(value => value.trim()).find(Boolean) || 'https://humaeli.com';
  const url = new URL(configured);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('PUBLIC_APP_URL must be an HTTP(S) URL');
  const privateHost = /^(localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[?::1\]?|192\.168\.\d+\.\d+|10(?:\.\d+){3}|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)$/i.test(url.hostname) || url.hostname.endsWith('.local');
  if (env.NODE_ENV === 'production' && (url.protocol !== 'https:' || privateHost)) {
    throw new Error('Set PUBLIC_APP_URL to the public HTTPS frontend domain in production');
  }
  return url.origin;
}
export const publicAppOrigin = () => resolvePublicAppOrigin();
export const doctorProfileUrl = id => `${publicAppOrigin()}/doctor/${encodeURIComponent(String(id))}`;
export const clinicWalkinUrl = id => `${publicAppOrigin()}/walkin/${encodeURIComponent(String(id))}`;
