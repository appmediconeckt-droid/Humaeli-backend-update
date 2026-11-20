import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import helmet from 'helmet';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ledRoutes from '../src/routes/ledPageRoutes.js';
import { queueToday } from '../src/utils/queueDate.js';
import Display from '../src/models/mysql/DisplayModel.js';
import { publishDisplayQueueChange } from '../src/services/displayQueueEvents.js';

describe('LED browser page', () => {
  const app = express(); app.use(helmet()); app.use(ledRoutes);
  it('serves a browser page and external scripts/styles without authentication', async () => {
    const page = await request(app).get('/display/tv-123');
    assert.equal(page.status, 200); assert.match(page.headers['content-type'], /html/);
    assert.match(page.text, /Now|Patient queue/); assert.equal(page.headers['cache-control'], 'no-store');
    for (const asset of ['display.js', 'display.css', 'audio.js']) assert.equal((await request(app).get(`/led-assets/${asset}`)).status, 200);
    assert.equal((await request(app).get('/display/bad%20id')).status, 400);
    assert.equal((await request(app).get('/display/clinic/clinic-123')).status, 200);
    assert.equal((await request(app).get('/display/clinic/bad%20id')).status, 400);
  });
  it('uses India date after local midnight', () => {
    assert.equal(queueToday(new Date('2026-09-28T18:31:00Z')), '2026-09-29');
  });
  it('pushes one queue-change notification after completion without periodic queue requests', async () => {
    const original = Display.findById;
    Display.findById = async () => ({ isActive: true, doctorId: 'doctor-1', facilityId: 'clinic-1' });
    const server = app.listen(0);
    const controller = new AbortController();
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/led-control/display/tv-1/events`, { signal: controller.signal });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/event-stream/);
      const reader = response.body.getReader();
      publishDisplayQueueChange({ doctorId: 'doctor-1' });
      publishDisplayQueueChange({ doctorId: 'doctor-1' });
      const result = await reader.read();
      const message = new TextDecoder().decode(result.value);
      assert.equal(message, 'data: {"changed":true}\n\n');
      await reader.cancel();
    } finally {
      controller.abort();
      Display.findById = original;
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
  for (const [pagePath, apiPath] of [['/display/tv-123', '/api/displays/tv-123/queue'], ['/display/clinic/clinic-123', '/api/qr/walkin/clinic-123/queue']]) {
  it(`renders tokens safely, refreshes and clears a deactivated display: ${pagePath}`, async () => {
    class Element {
      constructor() { this.children = []; this.textContent = ''; this.classList = { toggle() {}, add() {}, remove() {} }; }
      append(...nodes) { this.children.push(...nodes); }
      replaceChildren(...nodes) { this.children = nodes; }
      addEventListener() {}
    }
    const elements = Object.fromEntries(['facility','title','doctors','message','connection','updated','fullscreen','clock'].map(id => [id, new Element()]));
    const scheduled = [];
    let payload = { success: true, displayType: 'doctor', displayName: 'Doctor TV', facility: { name: 'Clinic' }, doctor: { name: '<img src=x onerror=alert(1)>' }, current: { token: 'AM-001' }, nextTokens: ['AM-002'], waitingCount: 1, roomId: '101' };
    let status = 200;
    let stream;
    let requests = 0;
    vm.runInNewContext(await readFile(new URL('../src/public/led/display.js', import.meta.url), 'utf8'), {
      document: { getElementById: id => elements[id], createElement: () => new Element(), body: new Element() },
      location: { pathname: pagePath }, AbortController, Date,
      EventSource: class { constructor() { stream = this; } close() {} },
      window: { addEventListener() {} },
      setTimeout: (fn, delay) => { scheduled.push({ fn, delay }); return 1; }, clearTimeout() {}, setInterval() {},
      fetch: async url => { requests++; assert.equal(url, apiPath); return { ok: status === 200, status, json: async () => payload }; },
    });
    await stream.onopen();
    assert.equal(requests, 1);
    assert.ok(scheduled.every(task => task.delay === 8000), "No recurring queue polling is scheduled");
    const flatten = node => [node.textContent, ...node.children.map(flatten)].join(' ');
    assert.match(flatten(elements.doctors), /AM-001/); assert.match(flatten(elements.doctors), /AM-002/);
    payload = { ...payload, pendingTokens: ['AM-009'] };
    await stream.onmessage();
    assert.match(flatten(elements.doctors), /Pending — patient unavailable/);
    assert.match(flatten(elements.doctors), /AM-009/);
    const infoWithPending = elements.doctors.children[0].children.find(node => node.className === 'doctor-info');
    assert.deepEqual(Array.from(infoWithPending.children, node => node.className), ['status-panel', 'delay-panel', 'pending-patients']);
    assert.match(flatten(elements.doctors), /Room 101/);
    const counts = elements.doctors.children[0].children.find(node => node.className === 'counts');
    assert.equal(counts.children[3].children[1].children[0].className, 'wait-status');
    assert.equal(elements.doctors.children[0].children[0].textContent, '<img src=x onerror=alert(1)>');
    payload = { ...payload, current: null, doctorStatus: 'delayed', estimatedWaitLabel: 'Awaiting doctor', breakInfo: {
      headline: '58 min late', delayMinutes: 58, waitingForDoctor: true,
      scheduledStart: '01:10 PM', reason: 'Consultation has not started',
    } };
    await stream.onmessage();
    assert.match(flatten(elements.doctors), /58 min late/);
    assert.match(flatten(elements.doctors), /Scheduled start.*01:10 PM/);
    assert.match(flatten(elements.doctors), /Running late.*58 min/);
    assert.match(flatten(elements.doctors), /Estimated wait for next token.*Awaiting doctor/);
    payload = { ...payload, estimatedWaitLabel: null, estimatedWaitMinutes: 10 };
    await stream.onmessage();
    assert.match(flatten(elements.doctors), /Estimated wait for next token.*10 min/);
    payload = { ...payload, doctorStatus: 'emergency', current: { token: 'EM-001' } };
    await stream.onmessage();
    assert.match(flatten(elements.doctors), /EMERGENCY.*Available/);
    assert.match(flatten(elements.doctors), /Emergency checkup in progress/);
    const doctorInfo = elements.doctors.children[0].children.find(node => node.className === 'doctor-info');
    const statusHeading = doctorInfo.children[0].children[0];
    assert.equal(statusHeading.className, 'doctor-status-heading');
    assert.equal(statusHeading.children[1].className, 'emergency-badge');
    assert.equal(statusHeading.children[1].textContent, 'EMERGENCY');
    payload = { ...payload, doctorStatus: 'consulting' };
    await stream.onmessage();
    assert.doesNotMatch(flatten(elements.doctors), /Emergency checkup in progress/);
    payload = { ...payload, doctorStatus: 'consulting', current: { token: '6', status: 'in_consultation', priority: 'emergency' } };
    await stream.onmessage();
    assert.match(flatten(elements.doctors), /EMERGENCY/);
    assert.match(flatten(elements.doctors), /EMERGENCY.*Available/);
    payload = { ...payload, current: { token: '8', status: 'called', priority: 'Emergency' } };
    await stream.onmessage();
    assert.match(flatten(elements.doctors), /EMERGENCY/);
    assert.match(flatten(elements.doctors), /Emergency patient called/);
    payload = { ...payload, doctorStatus: 'break', current: { token: '8', status: 'called', priority: 'emergency' } };
    await stream.onmessage();
    assert.match(flatten(elements.doctors), /EMERGENCY.*On break/);
    payload = { ...payload, doctorStatus: 'consulting', current: { token: '7', status: 'in_consultation', priority: 'normal' } };
    await stream.onmessage();
    assert.doesNotMatch(flatten(elements.doctors), /EMERGENCY/);
    status = 403; payload = { success: false, message: 'Display is inactive' };
    await stream.onmessage();
    assert.equal(elements.doctors.children.length, 0);
    assert.equal(elements.message.textContent, 'Display is inactive');
  });
  }
});
