import express from 'express';
import { fileURLToPath } from 'node:url';
import rateLimit from 'express-rate-limit';
import Display from '../models/mysql/DisplayModel.js';
import { resolveWalkin } from '../services/clinicQrService.js';
import { getDisplayAudio, setDisplayAudio, subscribeDisplayAudio } from '../services/displayAudioState.js';
import { subscribeDisplayQueue } from '../services/displayQueueEvents.js';
import { query } from '../config/mysql.js';

const router = express.Router();
const publicDir = fileURLToPath(new URL('../public/led/', import.meta.url));
const audioLimit = rateLimit({ windowMs: 60000, limit: 60 });
async function audioDisplay(req, res, next) {
  try {
    const { kind, displayId } = req.params;
    if (!['clinic', 'display'].includes(kind) || !/^[a-zA-Z0-9_-]{1,191}$/.test(displayId)) return res.sendStatus(400);
    if (kind === 'clinic') {
      const { link } = await resolveWalkin(displayId);
      req.queueScope = { doctorId: link.doctor_id };
    }
    else {
      const display = await Display.findById(displayId);
      if (!display?.isActive) return res.sendStatus(404);
      req.queueScope = { doctorId: display.doctorId, facilityId: display.facilityId };
    }
    req.audioKey = `${kind}:${displayId}`;
    next();
  } catch (error) { res.status(error.statusCode || error.status || 503).json({ message: 'Display unavailable' }); }
}
router.get('/led-control/:kind/:displayId/events', audioLimit, audioDisplay, async (req, res) => {
  if (!req.queueScope.doctorId) {
    try {
      const [rows] = await query('SELECT doctorId FROM doctor_facilities WHERE facilityId=? AND isActive=1', [req.queueScope.facilityId]);
      req.queueScope.doctorIds = rows.map(row => row.doctorId);
    } catch { return res.sendStatus(503); }
  }
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  let timer;
  // Collapse multiple notifications from one completed appointment into one fetch.
  const notify = () => {
    if (timer || res.destroyed) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!res.destroyed) { res.write('data: {"changed":true}\n\n'); res.flush?.(); }
    }, 150);
  };
  const unsubscribe = subscribeDisplayQueue(req.queueScope, notify);
  const heartbeat = setInterval(() => {
    if (!res.destroyed) { res.write(': connected\n\n'); res.flush?.(); }
  }, 25000);
  res.on('close', () => { unsubscribe(); clearTimeout(timer); clearInterval(heartbeat); });
});
router.patch('/led-control/:kind/:displayId/audio', audioLimit, audioDisplay, async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') return res.sendStatus(400);
  try { res.json(await setDisplayAudio(req.audioKey, req.body.enabled)); }
  catch (error) {
    console.error('LED audio setting save failed:', error.code || error.message);
    res.status(503).json({ message: 'Audio setting could not be saved', code: 'LED_AUDIO_SAVE_FAILED' });
  }
});
router.get('/led-control/:kind/:displayId/audio', audioLimit, audioDisplay, async (req, res) => {
  let initial;
  try { initial = await getDisplayAudio(req.audioKey); }
  catch { return res.sendStatus(503); }
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = state => {
    if (res.destroyed) return;
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    res.flush?.();
  };
  const unsubscribe = subscribeDisplayAudio(req.audioKey, send);
  send(initial);
  // Also reconcile settings when other server instances receive the change.
  let pending = false;
  const timer = setInterval(async () => {
    if (pending || res.destroyed) return;
    pending = true;
    try { send(await getDisplayAudio(req.audioKey)); } catch { res.write(': retry\n\n'); }
    finally { pending = false; }
  }, 15000);
  res.on('close', () => { clearInterval(timer); unsubscribe(); });
});
router.use('/led-assets', express.static(publicDir, { index: false }));
router.get(['/display/:displayId', '/display/clinic/:displayId'], (req, res) => {
  if (!/^[a-zA-Z0-9_-]{1,191}$/.test(req.params.displayId)) return res.status(400).send('Invalid display ID');
  res.set('Cache-Control', 'no-store');
  return res.sendFile('index.html', { root: publicDir });
});
export default router;
