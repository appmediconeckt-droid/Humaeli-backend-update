// Dynamic API responses must be read from the server, not a browser/proxy cache.
export const apiFreshness = (_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
};
