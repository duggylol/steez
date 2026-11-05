// Mod Panel action handlers: permissions, validation and the activity log.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.STEEZ_BOT_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tbmod-'));
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...a) => realSetInterval(...a).unref();

const { bot } = await import('../src/main/bot/core/bot.js');
const { db } = await import('../src/main/bot/store.js');
const { startModPanel } = await import('../src/main/modPanel.js');

const sent = [];
let H;
const mod = { login: 'trustedmod', id: '42' };

before(async () => {
  await bot.init();
  for (const n of ['giveaways', 'polls', 'quotes']) (await import(`../src/main/bot/modules/${n}.js`)).init(bot);
  H = startModPanel({ send: (ch, p) => sent.push([ch, p]), version: 'test' }).handlers;
});

test('mods can add, edit, rename and delete custom commands', async () => {
  H['commands.save']({ name: '!socials', def: { response: 'Follow ${user}', level: 'everyone', cooldown: 5 } }, mod);
  assert.equal(db.commands.socials.response, 'Follow ${user}');
  H['commands.save']({ name: 'links', oldName: 'socials', def: { response: 'Links here', level: 'subscriber' } }, mod);
  assert.equal(db.commands.socials, undefined);
  assert.equal(db.commands.links.level, 'subscriber');
  H['commands.delete']({ name: 'links' }, mod);
  assert.equal(db.commands.links, undefined);
  assert.equal(db.modActivity[0].mod, 'trustedmod');
  assert.match(db.modActivity[0].summary, /deleted !links/);
});

test('mods cannot use ${eval}, spaces, or overwrite commands', () => {
  assert.throws(() => H['commands.save']({ name: 'x', def: { response: '${eval 1}' } }, mod), /streamer/);
  assert.throws(() => H['commands.save']({ name: 'two words', def: { response: 'hi' } }, mod), /spaces/);
  H['commands.save']({ name: 'a1', def: { response: 'one' } }, mod);
  assert.throws(() => H['commands.save']({ name: 'a1', def: { response: 'two' } }, mod), /already exists/);
});

test('permissions are enforced', () => {
  assert.throws(() => H['points.adjust']({ login: 'viewer', amount: 50 }, mod), /allowed/); // points are off by default
  db.settings.modPanel.points = true;
  const r = H['points.adjust']({ login: 'viewer', amount: 50 }, mod);
  assert.equal(r.points, 50);
  db.settings.modPanel.commands = false;
  assert.throws(() => H['commands.list'](), /allowed/);
  db.settings.modPanel.commands = true;
  db.settings.modPanel.enabled = false;
  assert.throws(() => H['quotes.list'](), /turned the mod panel off/);
  db.settings.modPanel.enabled = true;
});

test('song buttons drive the music player like chat commands', () => {
  H['songs.command']({ cmd: 'skip' }, mod);
  assert.deepEqual(sent.at(-1), ['ss:twitch:command', { cmd: 'skip', user: 'trustedmod', isMod: true }]);
  assert.throws(() => H['songs.command']({ cmd: 'delete-everything' }, mod), /Unknown/);
});

test('quotes, timers, polls and giveaways', async () => {
  const id = H['quotes.add']({ text: 'mods were here' }, mod);
  assert.ok(db.quotes.find((q) => q.id === id));
  H['quotes.delete']({ id }, mod);
  assert.ok(!db.quotes.find((q) => q.id === id));
  const t = H['timers.save']({ timer: { name: 'Hydrate', intervalMinutes: 0, messages: ['drink water', ''] } }, mod);
  assert.equal(t.intervalMinutes, 15); // invalid interval falls back to the default
  assert.deepEqual(t.messages, ['drink water']);
  H['timers.delete']({ id: t.id }, mod);
  await H['polls.start']({ question: 'Best?', options: ['A', 'B'] }, mod);
  assert.equal(H['polls.state']().poll.question, 'Best?');
  await H['giveaway.start']({ title: 'Key' }, mod);
  assert.equal(H['giveaway.state']().raffle.title, 'Key');
});
