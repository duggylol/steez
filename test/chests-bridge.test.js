// Fortnite chests from another PC: discovery, pairing approval, tokens, and Steez driving the bridge.
// A WebSocket client stands in for SteezChestBridge.exe (the real exe is checked by hand / in CI-less runs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import express from 'express';
import { WebSocket } from 'ws';
import { createRequire } from 'node:module';

const DISCOVERY = 45200 + Math.floor(Math.random() * 400);
const PORT = 45700 + Math.floor(Math.random() * 400);
process.env.STEEZ_CHESTS_BRIDGE_HOST = '127.0.0.1';
process.env.STEEZ_CHESTS_DISCOVERY_PORT = String(DISCOVERY);
process.env.STEEZ_CHESTS_BRIDGE_PORT = String(PORT);

const require = createRequire(import.meta.url);
const { init } = require('../src/main/chests/index.cjs');

const KEY = 'k';
const router = express.Router();
const app = express();
app.use(router);
const server = await new Promise((r) => {
  const s = app.listen(0, '127.0.0.1', () => r(s));
});
server.unref();
const BASE = `http://127.0.0.1:${server.address().port}`;
const features = [];
let data = null;
const mod = init({
  createStore: (f, d) => {
    data = structuredClone(d);
    return {
      get data() {
        return data;
      },
      merge: (p) => Object.assign(data, p),
      replace: (n) => (data = n),
    };
  },
  resourcesPath: 'nowhere',
  server: { router },
  checkKey: (req) => req.headers['x-steez-key'] === KEY,
  features: { register: (f) => features.push(f), changed() {} },
  overlays: { register() {} },
  twitch: { registerCommand() {}, reply() {} },
  log: { info() {}, warn() {}, error() {} },
  onQuit() {},
});
const api = (method, p, body) => fetch(BASE + p, { method, headers: { 'x-steez-key': KEY, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
after(() => features[0].set(false));

/** A pretend game PC. */
function gamePc(id, token) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/chests/bridge`);
  const got = [];
  ws.on('message', (d) => got.push(JSON.parse(String(d))));
  const opened = new Promise((r) => ws.on('open', r));
  return {
    ws,
    got,
    async hello() {
      await opened;
      ws.send(JSON.stringify({ type: 'hello', id, name: 'GAMEPC', token }));
    },
    send: (o) => ws.send(JSON.stringify(o)),
    async waitFor(pred, ms = 2000) {
      for (let t = 0; t < ms; t += 20) {
        const m = got.find(pred);
        if (m) return m;
        await sleep(20);
      }
      throw new Error('never got it; got: ' + JSON.stringify(got));
    },
  };
}

let token = null;

test('Steez answers the game PC looking for it on the network', async () => {
  await api('PUT', '/chests/api/settings', { source: 'game' });
  features[0].set(true);
  for (let i = 0; i < 50 && !mod.bridge.port; i++) await sleep(20);
  assert.equal(mod.bridge.port, PORT);
  const udp = dgram.createSocket('udp4');
  const answer = new Promise((r) => udp.on('message', (m) => r(JSON.parse(String(m)))));
  udp.send(Buffer.from('{"steez":"chests?","v":1}'), DISCOVERY, '127.0.0.1');
  const a = await answer;
  udp.close();
  assert.equal(a.steez, 'chests');
  assert.equal(a.port, PORT);
  assert.equal(mod.state.helper.status, 'waiting');
});

test('a new game PC waits until it is allowed, then gets a token and is driven by Steez', async () => {
  const pc = gamePc('a1b2c3d4e5f6a7b8');
  await pc.hello();
  await pc.waitFor((m) => m.type === 'pending');
  let st = await api('GET', '/chests/api/state');
  assert.equal(st.bridge.pending[0].name, 'GAMEPC');
  assert.equal(st.bridge.connected, null);
  assert.ok(!('bridges' in st.settings), 'token hashes never reach the page');

  st = await api('POST', '/chests/api/bridge/allow', { id: 'a1b2c3d4e5f6a7b8' });
  token = (await pc.waitFor((m) => m.type === 'paired')).token;
  assert.ok(token.length > 30);
  await pc.waitFor((m) => m.type === 'welcome');
  assert.equal(st.bridge.connected.name, 'GAMEPC');
  assert.notEqual(data.bridges[0].tokenHash, token, 'only a hash is stored');

  // The game PC says hello like the local helper; Steez sets it up the same way.
  pc.send({ type: 'ready', ocr: true, demosExists: true, replays: 100, demos: 'C:\\x', screens: [{ index: 0, name: 'DISPLAY1', primary: true }], machine: 'GAMEPC' });
  await pc.waitFor((m) => m.cmd === 'screen');
  await pc.waitFor((m) => m.cmd === 'live' && m.on === true);
  await pc.waitFor((m) => m.cmd === 'scan');
  pc.send({ type: 'live', count: 2 });
  await sleep(100);
  assert.equal(mod.overlayData().live, 2);
  st = await api('GET', '/chests/api/state');
  assert.equal(st.helper.status, 'running');
  assert.equal(st.helper.machine, 'GAMEPC');

  // Buttons on the page reach the game PC
  await api('POST', '/chests/api/adjust', { delta: 1 });
  await pc.waitFor((m) => m.cmd === 'adjust' && m.delta === 1);

  pc.ws.close();
  for (let i = 0; i < 50 && mod.bridge.link; i++) await sleep(20);
  assert.equal(mod.state.live, null, 'the live count clears when the game PC goes away');
  assert.equal(mod.state.helper.status, 'waiting');
});

test('it reconnects with its token without asking again; a wrong token has to be allowed', async () => {
  const pc = gamePc('a1b2c3d4e5f6a7b8', token);
  await pc.hello();
  await pc.waitFor((m) => m.type === 'welcome');
  assert.equal(pc.got.some((m) => m.type === 'pending'), false);
  pc.ws.close();
  await sleep(100);

  const fake = gamePc('a1b2c3d4e5f6a7b8', 'not-the-token-xxxxxxxxxxxxxxxxxxxx');
  await fake.hello();
  await fake.waitFor((m) => m.type === 'pending');
  await api('POST', '/chests/api/bridge/deny', { id: 'a1b2c3d4e5f6a7b8' });
  await fake.waitFor((m) => m.type === 'denied');
});

test('forgetting a game PC disconnects it and its token stops working', async () => {
  const pc = gamePc('a1b2c3d4e5f6a7b8', token);
  await pc.hello();
  await pc.waitFor((m) => m.type === 'welcome');
  const closed = new Promise((r) => pc.ws.on('close', r));
  await api('POST', '/chests/api/bridge/forget', { id: 'a1b2c3d4e5f6a7b8' });
  await closed;
  const again = gamePc('a1b2c3d4e5f6a7b8', token);
  await again.hello();
  await again.waitFor((m) => m.type === 'pending');
  again.ws.close();
});

test('junk connections are dropped', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/chests/bridge`);
  await new Promise((r) => ws.on('open', r));
  const closed = new Promise((r) => ws.on('close', r));
  ws.send(JSON.stringify({ type: 'hello', id: '../../etc' }));
  await closed;
  const st = await api('GET', '/chests/api/state');
  assert.equal(st.bridge.pending.length, 0);
});
