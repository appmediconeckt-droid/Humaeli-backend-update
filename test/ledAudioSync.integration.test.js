import assert from 'node:assert/strict';
import express from 'express';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ledRoutes from '../src/routes/ledPageRoutes.js';
import Display from '../src/models/mysql/DisplayModel.js';
import { displayAudioRepository } from '../src/services/displayAudioState.js';

const until = async predicate => {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail('Timed out waiting for the linked screen update');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

describe('Linked audio over HTTP and server-sent events', () => {
  it('enables untouched receivers, syncs mute both ways, restores enabled state, and isolates local permission failures', async () => {
    const originalQuery = displayAudioRepository.query;
    const originalDisplay = Display.findById;
    const stored = new Map();
    let writes = 0;
    displayAudioRepository.query = async (sql, args = []) => {
      if (sql.startsWith('SELECT')) return [stored.has(args[0]) ? [{ enabled: stored.get(args[0]) }] : []];
      if (sql.startsWith('INSERT')) { stored.set(args[0], args[1]); writes++; }
      return [[]];
    };
    Display.findById = async () => ({ isActive: true, doctorId: 'doctor', facilityId: 'clinic' });
    const app = express(); app.use(express.json()); app.use(ledRoutes);
    const server = app.listen(0);
    const origin = `http://127.0.0.1:${server.address().port}`;
    const source = await readFile(new URL('../src/public/led/audio.js', import.meta.url), 'utf8');
    const connections = [];
    const devices = [];
    function device(id = 'tv-1', blocked = false) {
      const elements = Object.fromEntries(['audio-toggle', 'audio-repeat', 'audio-allow', 'audio-status'].map(name => [name, {
        handlers: {}, attributes: {}, addEventListener(event, fn) { this.handlers[event] = fn; },
        setAttribute(key, value) { this.attributes[key] = value; },
      }]));
      const screen = { elements, spoken: [], blocked, attempts: 0, cancellations: 0, received: 0 };
      class EventSource {
        constructor(url) {
          this.abort = new AbortController();
          connections.push(this);
          this.read(url).catch(error => { if (!this.abort.signal.aborted) this.onerror?.(error); });
        }
        async read(url) {
          const response = await fetch(origin + url, { signal: this.abort.signal });
          assert.equal(response.status, 200);
          this.onopen?.();
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let pending = '';
          while (!this.abort.signal.aborted) {
            const chunk = await reader.read();
            if (chunk.done) break;
            pending += decoder.decode(chunk.value, { stream: true });
            let boundary;
            while ((boundary = pending.indexOf('\n\n')) !== -1) {
              const message = pending.slice(0, boundary);
              pending = pending.slice(boundary + 2);
              if (message.startsWith('data: ')) {
                screen.received++;
                this.onmessage?.({ data: message.slice(6) });
              }
            }
          }
        }
        close() { this.abort.abort(); }
      }
      const context = vm.createContext({
        document: { getElementById: name => elements[name] },
        location: { pathname: `/display/${id}` }, window: { addEventListener() {} }, EventSource,
        fetch: (url, options) => fetch(origin + url, options),
        SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
        speechSynthesis: {
          cancel() { screen.cancellations++; }, getVoices: () => [],
          speak(utterance) {
            screen.attempts++;
            if (screen.blocked) utterance.onerror?.({ error: 'not-allowed' });
            else { screen.spoken.push(utterance.text); utterance.onstart?.(); }
          },
        },
      });
      vm.runInContext(source, context);
      context.queueDisplayAudio.update([{ doctorId: 'doctor', nextTokens: [3, 4] }]);
      devices.push(screen);
      return screen;
    }
    try {
      const doctor = device();
      const untouchedLed = device();
      const otherClinic = device('other-tv');
      await until(() => devices.every(screen => screen.received));
      await doctor.elements['audio-toggle'].handlers.click();
      await until(() => untouchedLed.spoken.length === 1);
      assert.equal(untouchedLed.elements['audio-toggle'].attributes['aria-pressed'], 'true');
      assert.equal(otherClinic.attempts, 0);
      const before = doctor.cancellations;
      await untouchedLed.elements['audio-toggle'].handlers.click();
      await until(() => doctor.elements['audio-toggle'].attributes['aria-pressed'] === 'false');
      assert.ok(doctor.cancellations > before);
      await doctor.elements['audio-toggle'].handlers.click();
      await until(() => untouchedLed.spoken.length === 2);
      const reopened = device();
      await until(() => reopened.spoken.length === 1);
      const permissionBlocked = device('tv-1', true);
      await until(() => permissionBlocked.attempts === 1);
      assert.equal(permissionBlocked.elements['audio-toggle'].attributes['aria-pressed'], 'true');
      assert.match(permissionBlocked.elements['audio-status'].textContent, /browser blocked playback/);
      assert.equal(stored.get('display:tv-1'), 1);
      const priorWrites = writes;
      permissionBlocked.blocked = false;
      permissionBlocked.elements['audio-allow'].handlers.click();
      assert.equal(permissionBlocked.spoken.length, 1);
      assert.equal(writes, priorWrites, 'allowing a browser locally does not change the shared setting');
    } finally {
      connections.forEach(connection => connection.close());
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      displayAudioRepository.query = originalQuery;
      Display.findById = originalDisplay;
    }
  });
});
