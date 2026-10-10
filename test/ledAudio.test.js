import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

describe('Queue display audio announcements', () => {
  async function setup(supported = true) {
    const buttons = Object.fromEntries(['audio-toggle', 'audio-repeat'].map(id => [id, {
      handlers: {}, attributes: {}, addEventListener(event, handler) { this.handlers[event] = handler; },
      setAttribute(name, value) { this.attributes[name] = value; },
    }]));
    const spoken = []; let cancellations = 0;
    const context = vm.createContext({
      document: { getElementById: id => buttons[id] },
      ...(supported ? {
        speechSynthesis: { speak: utterance => spoken.push(utterance), cancel: () => { cancellations += 1; },
          getVoices: () => [{ lang: 'en-IN', name: 'English India' }] },
        SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
      } : {}),
    });
    vm.runInContext(await readFile(new URL('../src/public/led/audio.js', import.meta.url), 'utf8'), context);
    return { context, buttons, spoken, cancellations: () => cancellations, audio: context.queueDisplayAudio };
  }
  const doctor = tokens => [{ doctorId: 'doctor-1', doctorName: 'Doctor', nextTokens: tokens }];

  it('starts with a click, announces live tokens and does not repeat unchanged three-second refreshes', async () => {
    const { audio, buttons, spoken } = await setup();
    audio.update(doctor([3, 4]));
    assert.equal(spoken.length, 0);
    buttons['audio-toggle'].handlers.click();
    assert.equal(spoken[0].text, 'Next token numbers are 3 and 4. Please be ready near the clinic.');
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
    buttons['audio-toggle'].handlers.click();
    assert.match(spoken[0].text, /Next token number is AM-003/);
    buttons['audio-repeat'].handlers.click();
    assert.equal(spoken.length, 2);
    buttons['audio-toggle'].handlers.click();
    audio.update(doctor([5]));
    assert.equal(spoken.length, 2);
    buttons['audio-toggle'].handlers.click();
    assert.match(spoken[2].text, /Next token number is 5/);
  });

  it('clears stale announcements after a connection error and stops speaking when the queue is empty', async () => {
    const { audio, buttons, spoken, cancellations } = await setup();
    audio.update(doctor([3])); buttons['audio-toggle'].handlers.click();
    const before = cancellations();
    audio.clear();
    assert.ok(cancellations() > before);
    assert.equal(buttons['audio-repeat'].disabled, true);
    buttons['audio-repeat'].handlers.click();
    assert.equal(spoken.length, 1);
    audio.update(doctor([]));
    assert.equal(spoken.length, 1);
    audio.update(doctor([4]));
    assert.match(spoken[1].text, /number is 4/);
  });

  it('identifies doctors on displays showing multiple queues and ignores missing tokens', async () => {
    const { audio, buttons, spoken } = await setup();
    audio.update([{ doctorId: 'a', doctorName: 'Doctor A', nextTokens: [null, 3, 4, 5] },
      { doctorId: 'b', doctorName: 'Doctor B', nextToken: 8 }]);
    buttons['audio-toggle'].handlers.click();
    assert.match(spoken[0].text, /For Doctor A.*3 and 4.*For Doctor B.*number is 8/);
    assert.ok(!spoken[0].text.includes('number is null'));
  });

  it('allows a retry when the browser blocks speech and handles unsupported browsers', async () => {
    const { audio, buttons, spoken } = await setup();
    audio.update(doctor([3])); buttons['audio-toggle'].handlers.click();
    spoken[0].onerror({ error: 'not-allowed' });
    assert.equal(buttons['audio-toggle'].textContent, 'Retry audio');
    buttons['audio-toggle'].handlers.click();
    assert.equal(spoken.length, 2);
    const unsupported = await setup(false);
    assert.equal(unsupported.buttons['audio-toggle'].disabled, true);
    unsupported.audio.update(doctor([3]));
    assert.equal(unsupported.spoken.length, 0);
  });
});
