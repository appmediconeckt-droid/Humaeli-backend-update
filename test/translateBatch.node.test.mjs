import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('batch fallback translates Gujarati through the same provider chain as individual strings', async () => {
 const calls = [];
 globalThis.__batchTranslationAxios = { get: async url => {
  calls.push(new URL(url));
  const text = new URL(url).searchParams.get('q');
  return { data: [[[text === 'Patient Name' ? 'દર્દીનું નામ' : 'પુષ્ટિ થઈ']]] };
 } };
 const source = (await readFile(new URL('../src/controllers/translateController.js', import.meta.url), 'utf8'))
  .replace('import axios from "axios";', 'const axios = globalThis.__batchTranslationAxios; const testEnv = {};')
  .replace('import OpenAI from "openai";', 'class OpenAI {}')
  .replaceAll('process.env.', 'testEnv.');
 const { translatePlainTextBatch } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 assert.deepEqual(await translatePlainTextBatch({ texts: ['Patient Name', 'Confirmed'], from: 'en-US', to: 'gu-IN' }), ['દર્દીનું નામ', 'પુષ્ટિ થઈ']);
 assert.equal(calls.length, 2);
 for (const url of calls) {
  assert.equal(url.hostname, 'translate.googleapis.com');
  assert.equal(url.searchParams.get('tl'), 'gu');
  assert.equal(url.searchParams.get('sl'), 'en');
 }
 await translatePlainTextBatch({ texts: ['Confirmed'], from: 'en-US', to: 'zh-TW' });
 assert.equal(calls.at(-1).searchParams.get('tl'), 'zh-TW');
 delete globalThis.__batchTranslationAxios;
});
