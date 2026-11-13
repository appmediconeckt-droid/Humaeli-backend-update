import assert from 'node:assert/strict';
import { displayAudioRepository, getDisplayAudio, setDisplayAudio, subscribeDisplayAudio } from '../src/services/displayAudioState.js';

describe('Shared LED audio settings', () => {
  it('persists per display and notifies only viewers of that display', async () => {
    const original = displayAudioRepository.query;
    const stored = new Map();
    const received = [];
    const other = [];
    const unsubscribe = subscribeDisplayAudio('clinic:one', state => received.push(state.enabled));
    const unsubscribeOther = subscribeDisplayAudio('clinic:two', state => other.push(state.enabled));
    displayAudioRepository.query = async (sql, args = []) => {
      if (sql.startsWith('SELECT')) return [stored.has(args[0]) ? [{ enabled: stored.get(args[0]) }] : []];
      if (sql.startsWith('INSERT')) stored.set(args[0], args[1]);
      return [[]];
    };
    try {
      assert.equal((await getDisplayAudio('clinic:one')).enabled, false);
      await setDisplayAudio('clinic:one', true);
      assert.equal((await getDisplayAudio('clinic:one')).enabled, true);
      assert.equal((await getDisplayAudio('clinic:two')).enabled, false);
      await setDisplayAudio('clinic:one', false);
      assert.deepEqual(received, [true, false]);
      assert.deepEqual(other, []);
      unsubscribe();
      await setDisplayAudio('clinic:one', true);
      assert.deepEqual(received, [true, false]);
    } finally {
      unsubscribe(); unsubscribeOther(); displayAudioRepository.query = original;
    }
  });
});
