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
const queueup = require('./index.cjs');

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
    assert.deepEqual(m.registered.map((o) => o.path), ['/overlay/queue', '/overlay/gifts']);
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
