// The saved chat log behind the AI's chat memory: daily files, filters, newest-first limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createChatHistory, formatLines } from '../src/main/bot/chatHistory.js';

test('messages are saved per day and searched by viewer, words and time', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tchat-')), 'chat');
  const h = createChatHistory(dir);
  const day = 86400000;
  const t0 = Date.UTC(2026, 0, 10, 12);
  h.add({ t: t0, login: 'Ann', user: 'Ann', text: 'hello from day one' });
  h.add({ t: t0 + day, login: 'bob', user: 'Bob', text: 'Pizza is great' });
  h.add({ t: t0 + 2 * day, login: 'ann', user: 'Ann', text: 'I want pizza tonight' });
  for (let i = 0; i < 5; i++) h.add({ t: t0 + 3 * day + i, login: 'ann', user: 'Ann', text: `spam ${i}` });
  h.add({ t: t0 + 3 * day + 10, login: 'steezbot', user: 'steezbot', text: 'hi ann', bot: true });
  h.flush();

  assert.equal(fs.readdirSync(dir).length, 4, 'one file per day');
  assert.equal(h.search({ login: '@ANN', limit: 100 }).length, 7);
  assert.deepEqual(h.search({ contains: 'PIZZA' }).map((r) => r.u), ['Bob', 'Ann'], 'oldest first');
  assert.deepEqual(h.search({ login: 'ann', contains: 'pizza tonight' }).map((r) => r.m), ['I want pizza tonight']);
  // limit keeps the newest
  assert.deepEqual(h.search({ login: 'ann', limit: 2 }).map((r) => r.m), ['spam 3', 'spam 4']);
  // time windows
  assert.deepEqual(h.search({ since: t0 + 2 * day, until: t0 + 2 * day + 1 }).map((r) => r.m), ['I want pizza tonight']);
  assert.equal(h.search({ until: t0 }).length, 1);
  // the bot's own lines can be left out
  assert.equal(h.search({ since: t0 + 3 * day }).length, 6);
  assert.equal(h.search({ since: t0 + 3 * day, bots: false }).length, 5);
  const info = h.info();
  assert.equal(info.days, 4);
  assert.equal(info.since, '2026-01-10');

  // a fresh instance (app restart) reads the same files
  assert.equal(createChatHistory(dir).search({ limit: 1000 }).length, 9);
});

test('a broken line or a missing folder never breaks a search', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tchat-')), 'nothing-yet');
  const h = createChatHistory(dir);
  assert.deepEqual(h.search({ login: 'x' }), []);
  assert.deepEqual(h.info(), { days: 0, since: null, bytes: 0 });
  h.add({ t: Date.UTC(2026, 1, 1), login: 'x', user: 'X', text: 'ok' });
  h.flush();
  fs.appendFileSync(path.join(dir, '2026-02-01.jsonl'), '{not json\n');
  assert.equal(h.search({}).length, 1);
});

test('formatLines keeps the newest lines that fit', () => {
  const recs = Array.from({ length: 50 }, (_, i) => ({ t: Date.UTC(2026, 0, 1) + i * 60000, u: 'V', m: `message number ${i}` }));
  const text = formatLines(recs, 200);
  assert.ok(text.length <= 200);
  assert.match(text, /message number 49$/);
  assert.doesNotMatch(text, /message number 0\b/);
  assert.match(formatLines([{ t: 0, u: 'bot', m: 'x', b: 1 }]), /bot \(bot\): x/);
});
