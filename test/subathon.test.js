// The subathon engine (ported Subathon Media Player): timer rules, gift bombs, media matching,
// the TV & viewer server with its password-protected /admin, the in-app API, Ko-fi and the
// Twitch chat parser fixes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import express from 'express';
import WebSocket from 'ws';

const require = createRequire(import.meta.url);
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...a) => realSetInterval(...a).unref();

const { createSubathon } = require('../src/main/subathon/engine.cjs');
const { parseMinutes } = require('../src/main/subathon/index.cjs');
const TwitchChat = require('../src/main/subathon/lib/twitch.cjs');
const Donations = require('../src/main/subathon/lib/donations.cjs');

class FakeTwitch extends EventEmitter {
  connect(ch) {
    this.channel = ch;
  }
  disconnect() {}
}
const KEY = 'k3y';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsub-'));
const twitch = new FakeTwitch();
const sub = createSubathon({
  dataDir,
  log: { info() {}, warn() {}, error() {} },
  twitchLogin: () => 'Streamer',
  keyOk: (req) => req.headers['x-steez-key'] === KEY || new URL(req.url, 'http://x').searchParams.get('key') === KEY,
  lanHost: '127.0.0.1',
  twitch,
  donations: new Donations(),
});
sub.db.lan = { enabled: true, port: 0 };
sub.db.settings.enabled = true;
await sub.start();
const LAN = `http://127.0.0.1:${sub.lanState().boundPort}`;

// the in-app door, mounted the way Steez mounts it
const app = express();
app.use('/subathon', sub.appRouter);
const appServer = http.createServer(app);
appServer.on('upgrade', (req, socket, head) => {
  const w = req.url.startsWith('/subathon/public-ws') ? sub.publicWss : sub.appWss;
  w.handleUpgrade(req, socket, head, (ws) => w.emit('connection', ws, req));
});
await new Promise((r) => appServer.listen(0, '127.0.0.1', r));
const APP = `http://127.0.0.1:${appServer.address().port}/subathon`;

after(async () => {
  appServer.closeAllConnections();
  appServer.close();
  await sub.close();
});

const reset = () => {
  Object.assign(sub.db.timer, { running: false, endsAt: 0, remaining: 3600e3, ended: false, startedAt: 0 });
  sub.db.stats = { subs: 0, bits: 0, donations: 0, timeAdded: 0 };
  sub.db.feed = [];
  Object.assign(sub.db.settings.time, { prime: 300, tier1: 300, tier2: 600, tier3: 1500, per100Bits: 120, perDollar: 60, multiplier: 1, capHours: 0, initialHours: 4 });
};
const appReq = (method, p, body) =>
  fetch(APP + p, { method, headers: { 'x-steez-key': KEY, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('channel falls back to the Steez Twitch login', () => {
  assert.equal(twitch.channel, 'streamer');
  assert.equal(sub.effectiveChannel(), 'streamer');
});

test('timer: event time, multiplier, cap, manual time', () => {
  reset();
  sub.processEvent({ type: 'sub', user: 'a', tier: 'tier1', amount: 1 });
  assert.equal(sub.db.stats.subs, 1);
  assert.equal(sub.db.stats.timeAdded, 300);
  assert.equal(sub.remainingMs(), 3600e3 + 300e3);
  sub.db.settings.time.multiplier = 2;
  sub.processEvent({ type: 'bits', user: 'b', amount: 500, message: 'Cheer500' });
  assert.equal(sub.db.stats.bits, 500);
  assert.equal(sub.db.stats.timeAdded, 300 + 1200);
  // cap: the starting 4h plus time added may not pass 4.5h
  sub.db.settings.time.multiplier = 1;
  sub.db.settings.time.capHours = 4.5;
  sub.processEvent({ type: 'donation', user: 'c', amount: 100 });
  assert.equal(sub.db.stats.donations, 100);
  assert.equal(sub.db.stats.timeAdded, 1800);
  // manual time doesn't count toward the stats or the cap
  sub.timerAction('add', 600);
  assert.equal(sub.db.stats.timeAdded, 1800);
  sub.timerAction('start');
  assert.equal(sub.timerState().running, true);
  sub.timerAction('pause');
  sub.timerAction('set', 10);
  assert.equal(sub.remainingMs(), 10e3);
  sub.timerAction('reset');
  assert.equal(sub.remainingMs(), 4 * 3600e3);
});

test('timer ends on its own', async () => {
  reset();
  sub.timerAction('set', 0.3);
  sub.timerAction('start');
  await wait(1200);
  assert.equal(sub.timerState().ended, true);
  assert.equal(sub.timerState().running, false);
  // events after the end add nothing
  sub.processEvent({ type: 'sub', user: 'late', tier: 'tier1', amount: 1 });
  assert.equal(sub.db.stats.timeAdded, 0);
});

test('gift bombs: the bomb alerts, the individual gifts add the time', () => {
  reset();
  sub.processEvent({ type: 'giftbomb', user: 'g', tier: 'tier1', amount: 3 });
  assert.equal(sub.db.stats.subs, 0);
  assert.equal(sub.db.feed.length, 1);
  assert.equal(sub.db.feed[0].added, 900); // estimate shown in the alert
  for (let i = 0; i < 3; i++) sub.processEvent({ type: 'gift', user: 'g', tier: 'tier1', amount: 1, partOfBomb: true });
  assert.equal(sub.db.stats.subs, 3);
  assert.equal(sub.db.stats.timeAdded, 900);
  assert.equal(sub.db.feed.length, 1);
  // a test bomb has no follow-ups, so it counts itself (with "count for real")
  sub.testEvent({ type: 'giftbomb', amount: 5, real: true });
  assert.equal(sub.db.stats.subs, 8);
  // a dry test changes nothing but shows up marked as a test
  sub.testEvent({ type: 'bits', amount: 1000 });
  assert.equal(sub.db.stats.bits, 0);
  assert.equal(sub.db.feed[0].test, true);
});

test('media matching: codes, exact price, tier mode', () => {
  sub.db.media = [
    { id: '1', name: 'Horn', enabled: true, code: 'horn', prices: { bits: 100, subs: null, donation: 5 } },
    { id: '2', name: 'Scream', enabled: true, code: 'scream', prices: { bits: 300, subs: 5, donation: null } },
    { id: '3', name: 'Off', enabled: false, code: '', prices: { bits: 500 } },
  ];
  sub.db.settings.triggerPrefix = '#';
  sub.db.settings.matchMode = 'exact';
  const names = (list) => list.map((m) => m.name);
  assert.deepEqual(names(sub.matchMedia('bits', 400, 'wake up #scream #horn')), ['Scream', 'Horn']);
  assert.deepEqual(names(sub.matchMedia('bits', 350, 'wake up #scream #horn')), ['Scream']);
  assert.deepEqual(names(sub.matchMedia('bits', 50, '#horn')), []);
  assert.deepEqual(names(sub.matchMedia('bits', 100, 'Cheer100')), ['Horn']);
  assert.deepEqual(names(sub.matchMedia('bits', 500, '')), []); // disabled item
  assert.deepEqual(names(sub.matchMedia('subs', 5, '')), ['Scream']);
  sub.db.settings.matchMode = 'tier';
  assert.deepEqual(names(sub.matchMedia('bits', 999, '')), ['Scream']);
  assert.deepEqual(names(sub.matchMedia('donation', 7, '')), ['Horn']);
  sub.db.settings.matchMode = 'exact';
  sub.db.media = [];
});

test('LAN server: viewer page and public API open, /admin needs the password', async () => {
  assert.equal((await fetch(LAN + '/')).status, 200);
  assert.equal((await fetch(LAN + '/admin')).status, 200);
  const pub = await (await fetch(LAN + '/api/public')).json();
  assert.equal(pub.settings.channel, 'streamer');
  assert.equal(pub.feed.some((f) => f.test), false);
  assert.equal((await fetch(LAN + '/static/js/tv.js')).status, 200);
  assert.equal((await fetch(LAN + '/api/admin/state')).status, 401);
  // the Steez key does nothing on the network door
  assert.equal((await fetch(LAN + '/api/admin/state', { headers: { 'x-steez-key': KEY } })).status, 401);
  // TV code page and links
  const wrong = await fetch(LAN + '/tv/NOPE', { redirect: 'manual' });
  assert.equal(wrong.headers.get('location'), '/tv?wrong=1');
  assert.equal((await fetch(LAN + '/tv/' + sub.db.tvCode)).status, 200);
  const typed = await fetch(LAN + '/tv', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'code=' + sub.db.tvCode.toLowerCase() });
  assert.equal(typed.headers.get('location'), '/tv/' + sub.db.tvCode);

  // first-time password set from the in-app page, then the remote login
  assert.deepEqual(await (await fetch(LAN + '/api/auth')).json(), { setup: true, loggedIn: false });
  assert.equal((await appReq('POST', '/api/password', { password: 'hunter22' })).status, 200);
  const post = (p, body, headers = {}) => fetch(LAN + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post('/api/login', { password: 'nope' })).status, 401);
  const ok = await post('/api/login', { password: 'hunter22' });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  const st = await fetch(LAN + '/api/admin/state', { headers: { cookie } });
  assert.equal(st.status, 200);
  const state = await st.json();
  assert.equal(state.auth, undefined);
  assert.equal(state.hasPassword, true);
  // remote password change needs the current one
  assert.equal((await post('/api/password', { current: 'x', password: 'newpass1' }, { cookie })).status, 400);
  assert.equal((await post('/api/password', { current: 'hunter22', password: 'newpass1' }, { cookie })).status, 200);
});

test('in-app API: key required, uploads, play on the TV, goals, LAN controls', async () => {
  assert.equal((await fetch(APP + '/api/admin/state')).status, 401);
  const state = await (await appReq('GET', '/api/admin/state')).json();
  assert.equal(state.lan.running, true);
  assert.equal(state.twitchLogin, 'streamer');

  // a TV connects with its code and receives what gets played
  const tv = new WebSocket(LAN.replace('http', 'ws') + '/ws?role=tv&code=' + sub.db.tvCode);
  const tvMsgs = [];
  tv.on('message', (d) => tvMsgs.push(JSON.parse(d)));
  await new Promise((r) => tv.on('open', r));
  const bad = new WebSocket(LAN.replace('http', 'ws') + '/ws?role=tv&code=WRONG1');
  await new Promise((r) => bad.on('error', r));

  // the in-app admin socket
  const admin = new WebSocket(APP.replace('http', 'ws') + '/ws?role=admin&key=' + KEY);
  const adminMsgs = [];
  admin.on('message', (d) => adminMsgs.push(JSON.parse(d)));
  await new Promise((r) => admin.on('open', r));
  const noKey = new WebSocket(APP.replace('http', 'ws') + '/ws?role=admin');
  const noKeyClose = await new Promise((r) => noKey.on('close', (code) => r(code)));
  assert.equal(noKeyClose, 4001);

  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('ID3fake-mp3')], { type: 'audio/mpeg' }), 'Air Horn.mp3');
  const up = await (await fetch(APP + '/api/media', { method: 'POST', headers: { 'x-steez-key': KEY }, body: fd })).json();
  assert.equal(up.item.name, 'Air Horn');
  assert.equal(up.item.type, 'audio');
  assert.equal((await fetch(APP + '/media/' + up.item.file)).status, 200);
  assert.equal((await fetch(LAN + '/media/' + up.item.file)).status, 200);
  const bin = new FormData();
  bin.append('file', new Blob([Buffer.from('x')]), 'evil.exe');
  assert.equal((await fetch(APP + '/api/media', { method: 'POST', headers: { 'x-steez-key': KEY }, body: bin })).status, 400);

  await appReq('PUT', '/api/media/' + up.item.id, { prices: { bits: '250' }, code: '#Horn ', effect: 'shake' });
  assert.equal(sub.db.media[0].code, 'horn');
  assert.equal(sub.db.media[0].prices.bits, 250);
  await appReq('POST', '/api/media/' + up.item.id + '/play', {});
  // a real cheer with the code plays it too; while the menu is paused it doesn't (the event still counts)
  sub.processEvent({ type: 'bits', user: 'v', amount: 250, message: 'Cheer250 #horn' });
  await appReq('PUT', '/api/settings', { mediaPaused: true });
  const before = sub.db.stats.bits;
  sub.processEvent({ type: 'bits', user: 'v', amount: 250, message: 'Cheer250 #horn' });
  assert.equal(sub.db.stats.bits, before + 250);
  await wait(150);
  assert.equal(tvMsgs[0].t, 'init');
  assert.equal(tvMsgs[0].role, 'tv');
  assert.equal(tvMsgs.filter((m) => m.t === 'play').length, 2);
  assert.equal(tvMsgs.find((m) => m.t === 'play').item.url, '/media/' + up.item.file);
  await appReq('PUT', '/api/settings', { mediaPaused: false });
  const checked = await (await appReq('POST', '/api/test-match', { currency: 'bits', amount: 300, message: '#horn' })).json();
  assert.deepEqual(checked.matched.map((m) => m.name), ['Air Horn']);

  // the TV's now-playing reaches the in-app dashboard
  tv.send(JSON.stringify({ t: 'nowPlaying', item: { name: 'Air Horn' }, queue: 1 }));
  await wait(100);
  assert.ok(adminMsgs.some((m) => m.t === 'init' && m.role === 'admin'));
  assert.ok(adminMsgs.some((m) => m.t === 'nowPlaying' && m.item && m.item.name === 'Air Horn'));
  assert.ok(adminMsgs.some((m) => m.t === 'status' && m.statuses.tvs === 1));

  // goals follow the stats
  await appReq('POST', '/api/goals', { title: '1k bits', metric: 'bits', target: 1000 });
  assert.equal(sub.goalsOut()[0].current, sub.db.stats.bits);

  // test chat shows on the TV and the dashboard
  await appReq('POST', '/api/test-chat', {});
  await wait(100);
  assert.ok(tvMsgs.some((m) => m.t === 'chat' && /Kappa/.test(m.msg.text) && m.msg.emotes.startsWith('25:')));

  // a new TV code disconnects the TV
  const closed = new Promise((r) => tv.on('close', r));
  await appReq('POST', '/api/tv/regen-code');
  await closed;

  // the server can be turned off
  const lan = await (await appReq('PUT', '/api/lan', { enabled: false })).json();
  assert.equal(lan.lan.running, false);
  assert.equal((await (await appReq('GET', '/api/admin/state')).json()).lanUrls.length, 0);
  admin.close();
});

test('Ko-fi webhook adds a donation once', async () => {
  reset();
  sub.db.lan = { enabled: true, port: 0 };
  await sub.restartLan();
  const lanUrl = `http://127.0.0.1:${sub.lanState().boundPort}`;
  await appReq('PUT', '/api/settings', { donation: { provider: 'kofi', kofiToken: 'tok' } });
  const post = (data) =>
    fetch(lanUrl + '/webhook/kofi', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(JSON.stringify(data)) });
  assert.equal((await post({ verification_token: 'bad', amount: '5' })).status, 401);
  const tip = { verification_token: 'tok', message_id: 'm1', type: 'Donation', from_name: 'Fan', amount: '5.00', message: 'go!', is_public: true };
  assert.equal((await post(tip)).status, 200);
  assert.equal((await post(tip)).status, 200);
  assert.equal(sub.db.stats.donations, 5);
  assert.equal(sub.db.feed[0].user, 'Fan');
  await appReq('PUT', '/api/settings', { donation: { provider: 'none' } });
});

test('data survives a restart, and the standalone app can be imported', async () => {
  sub.store.saveNow();
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.equal(saved.tvCode, sub.db.tvCode);
  // a standalone install: <folder>/data/db.json + uploads
  const legacy = fs.mkdtempSync(path.join(os.tmpdir(), 'tsmp-'));
  fs.mkdirSync(path.join(legacy, 'data', 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'data', 'uploads', 'abc.mp3'), 'x');
  fs.writeFileSync(
    path.join(legacy, 'data', 'db.json'),
    JSON.stringify({ tvCode: 'LEGACY', settings: { title: 'OLD ONE', channel: 'oldchan' }, media: [{ id: 'm', name: 'Old', file: 'abc.mp3', type: 'audio', enabled: true, prices: { bits: 1 } }], goals: [{ id: 'g', title: 'x', metric: 'subs', target: 5 }] }),
  );
  const r = sub.importFrom(legacy);
  assert.deepEqual(r, { media: 1, goals: 1, files: 1 });
  assert.equal(sub.db.tvCode, 'LEGACY');
  assert.equal(sub.db.settings.title, 'OLD ONE');
  assert.equal(sub.db.settings.time.tier1, 300); // defaults fill the gaps
  assert.equal(twitch.channel, 'oldchan');
  assert.ok(fs.existsSync(path.join(dataDir, 'uploads', 'abc.mp3')));
});

test('twitch chat parser: shared chat, anonymous gifts, upgrades, clears', () => {
  const t = new TwitchChat();
  const events = [],
    chats = [],
    clears = [];
  t.on('event', (e) => events.push(e));
  t.on('chat', (c) => chats.push(c));
  t.on('clear', (c) => clears.push(c));
  const line = (s) => t.handle(TwitchChat.parseLine(s));
  line('@room-id=1;source-room-id=2;display-name=Other;bits=100 :other!other@x PRIVMSG #me :Cheer100 hi');
  line('@room-id=1;source-room-id=1;display-name=Mine;id=a1 :mine!mine@x PRIVMSG #me :hello');
  line('@room-id=1;msg-id=anonsubgift;login=ananonymousgifter;display-name=AnAnonymousGifter;msg-param-sub-plan=1000;msg-param-recipient-display-name=Lucky;msg-param-community-gift-id=99 :tmi.twitch.tv USERNOTICE #me');
  line('@room-id=1;msg-id=submysterygift;login=ananonymousgifter;display-name=AnAnonymousGifter;msg-param-sub-plan=2000;msg-param-mass-gift-count=5 :tmi.twitch.tv USERNOTICE #me');
  line('@room-id=1;msg-id=giftpaidupgrade;login=lee;display-name=Lee :tmi.twitch.tv USERNOTICE #me');
  line('@room-id=1;source-room-id=2;msg-id=sub;login=x;display-name=X;msg-param-sub-plan=1000 :tmi.twitch.tv USERNOTICE #me');
  line('@room-id=1;target-msg-id=a1 :tmi.twitch.tv CLEARMSG #me :hello');
  line('@room-id=1 :tmi.twitch.tv CLEARCHAT #me :baduser');
  assert.deepEqual(chats.map((c) => c.user), ['Mine']);
  assert.equal(events.length, 3);
  assert.deepEqual([events[0].type, events[0].user, events[0].partOfBomb], ['gift', 'Anonymous', true]);
  assert.deepEqual([events[1].type, events[1].user, events[1].amount, events[1].tier], ['giftbomb', 'Anonymous', 5, 'tier2']);
  assert.deepEqual([events[2].type, events[2].user], ['sub', 'Lee']);
  assert.deepEqual(clears, [{ id: 'a1' }, { user: 'baduser' }]);
});

test('!addtime parses durations', () => {
  assert.equal(parseMinutes('10'), 10);
  assert.equal(parseMinutes('10m'), 10);
  assert.equal(parseMinutes('1h30m'), 90);
  assert.equal(parseMinutes('-15m'), -15);
  assert.equal(parseMinutes('90s'), 1.5);
  assert.equal(parseMinutes('soon'), null);
});

test('TikTok gifts: rules play media, combos count once, coins add time', async () => {
  reset();
  sub.db.media = [{ id: 'h', name: 'Horn', file: 'x.mp3', type: 'audio', enabled: true, prices: {} }];
  await appReq('PUT', '/api/tiktok-rules', { rules: [{ gift: 'rose', mediaId: 'h', minCount: 5, addSeconds: 30 }] });
  assert.equal(sub.db.tiktokRules[0].gift, 'Rose'); // matched the known gift
  assert.equal(sub.db.tiktokRules[0].coins, 1);
  // a combo: the rising events wait for the final one
  const g = { login: 'fan', name: 'Fan', giftId: '5655', giftName: 'Rose', giftImage: 'https://x/rose.png', diamonds: 1, giftType: 1 };
  sub.handleTiktokGift({ ...g, repeatCount: 2, repeatEnd: false });
  sub.handleTiktokGift({ ...g, repeatCount: 6, repeatEnd: false });
  assert.equal(sub.db.feed.length, 0);
  sub.handleTiktokGift({ ...g, repeatCount: 6, repeatEnd: true });
  assert.equal(sub.db.feed.length, 1);
  const item = sub.db.feed[0];
  assert.deepEqual([item.type, item.gift, item.amount, item.coins], ['tiktok', 'Rose', 6, 6]);
  assert.deepEqual(item.media, ['Horn']);
  assert.equal(sub.db.stats.tiktokCoins, 6);
  // 60s per 100 coins → 3.6s, plus the rule's 30s
  assert.equal(sub.db.stats.timeAdded, 33.6);
  // the gift was remembered (picture + id) and the rule picked them up
  assert.equal(sub.db.tiktokRules[0].image, 'https://x/rose.png');
  // below the rule minimum: no media; below the alert minimum: no alert
  sub.db.settings.tiktok.alertMinCoins = 10;
  sub.handleTiktokGift({ ...g, giftType: 0, repeatCount: 2 });
  assert.equal(sub.db.feed.length, 1);
  assert.equal(sub.db.stats.tiktokCoins, 8);
  // public state shows the gift on the media
  const pub = await (await fetch(`http://127.0.0.1:${sub.lanState().boundPort}/api/public`)).json();
  assert.deepEqual(pub.media[0].tiktok, [{ gift: 'Rose', image: 'https://x/rose.png', coins: 1, minCount: 5 }]);
  assert.equal(pub.media[0].previewUrl, '/media/x.mp3');
  assert.equal(pub.settings.tiktokEnabled, true);
  // test lab gift
  sub.testEvent({ type: 'tiktok', gift: 'Galaxy', amount: 1 });
  assert.equal(sub.db.feed[0].coins, 1000);
  assert.equal(sub.db.stats.tiktokCoins, 8); // dry
  sub.db.settings.tiktok.alertMinCoins = 1;
});

test('alert effects scale with the size of the support', () => {
  const fx = (ev) => sub.fxFor(ev);
  assert.deepEqual(fx({ type: 'sub' }), { effect: 'pop', level: 1 });
  assert.deepEqual(fx({ type: 'giftbomb', amount: 5 }), { effect: 'confetti', level: 3 });
  assert.deepEqual(fx({ type: 'giftbomb', amount: 30 }), { effect: 'rainbow', level: 5 });
  assert.deepEqual(fx({ type: 'bits', amount: 999 }), { effect: 'glow', level: 2 });
  assert.deepEqual(fx({ type: 'bits', amount: 5000 }), { effect: 'fireworks', level: 4 });
  assert.deepEqual(fx({ type: 'donation', amount: 100 }), { effect: 'rainbow', level: 5 });
  assert.deepEqual(fx({ type: 'tiktok', coins: 1000 }), { effect: 'fireworks', level: 4 });
  sub.db.settings.effects.tiers[1].effect = 'shockwave';
  assert.equal(fx({ type: 'bits', amount: 500 }).effect, 'shockwave');
  sub.db.settings.effects.enabled = false;
  assert.deepEqual(fx({ type: 'bits', amount: 10000 }), { effect: 'pop', level: 1 });
  sub.db.settings.effects.enabled = true;
  sub.db.settings.effects.tiers[1].effect = 'glow';
});

test('the menu overlay page is served on both doors', async () => {
  assert.equal((await fetch(`http://127.0.0.1:${sub.lanState().boundPort}/overlay/menu`)).status, 200);
  const ws = new WebSocket(APP.replace('http', 'ws').replace('/subathon', '') + '/subathon/public-ws');
  await new Promise((r) => ws.on('open', r));
  ws.close();
});

test('switching the subathon off stops everything, including the clock', async () => {
  sub.timerAction('set', 600);
  sub.timerAction('start');
  await sub.setEnabled(false);
  assert.equal(sub.isOn(), false);
  assert.equal(sub.timerState().running, false);
  assert.equal(sub.lanState().running, false);
  assert.equal(sub.handleTiktokGift({ login: 'a', giftName: 'Rose', diamonds: 1, giftType: 0 }), null);
  await sub.setEnabled(true);
  assert.equal(sub.lanState().running, true);
});
