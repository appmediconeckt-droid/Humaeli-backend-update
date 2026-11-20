import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

describe('Queue display audio announcements', () => {
  async function setup(supported = true) {
    const buttons = Object.fromEntries(['audio-toggle', 'audio-repeat', 'audio-allow', 'audio-status'].map(id => [id, {
      handlers: {}, attributes: {}, addEventListener(event, handler) { this.handlers[event] = handler; },
      setAttribute(name, value) { this.attributes[name] = value; },
    }]));
    const spoken = []; let cancellations = 0;
    let stream;
    const writes = [];
    const context = vm.createContext({
      location: { pathname: '/display/clinic/clinic-1' },
      window: { addEventListener() {} },
      EventSource: class { constructor(url) { this.url = url; stream = this; } close() {} },
      fetch: async (url, options) => { writes.push({ url, enabled: JSON.parse(options.body).enabled }); return { ok: true }; },
      document: { getElementById: id => buttons[id] },
      ...(supported ? {
        speechSynthesis: { speak: utterance => spoken.push(utterance), cancel: () => { cancellations += 1; },
          getVoices: () => [{ lang: 'en-IN', name: 'English India' }] },
        SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
      } : {}),
    });
    vm.runInContext(await readFile(new URL('../src/public/led/audio.js', import.meta.url), 'utf8'), context);
    return { context, buttons, spoken, writes, stream, cancellations: () => cancellations, audio: context.queueDisplayAudio };
  }
  const doctor = tokens => [{ doctorId: 'doctor-1', doctorName: 'Doctor', nextTokens: tokens }];

  it('applies shared mute/unmute to another screen without sending the setting back', async () => {
    const laptop = await setup();
    const led = await setup();
    laptop.audio.update(doctor([3]));
    led.audio.update(doctor([3]));
    await laptop.buttons['audio-toggle'].handlers.click();
    led.stream.onmessage({ data: JSON.stringify({ enabled: true }) });
    assert.equal(led.spoken.length, 1, 'a receiver must attempt playback without a local click');
    await laptop.buttons['audio-toggle'].handlers.click();
    assert.equal(laptop.writes.at(-1).enabled, false);
    led.stream.onmessage({ data: JSON.stringify({ enabled: false }) });
    assert.equal(led.buttons['audio-toggle'].attributes['aria-pressed'], 'false');
    const count = led.spoken.length;
    led.audio.update(doctor([4]));
    assert.equal(led.spoken.length, count);
    led.stream.onmessage({ data: JSON.stringify({ enabled: true }) });
    assert.equal(led.spoken.length, count + 1);
    assert.equal(led.writes.length, 0);
    const fresh = await setup();
    fresh.audio.update(doctor([3]));
    fresh.stream.onmessage({ data: JSON.stringify({ enabled: true }) });
    assert.equal(fresh.spoken.length, 1);
    assert.equal(fresh.buttons['audio-toggle'].textContent, 'Mute linked screens');
  });

  it('prefers an available Indian male voice for announcements and sound checks', async () => {
    const { context, audio, buttons, spoken } = await setup();
    const female = { lang: 'en-IN', name: 'Microsoft Heera' };
    const male = { lang: 'en-IN', name: 'Microsoft Ravi' };
    context.speechSynthesis.getVoices = () => [female, male];
    audio.update(doctor([3]));
    await buttons['audio-toggle'].handlers.click();
    assert.equal(spoken[0].voice, male);
    audio.update(doctor([]));
    buttons['audio-allow'].handlers.click();
    assert.equal(spoken.at(-1).voice, male);
  });

  it('plays a sound check when enabled without waiting tokens', async () => {
    const { buttons, spoken } = await setup();
    await buttons['audio-toggle'].handlers.click();
    assert.match(spoken[0].text, /sound is enabled.*Waiting for the next patient/);
    assert.equal(buttons['audio-repeat'].disabled, true);
  });

  it('does not let an old audio event undo a pending enable request', async () => {
    const { context, audio, buttons, stream } = await setup();
    audio.update(doctor([3]));
    let finish;
    context.fetch = () => new Promise(resolve => { finish = resolve; });
    const pending = buttons['audio-toggle'].handlers.click();
    stream.onmessage({ data: JSON.stringify({ enabled: false }) });
    assert.equal(buttons['audio-toggle'].attributes['aria-pressed'], 'true');
    finish({ ok: true });
    await pending;
    assert.equal(buttons['audio-toggle'].attributes['aria-pressed'], 'true');
  });

  it('shows an actionable error when the audio setting cannot be saved', async () => {
    const { context, buttons } = await setup();
    context.fetch = async () => ({ ok: false });
    await buttons['audio-toggle'].handlers.click();
    assert.equal(buttons['audio-toggle'].attributes['aria-pressed'], 'false');
    assert.match(buttons['audio-status'].textContent, /could not be saved/);
  });

  it('starts with a click, announces live tokens and does not repeat unchanged queue refreshes', async () => {
    const { audio, buttons, spoken } = await setup();
    audio.update(doctor([3, 4]));
    assert.equal(spoken.length, 0);
    await buttons['audio-toggle'].handlers.click();
    assert.equal(spoken[0].text, 'Next token numbers 3 and 4 are available for patients. Please be ready for your turn.');
    assert.equal(spoken[0].lang, 'en-IN');
    audio.update(doctor([3, 4]));
    assert.equal(spoken.length, 1);
    audio.update(doctor([4, 5]));
    assert.equal(spoken.length, 2);
    assert.match(spoken[1].text, /4 and 5/);
  });

  it('supports mute, replay and singular/alphanumeric tokens from the latest queue', async () => {
    const { audio, buttons, spoken } = await setup();
    audio.update(doctor(['AM-003']));
    await buttons['audio-toggle'].handlers.click();
    assert.match(spoken[0].text, /Next token number AM-003 is available for the patient/);
    buttons['audio-repeat'].handlers.click();
    assert.equal(spoken.length, 2);
    await buttons['audio-toggle'].handlers.click();
    audio.update(doctor([5]));
    assert.equal(spoken.length, 2);
    await buttons['audio-toggle'].handlers.click();
    assert.match(spoken[2].text, /Next token number 5 is available for the patient/);
  });

  it('clears stale announcements after a connection error and stops speaking when the queue is empty', async () => {
    const { audio, buttons, spoken, cancellations } = await setup();
    audio.update(doctor([3])); await buttons['audio-toggle'].handlers.click();
    const before = cancellations();
    audio.clear();
    assert.ok(cancellations() > before);
    assert.equal(buttons['audio-repeat'].disabled, true);
    buttons['audio-repeat'].handlers.click();
    assert.equal(spoken.length, 1);
    audio.update(doctor([]));
    assert.equal(spoken.length, 1);
    audio.update(doctor([4]));
    assert.match(spoken[1].text, /number 4 is available for the patient/);
  });

  it('identifies doctors on displays showing multiple queues and ignores missing tokens', async () => {
    const { audio, buttons, spoken } = await setup();
    audio.update([{ doctorId: 'a', doctorName: 'Doctor A', nextTokens: [null, 3, 4, 5] },
      { doctorId: 'b', doctorName: 'Doctor B', nextToken: 8 }]);
    await buttons['audio-toggle'].handlers.click();
    assert.match(spoken[0].text, /For Doctor A.*3 and 4.*For Doctor B.*number 8 is available for the patient/);
    assert.ok(!spoken[0].text.includes('number is null'));
  });

  it('allows a retry when the browser blocks speech and handles unsupported browsers', async () => {
    const { audio, buttons, spoken } = await setup();
    audio.update(doctor([3])); await buttons['audio-toggle'].handlers.click();
    spoken[0].onerror({ error: 'not-allowed' });
    assert.equal(buttons['audio-toggle'].textContent, 'Mute linked screens');
    assert.match(buttons['audio-status'].textContent, /browser blocked playback/);
    assert.equal(buttons['audio-allow'].hidden, false);
    buttons['audio-allow'].handlers.click();
    assert.equal(spoken.length, 2);
    const unsupported = await setup(false);
    assert.equal(unsupported.buttons['audio-toggle'].disabled, false, 'a controller without speech can still control other screens');
    unsupported.audio.update(doctor([3]));
    assert.equal(unsupported.spoken.length, 0);
  });
});
