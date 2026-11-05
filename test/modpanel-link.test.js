// The Mod Panel link must recover from a refused connection on its own and explain why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.STEEZ_BOT_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tblink-'));
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...a) => realSetInterval(...a).unref();

const { bot } = await import('../src/main/bot/core/bot.js');
const { db } = await import('../src/main/bot/store.js');
const { config } = await import('../src/main/bot/config.js');
const { startModPanel } = await import('../src/main/modPanel.js');

test('a refused connection is retried and the reason is shown', async () => {
  let attempts = 0;
  let reply = { status: 502, error: 'relay_error' };
  const server = http.createServer();
  server.on('upgrade', (req, socket) => {
    attempts++;
    const body = JSON.stringify({ error: reply.error });
    socket.end(`HTTP/1.1 ${reply.status} X\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  config.relayUrl = `http://127.0.0.1:${server.address().port}`;
  config.clientId = 'steezapp';
  db.auth.broadcaster = { accessToken: 'tok', clientId: 'steezapp', userId: '1', login: 'friend', scopes: [] };
  await bot.init();

  const link = startModPanel({ send: () => {}, version: 'test' });
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(link.status().state, 'error');
  assert.match(link.status().detail, /502/);
  await new Promise((r) => setTimeout(r, 2600)); // first retry is after ~2s
  assert.ok(attempts >= 2, `expected a retry, saw ${attempts} attempt(s)`);

  reply = { status: 403, error: 'wrong_app' };
  await bot.runAction('modpanel:reconnect');
  await new Promise((r) => setTimeout(r, 600));
  assert.match(link.status().detail, /another app/);
  server.close();
});

test('a login from another app is caught before connecting', async () => {
  db.auth.broadcaster.clientId = 'songseekapp';
  const link = startModPanel({ send: () => {}, version: 'test' });
  assert.equal(link.status().state, 'error');
  assert.match(link.status().detail, /SongSeek/);
});
