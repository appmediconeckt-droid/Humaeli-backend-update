import express from 'express';
import { fileURLToPath } from 'node:url';

const router = express.Router();
const publicDir = fileURLToPath(new URL('../public/led/', import.meta.url));
router.use('/led-assets', express.static(publicDir, { index: false }));
router.get(['/display/:displayId', '/display/clinic/:displayId'], (req, res) => {
  if (!/^[a-zA-Z0-9_-]{1,191}$/.test(req.params.displayId)) return res.status(400).send('Invalid display ID');
  res.set('Cache-Control', 'no-store');
  return res.sendFile('index.html', { root: publicDir });
});
export default router;
