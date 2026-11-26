// The Twitch Chat OBS dock: a lasting key that opens the chat feed and nothing else.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.STEEZ_BOT_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tbdock-'));
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...a) => realSetInterval(...a).unref();

const express = (await import('express')).default;
const { default: WebSocket } = await import('ws');
const { bot } = await import('../src/main/bot/core/bot.js');
const { createChatFeed, chatDockKey, isChatDockKey } = await import('../src/main/bot/chatFeed.js');
const { createBotRouter } = await import('../src/main/bot/web/api.js');
const { createHub, broadcast } = await import('../src/main/bot/web/hub.js');

let server, base, feed;
before(async () => {
  await bot.init();
  feed = createChatFeed(bot);
  const app = express();
  app.use(createBotRouter({ key: 'window-key', openUrl: () => {} }));
  server = http.createServer(app);
  const wss = createHub({ isAuthed: (req) => new URL(req.url, 'http://x').searchParams.get('key') === 'window-key' });
  server.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req)));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('the dock key lasts, can be renewed, and is checked exactly', () => {
  const k = chatDockKey();
  assert.equal(chatDockKey(), k);
  assert.ok(isChatDockKey(k));
  assert.ok(!isChatDockKey(k.slice(0, -1) + (k.at(-1) === 'a' ? 'b' : 'a')));
  assert.ok(!isChatDockKey(''));
  assert.ok(!isChatDockKey(undefined));
  const k2 = chatDockKey(true);
  assert.notEqual(k2, k);
  assert.ok(!isChatDockKey(k));
});

test('the dock API opens the chat with the key and refuses without it', async () => {
  feed.push({ id: 'x1', kind: 'chat', cat: 'chat', user: { login: 'v', display: 'V', badges: [] }, text: 'hello dock', emotes: [] });
  const bad = await fetch(`http://${base}/dockapi/chat/recent`, { headers: { 'x-dock-key': 'nope' } });
  assert.equal(bad.status, 401);
  const ok = await fetch(`http://${base}/dockapi/chat/recent`, { headers: { 'x-dock-key': chatDockKey() } });
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.ok(j.result.items.some((it) => it.text === 'hello dock'));
  // the dock key is not the window's key: the rest of the API stays shut
  assert.equal((await fetch(`http://${base}/api/state`, { headers: { 'x-steez-key': chatDockKey() } })).status, 401);
});

test('a dock socket gets chat lines and nothing else from the Steez window feed', async () => {
  const ws = new WebSocket(`ws://${base}/ws?dock=${chatDockKey()}`);
  const got = [];
  ws.on('message', (m) => got.push(JSON.parse(m.toString()).type));
  await new Promise((r) => ws.on('open', r));
  broadcast('log', { msg: 'secret log line' }, { dashboardOnly: true });
  broadcast('chatfeed', { id: 'x2' }, { dashboardOnly: true });
  broadcast('chatfeed:del', { id: 'x2' }, { dashboardOnly: true });
  await new Promise((r) => setTimeout(r, 100));
  ws.close();
  assert.deepEqual(got, ['chatfeed', 'chatfeed:del']);
});

test('chatting from the dock explains what is wrong before anything reaches Twitch', async () => {
  const say = (text) => fetch(`http://${base}/dockapi/chat/say`, { method: 'POST', headers: { 'x-dock-key': chatDockKey(), 'content-type': 'application/json' }, body: JSON.stringify({ text }) }).then(async (r) => [r.status, (await r.json()).error]);
  assert.deepEqual(await say('   '), [400, 'Type a message first.']);
  assert.deepEqual((await say('x'.repeat(501)))[0], 400);
  assert.match((await say('/ban someone'))[1], /Slash commands/);
  assert.match((await say('hello chat'))[1], /Connect your Twitch channel/); // no channel connected in this test
  const noKey = await fetch(`http://${base}/dockapi/chat/say`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"text":"hi"}' });
  assert.equal(noKey.status, 401);
});
