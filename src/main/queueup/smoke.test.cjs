'use strict';
// Viewer queue + TikTok gifts: state logic, chat commands, the QueueUp import, and the
// overlay HTTP/websocket endpoints — driven through init(ctx) with a stubbed Steez context.
// No Electron needed:  node --test src/main/queueup/smoke.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');

/* ------------------------------------------------------------------ */
/* stubs                                                               */
/* ------------------------------------------------------------------ */

// A fake TikTok LIVE connection: reports "live" (unless the user is 'notliveyet'),
// connects instantly, and lets the test push gift events shaped like tiktok-live-proto v3.
const tiktokConnections = [];
class FakeTikTokConnection extends EventEmitter {
  constructor(username, options) {
    super();
    this.username = username;
    this.options = options;
    this.roomId = '';
    tiktokConnections.push(this);
  }
  async fetchIsLive() {
    return this.username !== 'notliveyet';
  }
  async connect() {
    this.roomId = '7000000000000000001';
    return { roomId: this.roomId };
  }
  async disconnect() {
    this.emit('disconnected');
  }
}
const realLoad = Module._load;
Module._load = function (request) {
  if (request === 'tiktok-live-connector') {
    return {
      TikTokLiveConnection: FakeTikTokConnection,
      WebcastEvent: { GIFT: 'gift', ROOM_USER: 'roomUser', STREAM_END: 'streamEnd' },
      ControlEvent: { CONNECTED: 'connected', DISCONNECTED: 'disconnected', ERROR: 'error' },
    };
  }
  return realLoad.apply(this, arguments);
};

// Helix: every login resolves to a picture except 'ghostuser'.
let helixCalls = 0;
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('helix/users')) {
    helixCalls++;
    const logins = new URL(u).searchParams.getAll('login');
    const body = {
      data: logins
        .filter((l) => l !== 'ghostuser')
        .map((l) => ({ login: l, profile_image_url: `https://static-cdn.jtvnw.net/jtv_user_pictures/${l}-profile_image-300x300.png` })),
    };
    return { ok: true, status: 200, json: async () => body };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const { Store, formatQueueMessage, DEFAULT_SETTINGS } = require('./state.cjs');
const { createGiftTracker } = require('./gifts.cjs');
const ts = require('./tiktokStats.cjs');
const queueup = require('./index.cjs');
const widgetStyles = require('./widgetStyles.cjs');

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `steez-queueup-${name}-`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The parts of Steez's module ctx that QueueUp uses, backed by a real express server. */
async function bootModule({ userData, imports = {}, importsDone = {} } = {}) {
  const app = express();
  const router = express.Router();
  app.use(router);
  const server = http.createServer(app);
  const upgrades = [];
  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    const hit = upgrades.find((u) => u.match(pathname));
    if (!hit) return socket.destroy();
    hit.wss.handleUpgrade(req, socket, head, (ws) => hit.wss.emit('connection', ws, req));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const chat = new EventEmitter();
  const said = [];
  const twitchState = { connected: true, loggedIn: true, channel: 'smokestreamer' };
  const handlers = new Map();
  const sent = [];
  const done = { ...importsDone };
  const quit = [];
  const registered = [];

  const ctx = {
    ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) },
    shell: { openExternal: async () => {} },
    clipboard: { writeText() {} },
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    getWindow: () => null,
    send: (ch, payload) => sent.push({ ch, payload }),
    userData,
    imports,
    importsDone: () => done,
    markImported: (key) => {
      done[key] = Date.now();
    },
    twitch: {
      onChat: (cb) => {
        chat.on('msg', cb);
        return () => chat.off('msg', cb);
      },
      onStatus: () => () => {},
      status: () => twitchState,
      say: (text) => {
        said.push(text);
        return true;
      },
      getAuth: () => ({ token: 'tok', clientId: 'cid' }),
    },
    server: {
      router,
      port,
      url: (p = '/') => `http://127.0.0.1:${port}${p}`,
      addUpgrade: (match, wss) => upgrades.push({ match: (p) => p === match, wss }),
    },
    overlays: { register: (o) => registered.push(o) },
    log: { info() {}, warn() {}, error() {} },
    onQuit: (fn) => quit.push(fn),
  };

  const mod = await queueup.init(ctx);
  const call = (ch, arg) => handlers.get(ch)({}, arg);
  const say = (login, text, extra = {}) => chat.emit('msg', { login, display: login, text, ...extra });
  const close = () => {
    quit.forEach((fn) => fn());
    server.closeAllConnections?.();
    server.close();
  };
  return { ctx, mod, call, say, said, sent, handlers, done, registered, port, close };
}

function get(port, p) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}${p}`, (r) => {
        let body = '';
        r.on('data', (c) => (body += c));
        r.on('end', () => resolve({ status: r.statusCode, body, headers: r.headers }));
      })
      .on('error', reject);
  });
}

/* ------------------------------------------------------------------ */
/* pure state                                                          */
/* ------------------------------------------------------------------ */

test('queue rules: subs skip the line within their tier, duplicates are refused', () => {
  const s = new Store(path.join(tmp('rules'), 'q.json'));
  s.addUser({ login: 'a' });
  s.addUser({ login: 'b' });
  s.addUser({ login: 'sub1', isSub: true });
  s.addUser({ login: 'sub2', isSub: true });
  assert.deepEqual(s.data.queue.map((e) => e.login), ['sub1', 'sub2', 'a', 'b']);

  const dup = s.addUser({ login: 'A' });
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, 'already');
  assert.equal(dup.position, 3);

  s.updateSettings({ allowDuplicates: true });
  assert.equal(s.addUser({ login: 'a' }).ok, true);

  s.updateSettings({ subsPriority: false, allowDuplicates: false });
  s.addUser({ login: 'sub3', isSub: true });
  assert.equal(s.data.queue.at(-1).login, 'sub3');
  s.flush();
});

test('party: promote, full party bumps the last member to the front, fill and next game', () => {
  const s = new Store(path.join(tmp('party'), 'q.json'));
  ['a', 'b', 'c', 'd', 'e'].forEach((login) => s.addUser({ login }));
  assert.equal(s.fillParty(), 3);
  assert.deepEqual(s.data.party.map((e) => e.login), ['a', 'b', 'c']);
  assert.ok(s.data.party.every((e) => e.partySince));

  // Drag 'e' into the full party at slot 0: 'c' (last) is bumped to the front of the queue.
  const e = s.data.queue.find((x) => x.login === 'e');
  s.move(e.id, 'party', 0);
  assert.deepEqual(s.data.party.map((x) => x.login), ['e', 'a', 'b']);
  assert.deepEqual(s.data.queue.map((x) => x.login), ['c', 'd']);
  assert.equal(s.data.queue[0].partySince, undefined, 'bumped player gets a fresh wait clock');

  // Back out of the party restarts the clock.
  const a = s.data.party[1];
  a.joinedAt = 1;
  s.move(a.id, 'queue', 5);
  assert.equal(s.data.queue.at(-1).login, 'a');
  assert.ok(s.data.queue.at(-1).joinedAt > 1);

  s.toTop(s.data.queue.at(-1).id);
  assert.equal(s.data.queue[0].login, 'a');

  assert.equal(s.promote(s.data.queue[0].id), true);
  assert.equal(s.data.party.length, 3);
  assert.equal(s.nextGame(), 2, 'only two were left waiting');
  assert.deepEqual(s.data.party.map((x) => x.login), ['c', 'd']);
  s.clear('all');
  assert.equal(s.data.party.length + s.data.queue.length, 0);
  s.flush();
});

test('persistence: flush survives a quick quit, timers resume, damaged files are set aside', () => {
  const dir = tmp('persist');
  const file = path.join(dir, 'q.json');
  const quick = new Store(file);
  quick.addUser({ login: 'lastsecond' });
  const joinedAt = quick.data.queue[0].joinedAt;
  quick.flush();
  const reloaded = new Store(file);
  assert.equal(reloaded.data.queue[0].login, 'lastsecond');
  assert.equal(reloaded.data.queue[0].joinedAt, joinedAt);

  const corrupt = path.join(dir, 'corrupt.json');
  fs.writeFileSync(corrupt, '{ "queue": [ {"login":"hal');
  const recovered = new Store(corrupt);
  assert.ok(fs.existsSync(corrupt + '.corrupt'));
  assert.deepEqual(recovered.data.queue, []);
});

test('formatQueueMessage: stars subs and folds the tail under the 500-char limit', () => {
  assert.equal(formatQueueMessage([], '!join'), 'The queue is empty — type !join to get in line.');
  const q = [{ display: 'lovediddyo', isSub: true }, { display: 'rydu9' }];
  assert.equal(formatQueueMessage(q), 'Queue (2): 1. lovediddyo⭐, 2. rydu9');
  const long = Array.from({ length: 80 }, (_, i) => ({ display: 'viewer_number_' + i }));
  const msg = formatQueueMessage(long);
  assert.ok(msg.length <= 500, `length ${msg.length}`);
  assert.match(msg, /\+\d+ more$/);
});

test('gift tracker: combos count once, top streak is the longest, top gifter by diamonds', () => {
  const g = createGiftTracker();
  const ev = (login, giftId, diamonds, giftType, repeatCount, repeatEnd) => ({ login, name: login, giftId, giftName: giftId, diamonds, giftType, repeatCount, repeatEnd });
  for (let i = 1; i <= 12; i++) g.handleGift(ev('rosefan', 'rose', 1, 1, i, false));
  let s = g.snapshot();
  assert.equal(s.liveStreak.count, 12);
  assert.equal(s.totalDiamonds, 0);
  g.handleGift(ev('rosefan', 'rose', 1, 1, 12, true));
  g.handleGift(ev('whale', 'galaxy', 1000, 0, 1, true));
  for (let i = 1; i <= 3; i++) g.handleGift(ev('whale', 'hearts', 99, 1, i, i === 3));
  s = g.snapshot();
  assert.equal(s.liveStreak, null);
  assert.equal(s.totalDiamonds, 12 + 1000 + 297);
  assert.equal(s.topGifters[0].login, 'whale');
  assert.equal(s.topStreak.login, 'rosefan');

  const restored = createGiftTracker();
  restored.load(JSON.parse(JSON.stringify(g.serialize())));
  assert.equal(restored.snapshot().totalDiamonds, 1309);
  g.reset();
  assert.equal(g.snapshot().totalGifts, 0);
});

/* ------------------------------------------------------------------ */
/* tiktok daily gaming rank + Gift Gallery parsing                     */
/* ------------------------------------------------------------------ */

const txt = (defaultPattern, ...strings) => ({ key: 'k', defaultPattern, pieces: strings.map((stringValue) => ({ type: 1, stringValue })) });

test('rank parsing: daily game rank by numeric or string enum, unranked, 99+', () => {
  assert.equal(ts.rankTypeNum(11), 11);
  assert.equal(ts.rankTypeNum('TYPE_DAILY_GAME'), 11);
  assert.equal(ts.rankTypeNum('11'), 11);
  assert.equal(ts.rankTypeNum('DAILY_GAME'), 11);
  assert.equal(ts.rankTypeNum('nonsense'), null);

  // Numeric enums: picks type 11 even when other ranks come first.
  const numeric = {
    updates: [
      { rankType: 0, ownRank: '3', currentScore: '10' },
      { rankType: 11, ownRank: '12', currentScore: '4520', defaultContent: txt('Daily gaming') },
      { rankType: 10, ownRank: '40', currentScore: '1' },
    ],
  };
  assert.deepEqual(ts.parseRankUpdate(numeric), { value: '12', score: '4520', type: 11, content: 'Daily gaming' });

  // String enums, and the fallback to the gaming rank (10) when there is no daily one.
  const named = { updates: [{ rankType: 'TYPE_HOURLY_RANK', ownRank: '1' }, { rankType: 'TYPE_GAME_RANK', ownRank: '099', currentScore: '0' }] };
  assert.deepEqual(ts.parseRankUpdate(named), { value: '99', score: '', type: 10, content: '' });
  assert.equal(ts.parseRankUpdate({ updates: [{ rankType: 'TYPE_DAILY_GAME', ownRank: '99+' }] }).value, '99+');

  // Unranked: "0", "" and "-1" all mean "not on the list".
  for (const ownRank of ['0', '', '-1', undefined]) assert.equal(ts.parseRankUpdate({ updates: [{ rankType: 11, ownRank }] }).value, '', `ownRank ${ownRank}`);
  // ...unless the text says it.
  assert.equal(ts.parseRankUpdate({ updates: [{ rankType: 11, ownRank: '', defaultContent: txt("You're {0:string} in Gaming", '#7') }] }).value, '7');
  // No gaming rank in the message at all -> nothing to apply.
  assert.equal(ts.parseRankUpdate({ updates: [{ rankType: 8, ownRank: '5' }] }), null);
  assert.equal(ts.parseRankUpdate({}), null);
  assert.equal(ts.parseRankUpdate(null), null);
});

test('rank notices: readable text from the Text pattern, rank pulled out when present', () => {
  const user = { type: 11, userValue: { user: { nickname: 'Streamer' } } };
  const n = ts.parseGameRankNotify({ msgType: 1, notifyText: { defaultPattern: '{0:user} moved up to No. {1:string} in Gaming', pieces: [user, { stringValue: '15' }] } });
  assert.deepEqual(n, { notice: 'Streamer moved up to No. 15 in Gaming', msgType: 1, value: '15' });
  assert.equal(ts.parseGameRankNotify({ msgType: 'MSG_TYPE_ANCHOR_ENCOURAGE', notifyText: txt('Keep going!') }).msgType, 2);
  assert.equal(ts.parseGameRankNotify({ msgType: 0, notifyText: txt('Keep going!') }).value, '');
  assert.equal(ts.textToString({ pieces: [{ stringValue: 'Ranked' }, { stringValue: '#3' }] }), 'Ranked #3');
  assert.equal(ts.parseGameRankNotify({ msgType: 0 }), null);
  assert.equal(ts.rankFromText('You are 4th today'), '4');
  assert.equal(ts.rankFromText('Top 100'), '');
});

test('gallery parsing: total entries, collected = sponsored entries', () => {
  const progress = {
    5655: { goalCount: '1', currentSponsorId: '7034000000000000001' },
    5487: { goalCount: '1', currentSponsorId: '0' },
    6096: { goalCount: '1', currentSponsorId: '' },
    7122: { goalCount: '1', currentSponsorId: '7034000000000000002' },
    8000: { goalCount: '1' },
  };
  assert.deepEqual(ts.parseGalleryPanel({ galleryData: { progress, period: '7', endTimeInMs: '1767225600000' } }), {
    collected: 2,
    total: 5,
    period: '7',
    endsAt: 1767225600000,
  });
  const entries = [{ key: '1', value: { currentSponsorId: '9' } }, { key: '2', value: { currentSponsorId: '0' } }];
  assert.equal(ts.parseGalleryPanel({ galleryData: { progress: entries } }).collected, 1);
  assert.equal(ts.parseGalleryPanel({ galleryData: { progress: {} } }), null);
  assert.equal(ts.parseGalleryPanel({ goalData: {} }), null);
});

test('stats tracker: manual values win, notices fill in, gallery gifts as a fallback, reset', () => {
  let changes = 0;
  const s = ts.createTiktokStats({ onChange: () => changes++ });
  let d = s.snapshot().display;
  assert.equal(d.rank.text, '—');
  assert.equal(d.gallery.text, '—');

  // Before any panel data, distinct gallery gifts count up.
  s.handleGift({ giftId: '5655', isGalleryGift: true });
  s.handleGift({ giftId: '5655', isGalleryGift: true });
  s.handleGift({ giftId: '1', isGalleryGift: false });
  d = s.snapshot().display;
  assert.deepEqual([d.gallery.source, d.gallery.text], ['gifts', '1']);

  s.handleGiftPanel({ galleryData: { progress: { a: { currentSponsorId: '9' }, b: { currentSponsorId: '9' }, c: { currentSponsorId: '0' } } } });
  d = s.snapshot().display;
  assert.deepEqual([d.gallery.source, d.gallery.text, d.gallery.collected, d.gallery.total], ['live', '2/3', 2, 3]);

  // A notice sets the rank only while no rankUpdate has.
  s.handleGameRankNotify({ msgType: 0, notifyText: txt('You entered the daily gaming list at #50') });
  assert.equal(s.snapshot().display.rank.text, '#50');
  s.handleRankUpdate({ updates: [{ rankType: 11, ownRank: '12', currentScore: '900' }] });
  s.handleGameRankNotify({ msgType: 1, notifyText: txt('Up to #8 soon?') });
  const snap = s.snapshot();
  assert.equal(snap.display.rank.text, '#12', 'rankUpdate beats a notice');
  assert.equal(snap.rank.notice, 'Up to #8 soon?');
  assert.equal(snap.display.rank.score, '900');
  s.handleRankUpdate({ updates: [{ rankType: 'TYPE_DAILY_GAME', ownRank: '0' }] });
  assert.equal(s.snapshot().display.rank.text, 'Unranked');

  // Manual override precedence.
  s.setManual({ rankEnabled: true, rankValue: '#3', galleryEnabled: true, galleryCollected: 40, galleryTotal: 25 });
  d = s.snapshot().display;
  assert.deepEqual([d.rank.source, d.rank.text, d.rank.score], ['manual', '#3', '']);
  assert.deepEqual([d.gallery.source, d.gallery.text], ['manual', '25/25'], 'collected is clamped to the total');
  s.setManual({ rankValue: 'abc' });
  assert.equal(s.snapshot().display.rank.text, 'Unranked');
  s.setStyle({ unrankedText: 'Not ranked', bogus: 1 });
  assert.equal(s.snapshot().display.rank.text, 'Not ranked');
  assert.equal(s.snapshot().style.bogus, undefined, 'unknown style keys are dropped');
  s.setManual({ rankEnabled: false, galleryEnabled: false });
  assert.equal(s.snapshot().display.gallery.text, '2/3', 'live values come back when manual is off');

  // Persisted and restored, then reset keeps manual + style.
  const restored = ts.createTiktokStats();
  restored.load(JSON.parse(JSON.stringify(s.serialize())));
  assert.equal(restored.snapshot().display.gallery.text, '2/3');
  restored.reset();
  const after = restored.snapshot();
  assert.equal(after.display.rank.text, '—');
  assert.equal(after.display.gallery.text, '—');
  assert.equal(after.style.unrankedText, 'Not ranked');
  assert.ok(changes > 5);
});

test('rank samples: first five per event per session, truncated, buffers summarised', () => {
  const lines = [];
  const log = ts.createSampleLogger({ file: 'x.log', append: (_f, line) => lines.push(line) });
  for (let i = 0; i < 7; i++) log.log('rankUpdate', { i, prompt: Buffer.from([1, 2, 3]) });
  log.log('giftPanelUpdate', { big: 'x'.repeat(10000) });
  assert.equal(lines.filter((l) => l.includes(' rankUpdate ')).length, 5);
  assert.match(lines[0], /"<3 bytes>"/);
  assert.ok(lines.at(-1).length < 4300, 'payload truncated to ~4KB');
  log.reset();
  log.log('rankUpdate', {});
  assert.equal(lines.filter((l) => l.includes(' rankUpdate ')).length, 6, 'a new session samples again');
});

/* ------------------------------------------------------------------ */
/* widget styles: presets, customising, migration                      */
/* ------------------------------------------------------------------ */

test('widget presets: steez, classic and at least four more, each valid for all three widgets', () => {
  const ids = widgetStyles.PRESETS.map((p) => p.id);
  assert.ok(ids.includes('steez') && ids.includes('classic'));
  assert.ok(ids.length >= 6, 'at least four new presets');
  assert.equal(new Set(ids).size, ids.length, 'preset ids are unique');
  for (const w of widgetStyles.WIDGETS) {
    for (const id of ids) {
      const look = widgetStyles.presetLook(id, w);
      assert.deepEqual(Object.keys(look).sort(), [...widgetStyles.LOOK_KEYS].sort(), `${id}/${w} sets every look key`);
      assert.deepEqual(widgetStyles.sanitize(w, look), look, `${id}/${w} passes its own validation`);
    }
    const d = widgetStyles.defaultStyle(w);
    assert.equal(d.preset, w === 'gifts' ? 'classic' : 'steez');
    assert.equal(d.animations, true);
  }
  // The badges' Steez Clean is exactly the look they had before presets.
  const steez = widgetStyles.presetLook('steez', 'rank');
  assert.deepEqual([steez.accent, steez.textColor, steez.bg, steez.bgOpacity], ['#d4d4d4', '#f2f2f2', '#121212', 0.82]);
  // Classic gifts is the original QueueUp card: transparent, gold + purple, ring, sparkles, glow.
  const classic = widgetStyles.presetLook('classic', 'gifts');
  assert.deepEqual(
    [classic.accent, classic.accent2, classic.bgOpacity, classic.radius, classic.ring, classic.particles, classic.glow],
    ['#ffb547', '#a970ff', 0, 22, true, true, true],
  );
  // Every preset has its own animation personality.
  const personalities = new Set(widgetStyles.PRESETS.map((p) => [p.look.entrance, p.look.change, p.look.idle].join('/')));
  assert.equal(personalities.size, ids.length);

  const kit = widgetStyles.kitInfo();
  assert.equal(kit.presets.length, ids.length);
  assert.ok(kit.options.entrances.length && kit.options.changes.length && kit.options.idles.length && kit.options.fonts.length);
  assert.equal(kit.presets.find((p) => p.id === 'neon').looks.gallery.entrance, 'flicker');
});

test('widget styles: validation, preset switch keeps prefs and content, reset to preset', () => {
  const clean = widgetStyles.sanitize('rank', {
    accent: '#ABC',
    textColor: 'red',
    bgOpacity: 7,
    radius: -4,
    fontFamily: '"Comic Sans MS"; } body {',
    fontWeight: '650',
    entrance: 'explode',
    idle: 'float',
    speed: '2',
    animations: 'false',
    rankLabel: 'x'.repeat(80),
    mode: 'streak',
    bogus: 1,
  });
  assert.equal(clean.accent, '#aabbcc');
  assert.equal(clean.textColor, undefined, 'not a colour');
  assert.equal(clean.bgOpacity, 1);
  assert.equal(clean.radius, 0);
  assert.equal(clean.fontFamily, 'Comic Sans MS  body', 'no quotes, braces or semicolons reach CSS');
  assert.equal(clean.fontWeight, undefined, 'only real weights');
  assert.equal(clean.entrance, undefined);
  assert.equal(clean.idle, 'float');
  assert.equal(clean.speed, 2);
  assert.equal(clean.animations, false);
  assert.equal(clean.rankLabel.length, 32);
  assert.equal(clean.mode, undefined, 'gifts-only keys are dropped from a badge');
  assert.equal(clean.bogus, undefined);

  let st = widgetStyles.defaultStyle('gifts');
  st = widgetStyles.applyPatch('gifts', st, { accent: '#123456', scale: 1.5, width: 500, streakTitle: 'BIG COMBO', speed: 0.5 });
  assert.deepEqual(widgetStyles.modifiedKeys('gifts', st), ['accent']);
  st = widgetStyles.applyPatch('gifts', st, { preset: 'neon' });
  assert.equal(st.preset, 'neon');
  assert.equal(st.accent, widgetStyles.presetLook('neon', 'gifts').accent, 'picking a preset fills its look');
  assert.deepEqual([st.scale, st.width, st.streakTitle, st.speed], [1.5, 500, 'BIG COMBO', 0.5], 'prefs and content survive');
  assert.deepEqual(widgetStyles.modifiedKeys('gifts', st), []);
  // A preset and a tweak in one patch: the tweak lands on top.
  st = widgetStyles.applyPatch('gifts', st, { preset: 'arcade', radius: 12 });
  assert.deepEqual([st.preset, st.radius, st.change], ['arcade', 12, 'coin']);
  st = widgetStyles.applyPatch('gifts', st, { idle: 'none', glow: true });
  assert.deepEqual(widgetStyles.modifiedKeys('gifts', st).sort(), ['glow', 'idle', 'radius']);
  st = widgetStyles.applyPreset('gifts', st);
  assert.deepEqual(widgetStyles.modifiedKeys('gifts', st), [], 'reset to preset');
  assert.equal(st.preset, 'arcade');
  assert.equal(st.streakTitle, 'BIG COMBO');
  assert.equal(widgetStyles.applyPatch('gifts', st, { preset: 'nope' }).preset, 'arcade', 'unknown presets are ignored');
});

test('widget styles: saved settings from before presets keep their look', () => {
  // A gifts overlay customised in QueueUp / older Steez: no preset key.
  const legacyGift = { mode: 'streak', accent: '#ff0000', ring: false, bgOpacity: 0.4, radius: 8, fontFamily: 'Impact', scale: 1.2, width: 380, emptyText: 'Send a gift!' };
  const g = widgetStyles.normalizeStyle('gifts', legacyGift, 'classic');
  assert.equal(g.preset, 'classic', 'mapped onto QueueUp Classic');
  for (const [k, v] of Object.entries(legacyGift)) assert.equal(g[k], v, `${k} kept`);
  assert.equal(g.accent2, '#a970ff', 'everything else from Classic');
  assert.equal(g.particles, true);
  assert.deepEqual(widgetStyles.modifiedKeys('gifts', g).sort(), ['accent', 'bgOpacity', 'fontFamily', 'radius', 'ring']);
  assert.equal(widgetStyles.applyPreset('gifts', g).accent, '#ffb547', 'reset to preset gives the Classic gold back');

  // The Store maps an old state file the same way.
  const dir = tmp('legacy-style');
  const file = path.join(dir, 'q.json');
  fs.writeFileSync(file, JSON.stringify({ party: [], queue: [], giftOverlay: legacyGift }));
  const store = new Store(file);
  assert.equal(store.data.giftOverlay.preset, 'classic');
  assert.equal(store.data.giftOverlay.accent, '#ff0000');
  assert.equal(store.data.giftOverlay.entrance, 'rise');
  store.updateGiftOverlay({ preset: 'glass' });
  assert.equal(store.data.giftOverlay.accent, '#ffffff');
  assert.equal(store.data.giftOverlay.width, 380, 'width survives a preset switch');
  store.updateGiftOverlay({ accent: '#00ff00' });
  store.applyGiftPreset();
  assert.equal(store.data.giftOverlay.accent, '#ffffff', 'reset to the current preset');
  store.flush();

  // Rank/gallery badges: one old shared style seeds both badges on Steez Clean.
  const s = ts.createTiktokStats();
  s.load({ style: { accent: '#abcdef', bgOpacity: 0.5, rankLabel: 'DAILY', galleryLabel: 'GALLERY', showBar: false, unrankedText: 'Not yet' } });
  const snap = s.snapshot();
  assert.deepEqual([snap.style.preset, snap.style.accent, snap.style.bgOpacity, snap.style.rankLabel], ['steez', '#abcdef', 0.5, 'DAILY']);
  assert.deepEqual([snap.galleryStyle.preset, snap.galleryStyle.accent, snap.galleryStyle.galleryLabel, snap.galleryStyle.showBar], ['steez', '#abcdef', 'GALLERY', false]);
  assert.equal(snap.display.rank.text, '—');
  assert.equal(snap.style.galleryLabel, undefined, 'each badge keeps only its own keys');

  // Per badge from here on; a widget-less edit still reaches both (the old behaviour).
  s.applyPreset('gallery', 'holo');
  s.setStyle({ accent: '#111111' }, 'rank');
  let now = s.snapshot();
  assert.deepEqual([now.style.preset, now.style.accent, now.galleryStyle.preset], ['steez', '#111111', 'holo']);
  s.setStyle({ textColor: '#eeeeee', galleryLabel: 'G' });
  now = s.snapshot();
  assert.deepEqual([now.style.textColor, now.galleryStyle.textColor, now.galleryStyle.galleryLabel], ['#eeeeee', '#eeeeee', 'G']);
  s.resetStyle('gallery');
  assert.equal(s.snapshot().galleryStyle.preset, 'steez');
  assert.equal(s.snapshot().style.accent, '#111111', 'resetting one badge leaves the other');
  const restored = ts.createTiktokStats();
  restored.load(JSON.parse(JSON.stringify(s.serialize())));
  assert.equal(restored.snapshot().style.accent, '#111111', 'per-badge styles persist');
});

/* ------------------------------------------------------------------ */
/* module: import, IPC, chat, avatars, tiktok, overlays                */
/* ------------------------------------------------------------------ */

test('import from the standalone QueueUp app leaves credentials behind', async () => {
  const legacyDir = tmp('legacy');
  const avatarsFile = path.join(legacyDir, 'avatars.json');
  fs.writeFileSync(avatarsFile, JSON.stringify({ alpha: { url: 'https://static-cdn.jtvnw.net/alpha.png', at: Date.now() } }));
  const legacy = {
    party: [{ id: 'p1', login: 'partyguy', display: 'PartyGuy', joinedAt: 1000, partySince: 2000 }],
    queue: [{ id: 'q1', login: 'alpha', display: 'Alpha', joinedAt: 3000, isSub: true }],
    settings: {
      channel: 'oldchannel', clientId: 'cid', accessToken: 'SECRET_TOKEN', refreshToken: 'SECRET_REFRESH', botUsername: 'oldbot',
      port: 4747, autoUpdate: false, autoConnect: true, partySize: 5, joinCommand: '!play', tiktokUsername: 'mytiktok',
    },
    overlay: { title: 'UP NEXT', accent: '#ff0000' },
    giftOverlay: { mode: 'streak' },
    gifts: { totalDiamonds: 42, totalGifts: 3, gifters: {}, recent: [] },
  };

  const userData = tmp('import');
  const m = await bootModule({ userData, imports: { queueup: { data: legacy, avatarsFile } } });
  try {
    assert.ok(m.done.queueup, 'import is marked done');
    const raw = fs.readFileSync(path.join(userData, 'queueup-state.json'), 'utf8');
    for (const secret of ['SECRET_TOKEN', 'SECRET_REFRESH', 'oldchannel', 'oldbot', '4747']) assert.ok(!raw.includes(secret), `${secret} must not be imported`);
    const st = await m.call('qu:getState');
    assert.deepEqual(st.queue.map((e) => e.login), ['alpha']);
    assert.equal(st.queue[0].joinedAt, 3000, 'wait timers carry over');
    assert.equal(st.party[0].login, 'partyguy');
    assert.equal(st.settings.partySize, 5);
    assert.equal(st.settings.joinCommand, '!play');
    assert.equal(st.settings.tiktokUsername, 'mytiktok');
    assert.equal(st.settings.accessToken, undefined);
    assert.equal(st.overlay.title, 'UP NEXT');
    assert.equal(st.overlay.maxRows, 5, 'missing overlay keys fall back to defaults');
    assert.equal(st.giftOverlay.mode, 'streak');
    assert.equal(st.gifts.totalDiamonds, 42);
    assert.ok(fs.existsSync(path.join(userData, 'queueup-avatars.json')), 'avatar cache copied');
  } finally {
    m.close();
  }

  // Never twice: once Steez has its own file (or the import is marked), the old file is ignored.
  const again = await bootModule({ userData, imports: { queueup: { data: { ...legacy, queue: [] } } } });
  try {
    const st = await again.call('qu:getState');
    assert.equal(st.queue.length, 1);
  } finally {
    again.close();
  }
});

test('module: IPC, chat commands, avatars, tiktok and overlays', async (t) => {
  const userData = tmp('module');
  const m = await bootModule({ userData });
  t.after(() => m.close());

  await t.test('every IPC channel is registered and overlays are announced', () => {
    const required = [
      'qu:getState', 'qu:getLogs', 'qu:queue:add', 'qu:queue:remove', 'qu:queue:move', 'qu:queue:promote', 'qu:queue:toTop',
      'qu:queue:clear', 'qu:queue:fill', 'qu:queue:next', 'qu:settings:update', 'qu:overlay:update', 'qu:overlay:reset',
      'qu:giftOverlay:update', 'qu:giftOverlay:reset', 'qu:tiktok:connect', 'qu:tiktok:disconnect', 'qu:gifts:reset',
      'qu:gifts:simulate', 'qu:util:copy', 'qu:util:openExternal', 'qu:util:confirm',
    ];
    assert.deepEqual(required.filter((c) => !m.handlers.has(c)), []);
    assert.deepEqual(m.registered.map((o) => o.path), ['/overlay/queue', '/overlay/gifts', '/overlay/tiktok-rank', '/overlay/tiktok-gallery']);
    for (const c of ['qu:tiktokStats:manual', 'qu:tiktokStats:style', 'qu:tiktokStats:resetStyle', 'qu:tiktokStats:reset']) assert.ok(m.handlers.has(c), c);
  });

  await t.test('queue IPC drives the store and pushes qu:state', async () => {
    await m.call('qu:queue:add', '@alpha');
    await m.call('qu:queue:add', 'bravo');
    await m.call('qu:queue:add', 'charlie');
    const dup = await m.call('qu:queue:add', 'alpha');
    assert.equal(dup.reason, 'already');
    let st = await m.call('qu:getState');
    assert.deepEqual(st.queue.map((e) => e.login), ['alpha', 'bravo', 'charlie']);
    assert.equal(st.baseUrl, `http://127.0.0.1:${m.port}`);
    assert.ok(m.sent.some((s) => s.ch === 'qu:state'));

    await m.call('qu:queue:promote', st.queue[0].id);
    st = await m.call('qu:getState');
    assert.equal(st.party.length, 1);
    await m.call('qu:queue:move', { id: st.party[0].id, list: 'queue', index: 0 });
    assert.equal(await m.call('qu:queue:fill'), 3);
    await m.call('qu:queue:next');
    st = await m.call('qu:getState');
    assert.equal(st.party.length, 0);
    await m.call('qu:settings:update', { partySize: 99, hostName: 'Streamer', accessToken: 'nope' });
    st = await m.call('qu:getState');
    assert.equal(st.settings.partySize, 20, 'party size is clamped');
    assert.equal(st.settings.hostName, 'Streamer');
    assert.equal(st.settings.accessToken, undefined, 'legacy keys are never stored');
    await m.call('qu:settings:update', { partySize: 3 });
  });

  await t.test('chat: join, subs, duplicates, leave, closed queue, !queue', async () => {
    await m.call('qu:queue:clear', 'all');
    m.said.length = 0;
    m.say('viewer1', '!join');
    m.say('subby', '!JOIN please', { isSub: true });
    m.say('viewer1', '!join');
    let st = await m.call('qu:getState');
    assert.deepEqual(st.queue.map((e) => e.login), ['subby', 'viewer1']);
    assert.equal(m.said.length, 0, 'silent while bot replies are off');

    await m.call('qu:settings:update', { botReplies: true });
    m.say('viewer1', '!join');
    assert.match(m.said.at(-1), /already in the queue at #2/);
    m.say('viewer1', '!dequeue');
    assert.match(m.said.at(-1), /removed from the queue/);
    m.say('nobody', '!dequeue');
    assert.match(m.said.at(-1), /not in the queue/);

    m.say('lister', '!queue');
    assert.equal(m.said.at(-1), 'Queue (1): 1. subby⭐');
    const count = m.said.length;
    m.say('lister', '!queue');
    assert.equal(m.said.length, count, '!queue is rate-limited');

    await m.call('qu:settings:update', { queueOpen: false, joinCommand: '!play' });
    m.say('late', '!play');
    assert.match(m.said.at(-1), /queue is closed/);
    await m.call('qu:settings:update', { queueOpen: true });
    m.say('late', '!play');
    m.say('ignored', '!join');
    st = await m.call('qu:getState');
    assert.deepEqual(st.queue.map((e) => e.login), ['subby', 'late'], 'renamed commands apply');
    await m.call('qu:settings:update', { joinCommand: '!join', botReplies: false });
    const logs = await m.call('qu:getLogs');
    assert.ok(logs.some((l) => l.type === 'join' && l.text.includes('late')));
  });

  await t.test('avatars: batched Helix lookups, cached, misses fall back', async () => {
    await m.call('qu:queue:clear', 'all');
    await m.call('qu:queue:add', 'alpha');
    await m.call('qu:queue:add', 'bravo');
    await m.call('qu:queue:add', 'ghostuser');
    await wait(400);
    let st = await m.call('qu:getState');
    const by = Object.fromEntries(st.queue.map((e) => [e.login, e]));
    assert.match(by.alpha.avatar || '', /jtv_user_pictures/);
    assert.ok(by.bravo.avatar);
    assert.equal(by.ghostuser.avatar, null);

    const before = helixCalls;
    await m.call('qu:queue:remove', by.bravo.id);
    await m.call('qu:queue:add', 'bravo');
    await wait(400);
    assert.equal(helixCalls, before, 'returning viewers come from the cache');
    st = await m.call('qu:getState');
    assert.ok(st.queue.find((e) => e.login === 'bravo').avatar);
    assert.ok(fs.existsSync(path.join(userData, 'queueup-avatars.json')));
  });

  await t.test('tiktok gifts: live connection, combos, persistence, reset', async () => {
    const res = await m.call('qu:tiktok:connect', '@Cool.Streamer/live');
    assert.equal(res.username, 'cool.streamer');
    await wait(100);
    let st = await m.call('qu:getState');
    assert.equal(st.tiktok.status, 'live');
    assert.equal(st.settings.tiktokUsername, 'cool.streamer');
    const conn = tiktokConnections.at(-1);
    assert.equal(conn.options.enableExtendedGiftInfo, false, 'paid gift-info route is never used');

    const v3 = (login, giftName, diamonds, type, repeatCount, repeatEnd, giftId) => ({
      giftId, repeatCount, repeatEnd: repeatEnd ? 1 : 0,
      user: { id: '1', displayId: login, nickname: login, avatarThumb: { mUrls: [`https://p16-sign.tiktokcdn-us.com/${login}.jpeg`] } },
      gift: { id: giftId, name: giftName, diamondCount: diamonds, type, image: { mUrls: [`https://p16-webcast.tiktokcdn.com/gift_${giftId}.png`] } },
    });
    for (let i = 1; i <= 5; i++) conn.emit('gift', v3('rosefan', 'Rose', 1, 1, i, i === 5, '5655'));
    conn.emit('gift', v3('whale', 'Galaxy', 1000, 0, 1, true, '7122'));
    st = await m.call('qu:getState');
    assert.equal(st.gifts.totalDiamonds, 1005);
    assert.equal(st.gifts.topStreak.count, 5);
    assert.match(st.gifts.topGifters[0].avatar, /tiktokcdn/);
    assert.ok(m.sent.some((s) => s.ch === 'qu:gifts'));

    await wait(350);
    const disk = JSON.parse(fs.readFileSync(path.join(userData, 'queueup-state.json'), 'utf8'));
    assert.equal(disk.gifts.totalDiamonds, 1005);

    await m.call('qu:giftOverlay:update', { mode: 'streak', bgOpacity: 0.5 });
    st = await m.call('qu:getState');
    assert.equal(st.giftOverlay.mode, 'streak');

    await m.call('qu:tiktok:connect', 'notliveyet');
    await wait(100);
    st = await m.call('qu:getState');
    assert.equal(st.tiktok.status, 'waiting');
    await m.call('qu:tiktok:disconnect');
    st = await m.call('qu:getState');
    assert.equal(st.tiktok.status, 'idle');
  });

  await t.test('overlays: pages, state JSON and the live websocket', async () => {
    await m.call('qu:overlay:update', { title: 'UP NEXT', maxRows: 7 });
    const page = await get(m.port, '/overlay/queue');
    assert.ok(page.status === 200 || page.status === 301, `status ${page.status}`);
    const pageSlash = await get(m.port, '/overlay/queue/');
    assert.equal(pageSlash.status, 200);
    assert.match(pageSlash.body, /\/overlay\/queue\/overlay\.js/);
    assert.equal((await get(m.port, '/overlay/queue/overlay.js')).status, 200);

    const api = JSON.parse((await get(m.port, '/overlay/queue/api/state')).body);
    assert.equal(api.overlay.title, 'UP NEXT');
    assert.ok(api.queue.some((e) => /jtv_user_pictures/.test(e.avatar || '')));
    assert.equal(api.settings, undefined, 'overlay JSON carries no settings');

    const gpage = await get(m.port, '/overlay/gifts/');
    assert.match(gpage.body, /TOP STREAK/);
    const gapi = JSON.parse((await get(m.port, '/overlay/gifts/api/state')).body);
    assert.equal(gapi.giftOverlay.mode, 'streak');
    assert.ok(gapi.gifts && gapi.gifts.tiktok);

    const ws = new WebSocket(`ws://127.0.0.1:${m.port}/queueup-ws`);
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    await new Promise((r) => ws.once('open', r));
    await wait(50);
    assert.ok(msgs.some((x) => x.type === 'state') && msgs.some((x) => x.type === 'gifts'), 'initial state on connect');
    msgs.length = 0;
    await m.call('qu:overlay:update', { accent: '#123456' });
    await wait(50);
    assert.ok(msgs.some((x) => x.type === 'state' && x.overlay.accent === '#123456'), 'style edits push live');
    ws.close();
  });

  await t.test('tiktok rank + gallery: events, IPC, overlay pages and live pushes', async () => {
    await m.call('qu:tiktok:connect', 'rankstreamer');
    await wait(100);
    const conn = tiktokConnections.at(-1);
    conn.emit('rankUpdate', { updates: [{ rankType: 'TYPE_DAILY_GAME', ownRank: '12', currentScore: '4520', prompt: Buffer.from([1]) }] });
    conn.emit('giftPanelUpdate', { galleryData: { progress: { 1: { currentSponsorId: '5' }, 2: { currentSponsorId: '0' }, 3: { currentSponsorId: '7' } } } });
    conn.emit('gameRankNotify', { msgType: 1, notifyText: { defaultPattern: 'Moved up to #12', pieces: [] } });

    let st = await m.call('qu:getState');
    assert.equal(st.tiktokStats.display.rank.text, '#12');
    assert.equal(st.tiktokStats.display.gallery.text, '2/3');
    assert.equal(st.tiktokStats.rank.notice, 'Moved up to #12');
    assert.ok(m.sent.some((s) => s.ch === 'qu:tiktokStats'), 'changes push to the app');
    assert.deepEqual(st.overlayPaths.tiktokRank, '/overlay/tiktok-rank');

    // Raw payloads are kept for later inspection.
    await wait(50);
    const samples = fs.readFileSync(path.join(userData, 'tiktok-rank-samples.log'), 'utf8');
    assert.match(samples, / rankUpdate #1 /);
    assert.match(samples, / giftPanelUpdate #1 /);
    assert.match(samples, / gameRankNotify #1 /);

    // Overlay pages + first-paint JSON.
    for (const [p, label] of [['/overlay/tiktok-rank', 'data-kind="rank"'], ['/overlay/tiktok-gallery', 'data-kind="gallery"']]) {
      const page = await get(m.port, p);
      assert.equal(page.status, 200, p);
      assert.ok(page.body.includes(label), p);
      assert.match(page.body, /\/overlay\/tiktok-stats\/stats\.js/);
      assert.equal((await get(m.port, p + '/')).status, 200, p + '/');
      const api = JSON.parse((await get(m.port, p + '/api/state')).body);
      assert.equal(api.tiktokStats.display.rank.text, '#12');
      assert.equal(api.tiktokStats.display.gallery.text, '2/3');
    }
    assert.equal((await get(m.port, '/overlay/tiktok-stats/stats.js')).status, 200);
    assert.equal((await get(m.port, '/overlay/tiktok-stats/stats.css')).status, 200);

    // Manual values + style over IPC, pushed live to overlays.
    const ws = new WebSocket(`ws://127.0.0.1:${m.port}/queueup-ws`);
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    await new Promise((r) => ws.once('open', r));
    await wait(50);
    assert.ok(msgs.some((x) => x.type === 'tiktokStats' && x.tiktokStats.display.rank.text === '#12'), 'stats on connect');
    msgs.length = 0;
    const snap = await m.call('qu:tiktokStats:manual', { rankEnabled: true, rankValue: '3', galleryEnabled: true, galleryCollected: 4, galleryTotal: 25 });
    assert.equal(snap.display.rank.text, '#3');
    assert.equal(snap.display.gallery.text, '4/25');
    await m.call('qu:tiktokStats:style', { accent: '#abcdef', rankLabel: 'DAILY' });
    await wait(50);
    assert.ok(msgs.some((x) => x.type === 'tiktokStats' && x.tiktokStats.display.gallery.text === '4/25'), 'manual pushes live');
    assert.ok(msgs.some((x) => x.type === 'tiktokStats' && x.tiktokStats.style.accent === '#abcdef'), 'style pushes live');
    ws.close();

    // Persisted with the QueueUp state.
    await wait(350);
    const disk = JSON.parse(fs.readFileSync(path.join(userData, 'queueup-state.json'), 'utf8'));
    assert.equal(disk.tiktokStats.rank.value, '12');
    assert.equal(disk.tiktokStats.manual.galleryTotal, 25);
    assert.equal(disk.tiktokStats.style.rankLabel, 'DAILY');

    const styled = await m.call('qu:tiktokStats:resetStyle');
    assert.equal(styled.style.rankLabel, 'GAMING · DAILY');
    const cleared = await m.call('qu:tiktokStats:reset');
    assert.equal(cleared.rank.value, '');
    assert.equal(cleared.gallery.total, 0);
    assert.equal(cleared.display.rank.text, '#3', 'manual survives a reset');
    await m.call('qu:tiktokStats:manual', { rankEnabled: false, galleryEnabled: false });
    st = await m.call('qu:getState');
    assert.equal(st.tiktokStats.display.rank.text, '—');
    await m.call('qu:tiktok:disconnect');
  });

  await t.test('widget styles: presets over IPC, live pushes, kit files', async () => {
    for (const c of ['qu:widgetStyle:update', 'qu:widgetStyle:preset', 'qu:widgetStyle:reset', 'qu:widgetStyle:matchAll']) assert.ok(m.handlers.has(c), c);
    const st0 = await m.call('qu:getState');
    assert.ok(st0.widgetKit && st0.widgetKit.presets.length >= 6, 'the editor gets the preset table');

    const ws = new WebSocket(`ws://127.0.0.1:${m.port}/queueup-ws`);
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    await new Promise((r) => ws.once('open', r));
    await wait(50);
    msgs.length = 0;

    const neon = await m.call('qu:widgetStyle:preset', { widget: 'gifts', preset: 'neon' });
    assert.equal(neon.preset, 'neon');
    assert.equal(neon.entrance, 'flicker');
    const tweaked = await m.call('qu:widgetStyle:update', { widget: 'gifts', patch: { accent: '#00ff00', streakTitle: 'COMBO' } });
    assert.deepEqual([tweaked.accent, tweaked.streakTitle], ['#00ff00', 'COMBO']);
    const back = await m.call('qu:widgetStyle:preset', { widget: 'gifts' });
    assert.equal(back.accent, '#ff3df2', 'reset to preset');
    assert.equal(back.streakTitle, 'COMBO');
    const rank = await m.call('qu:widgetStyle:preset', { widget: 'rank', preset: 'esports' });
    assert.equal(rank.preset, 'esports');
    const gal = await m.call('qu:widgetStyle:update', { widget: 'gallery', patch: { preset: 'glass', showTotal: false } });
    assert.deepEqual([gal.preset, gal.showTotal], ['glass', false]);
    assert.equal(await m.call('qu:widgetStyle:update', { widget: 'nope', patch: {} }), null);
    await wait(50);
    assert.ok(msgs.some((x) => x.type === 'gifts' && x.giftOverlay.preset === 'neon'), 'gifts style pushes live');
    assert.ok(
      msgs.some((x) => x.type === 'tiktokStats' && x.tiktokStats.style.preset === 'esports' && x.tiktokStats.galleryStyle.preset === 'glass'),
      'badge styles push live',
    );
    assert.equal((await m.call('qu:getState')).tiktokStats.display.gallery.showTotal, false);

    const all = await m.call('qu:widgetStyle:matchAll', { preset: 'holo' });
    assert.deepEqual([all.gifts.preset, all.rank.preset, all.gallery.preset], ['holo', 'holo', 'holo']);
    assert.equal(all.gallery.showTotal, false, 'matching keeps content');
    const reset = await m.call('qu:widgetStyle:reset', { widget: 'gallery' });
    assert.deepEqual([reset.preset, reset.showTotal], ['steez', true]);
    ws.close();

    // Overlay pages load the kit; the kit and the preset table are served.
    for (const p of ['/overlay/gifts/', '/overlay/tiktok-rank', '/overlay/tiktok-gallery']) {
      const page = await get(m.port, p);
      assert.match(page.body, /\/overlay\/kit\/kit\.js/, p);
      assert.match(page.body, /\/overlay\/kit\/themes\.css/, p);
    }
    for (const f of ['kit.js', 'kit.css', 'themes.css']) assert.equal((await get(m.port, '/overlay/kit/' + f)).status, 200, f);
    const presets = JSON.parse((await get(m.port, '/overlay/kit/presets.json')).body);
    assert.deepEqual(
      presets.presets.map((p) => p.id),
      widgetStyles.PRESETS.map((p) => p.id),
    );
    // Every preset has its theme in the stylesheet.
    const themes = (await get(m.port, '/overlay/kit/themes.css')).body;
    for (const id of presets.presets.map((p) => p.id)) assert.ok(themes.includes(`[data-theme="${id}"]`), `theme css for ${id}`);

    await wait(350);
    const disk = JSON.parse(fs.readFileSync(path.join(userData, 'queueup-state.json'), 'utf8'));
    assert.equal(disk.giftOverlay.preset, 'holo', 'persisted with the QueueUp state');
    assert.equal(disk.tiktokStats.style.preset, 'holo');
    assert.equal(disk.tiktokStats.galleryStyle.preset, 'steez');
  });

  await t.test('gifts reset and demo session', async () => {
    await m.call('qu:gifts:reset');
    let st = await m.call('qu:getState');
    assert.equal(st.gifts.totalDiamonds, 0);
    await m.call('qu:gifts:simulate');
    await wait(400);
    st = await m.call('qu:getState');
    assert.ok(st.gifts.liveStreak, 'demo combo starts climbing');
    await m.call('qu:gifts:reset'); // also clears the combo's stall timer
  });
});

test('defaults carry no Twitch credentials', () => {
  for (const k of ['channel', 'accessToken', 'refreshToken', 'clientId', 'botUsername', 'port']) assert.ok(!(k in DEFAULT_SETTINGS));
});
