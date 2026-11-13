import { query } from '../config/mysql.js';
export const displayAudioRepository = { query };

let schema;
const listeners = new Map();
async function ready() {
  if (!schema) schema = displayAudioRepository.query(`CREATE TABLE IF NOT EXISTS display_audio_settings (
    display_key VARCHAR(200) PRIMARY KEY,
    enabled TINYINT(1) NOT NULL DEFAULT 0
  )`).catch(error => { schema = undefined; throw error; });
  await schema;
}
export async function getDisplayAudio(key) {
  await ready();
  const [rows] = await displayAudioRepository.query('SELECT enabled FROM display_audio_settings WHERE display_key=?', [key]);
  return { enabled: Boolean(Number(rows[0]?.enabled || 0)) };
}
export async function setDisplayAudio(key, enabled) {
  await ready();
  await displayAudioRepository.query('INSERT INTO display_audio_settings (display_key,enabled) VALUES (?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)', [key, enabled ? 1 : 0]);
  const state = { enabled };
  for (const send of listeners.get(key) || []) send(state);
  return state;
}
export function subscribeDisplayAudio(key, send) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(send);
  return () => {
    const group = listeners.get(key);
    group?.delete(send);
    if (!group?.size) listeners.delete(key);
  };
}
