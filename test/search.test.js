// The search bar: typos, partial words, other names and squashed words still find the right thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search, editDistance, labelOf, settingEntries, highlight } from '../src/renderer/lib/search.js';
import { PAGES, SECTIONS } from '../src/renderer/lib/searchCatalog.js';

const entries = [
  ...PAGES.map((p) => ({ ...p, kind: 'page' })),
  ...SECTIONS.map((s) => ({ ...s, id: s.title, kind: 'section' })),
  ...settingEntries(
    { games: { trivia: { useAI: true, answerSeconds: 30 } }, loyalty: { currencyName: 'points', pointsPerInterval: 10 }, moderation: { bannedWords: { enabled: true, words: [] } } },
    { games: { route: 'games', name: 'Games' }, loyalty: { route: 'loyalty', name: 'Points' }, moderation: { route: 'moderation', name: 'Moderation' } },
  ),
];
const top = (q) => search(q, entries, 5)[0]?.title;
const anyOf = (q) => search(q, entries, 5).map((e) => e.title);

test('exact and partial words', () => {
  assert.equal(top('giveaways'), 'Giveaways');
  assert.equal(top('give'), 'Giveaways');
  assert.equal(top('overlays'), 'OBS Overlays');
  assert.equal(top('import'), 'Import Accounts');
});

test('typos', () => {
  assert.equal(top('gievaway'), 'Giveaways');
  assert.equal(top('givaway'), 'Giveaways');
  assert.equal(top('qoutes'), 'Quotes');
  assert.equal(top('comands'), 'Commands');
  assert.equal(top('tmers'), 'Timers');
  assert.equal(top('curency name'), 'Currency Name');
  assert.ok(anyOf('song reqests').includes('Song Requests'));
  assert.ok(anyOf('ban wrds').some((t) => t === 'Moderation' || t === 'Words'));
});

test('other names and squashed words', () => {
  assert.equal(top('raffle'), 'Giveaways');
  assert.equal(top('obs'), 'OBS Overlays');
  assert.equal(top('sr'), 'Song Requests');
  assert.equal(top('prediction'), 'Polls & Bets');
  assert.ok(anyOf('songrequest').includes('Song Requests'));
  assert.equal(top('trivia ai'), 'Use AI');
  assert.equal(top('streamlabs'), 'Import Accounts');
});

test('nothing for nonsense, and helpers', () => {
  assert.deepEqual(search('zzqx', entries), []);
  assert.deepEqual(search('   ', entries), []);
  assert.equal(editDistance('wrod', 'word'), 1, 'a swapped pair is one typo');
  assert.equal(labelOf('useAI'), 'Use AI');
  assert.equal(labelOf('ttsVoice'), 'TTS Voice');
  assert.ok(highlight('Song Requests', 'song').some((p) => p.hit && p.text === 'Song'));
});
