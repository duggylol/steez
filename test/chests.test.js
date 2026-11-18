// Fortnite chest tracker: the running total, overlay data, settings API and !chests
// (ChestTracker.exe itself is replaced by events fed straight into the module).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { init } = require('../src/main/chests/index.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tchests-'));
const KEY = 'k';
const router = express.Router();
const app = express();
app.use(router);
const server = await new Promise((r) => {
  const s = app.listen(0, '127.0.0.1', () => r(s));
});
server.unref();
const BASE = `http://127.0.0.1:${server.address().port}`;

const commands = {};
const replies = [];
const features = [];
function createStore(file, defaults) {
  let data = structuredClone(defaults);
  return {
    get data() {
      return data;
    },
    merge: (p) => Object.assign(data, p),
    replace: (n) => (data = n),
  };
}
const mod = init({
  createStore,
  resourcesPath: path.join(dir, 'nothing-here'), // no ChestTracker.exe: the module reports it missing
  server: { router },
  checkKey: (req) => req.headers['x-steez-key'] === KEY,
  features: { register: (f) => features.push(f), changed() {} },
  overlays: { register() {} },
  twitch: { registerCommand: (n, d) => (commands[n] = d), reply: (m, t) => replies.push(t) },
  log: { info() {}, warn() {}, error() {} },
  onQuit() {},
});
const put = (body) => fetch(BASE + '/chests/api/settings', { method: 'PUT', headers: { 'x-steez-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const stats = (matches, live = null) => mod.onEvent({ type: 'stats', live, last: matches.at(-1)?.n ?? null, periods: { all: { matches: matches.length, chests: matches.reduce((s, m) => s + m.n, 0), avg: 20, best: 30 } }, matches });

test('off by default; turning it on without the helper says it is missing', () => {
  const f = features.find((x) => x.id === 'chests');
  assert.equal(f.get(), false);
  f.set(true);
  assert.equal(mod.state.helper.status, 'missing');
  assert.equal(f.get(), true);
});

test('your total: set a number, then every chest counts up from it', async () => {
  const old = new Date(Date.now() - 86400e3).toISOString();
  stats([{ t: old, n: 25 }]);
  let s = await put({ total: { on: true, count: 1500 } });
  assert.equal(s.total, 1500, 'jumps to the number you set');
  assert.equal(mod.runningTotal(), 1500, 'older matches are not added on top');

  await new Promise((r) => setTimeout(r, 5));
  const matchStart = new Date().toISOString(); // the next match starts after the total was set
  mod.onEvent({ type: 'live', count: 3 }); // a match is going: 3 chests so far
  assert.equal(mod.runningTotal(), 1503);
  assert.equal(mod.overlayData().total, 1503);
  assert.equal(mod.overlayData().live, 3);

  // the match ends; the replay says 4 (the live counter missed one)
  mod.onEvent({ type: 'live', count: null });
  stats([{ t: old, n: 25 }, { t: matchStart, n: 4 }]);
  assert.equal(mod.runningTotal(), 1504, 'the exact replay count replaces the live one');
});

test('setting the total in the middle of a match does not double count it', async () => {
  const earlier = [{ t: new Date(Date.now() - 86400e3).toISOString(), n: 25 }];
  stats(earlier);
  mod.onEvent({ type: 'live', count: 5 });
  const s = await put({ total: { count: 100 } });
  assert.equal(s.total, 100, 'what you typed, including this match so far');
  mod.onEvent({ type: 'live', count: 6 });
  assert.equal(mod.runningTotal(), 101);
  // match ends: its replay is stamped with the match start (before you set the total)
  mod.onEvent({ type: 'live', count: null });
  stats([...earlier, { t: new Date(Date.now() - 20 * 60e3).toISOString(), n: 6 }]);
  assert.equal(mod.runningTotal(), 101);
});

test('settings are checked, the key is required, overlay options apply', async () => {
  assert.equal((await fetch(BASE + '/chests/api/state')).status, 401);
  const s = await put({ overlay: { title: 'LOOT', accent: '#ff0000', showBest: false }, screenIndex: 1, liveCounter: false });
  assert.equal(s.settings.overlay.title, 'LOOT');
  assert.equal(s.settings.overlay.accent, '#ff0000');
  assert.equal(s.overlay.show.best, false);
  assert.equal(s.settings.screenIndex, 1);
  await put({ overlay: { accent: 'red; background:url(x)' } });
  assert.equal(mod.store.data.overlay.accent, '#ff0000', 'bad colours are ignored');
  assert.ok(!('matches' in (s.stats || {})), 'the full match list stays out of the page state');
});

test('overlay page and its live feed are open to OBS', async () => {
  const html = await (await fetch(BASE + '/overlay/chests')).text();
  assert.match(html, /EventSource\('\/chests\/overlay-stream'\)/);
  const ac = new AbortController();
  const r = await fetch(BASE + '/chests/overlay-stream', { signal: ac.signal });
  const reader = r.body.getReader();
  const { value } = await reader.read();
  const first = JSON.parse(new TextDecoder().decode(value).split('data: ')[1]);
  ac.abort();
  assert.equal(first.title, 'LOOT');
  assert.ok('total' in first && 'live' in first);
  assert.ok(!JSON.stringify(first).includes('statsPath'));
});

test('!chests in chat', async () => {
  mod.onEvent({ type: 'live', count: 7 });
  commands.chests.handler({ display: 'viewer' }, []);
  assert.match(replies.at(-1), /7 chests this match/);
  assert.match(replies.at(-1), /total/);
  await put({ chatCommand: false });
  assert.equal(commands.chests.handler({ display: 'viewer' }, []), false);
});
