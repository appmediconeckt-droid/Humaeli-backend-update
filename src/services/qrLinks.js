export function publicAppOrigin() {
  const configured = process.env.PUBLIC_APP_URL || process.env.CLIENT_URL || 'https://humaeli.com';
  const url = new URL(configured);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('PUBLIC_APP_URL must be an HTTP(S) URL');
  return url.origin;
}
export const doctorProfileUrl = id => `${publicAppOrigin()}/doctor/${encodeURIComponent(String(id))}`;
export const clinicWalkinUrl = id => `${publicAppOrigin()}/walkin/${encodeURIComponent(String(id))}`;
