'use strict';
// Subathon Media Player inside Steez — the engine.
//
// Ported from the standalone app's server.js with every feature: the countdown timer (event
// time, multiplier, cap, manual time), goals, the trigger-code / price media matching, test
// lab, donations (Streamlabs / StreamElements / Ko-fi), the TV screen and viewer page with
// their websockets, uploads, and the remote password-protected /admin dashboard.
//
// Two front doors share this one engine:
//   • the Steez local server (127.0.0.1) at /subathon — the in-app page, authorised by the
//     per-launch Steez key;
//   • the "TV & viewer server" on the home network (0.0.0.0:3000 by default) — serves the TV
//     screen, the viewer page, Ko-fi webhooks and /admin (password + session cookie) exactly
//     like the standalone app. It never exposes anything else from Steez.
const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const TwitchChat = require('./lib/twitch.cjs');
const Donations = require('./lib/donations.cjs');
const { createDb, randomCode } = require('./lib/store.cjs');
const { createTunnel } = require('./lib/tunnel.cjs');

const PUB = path.join(__dirname, 'public');
const EFFECTS = ['pop', 'slide', 'glow', 'confetti', 'fireworks', 'shockwave', 'coinrain', 'rainbow'];
// Well-known TikTok gifts and their coin value, so rules can be made before a gift has been seen
// on stream (the picture appears once one arrives). Any other gift name can be typed in.
const TIKTOK_GIFTS = [
  ['Rose', 1], ['TikTok', 1], ['GG', 1], ['Ice Cream Cone', 1], ['Heart Me', 1], ['Finger Heart', 5],
  ['Perfume', 20], ['Doughnut', 30], ['Hand Hearts', 100], ['Confetti', 100], ['Corgi', 299],
  ['Money Gun', 500], ['Galaxy', 1000], ['Interstellar', 10000], ['Lion', 29999], ['TikTok Universe', 44999],
];

const num = (v, d, min, max) => {
  const n = Number(v);
  if (!isFinite(n)) return d;
  return Math.min(max != null ? max : Infinity, Math.max(min != null ? min : -Infinity, n));
};
const str = (v, d, max) => (typeof v === 'string' ? v.slice(0, max || 200) : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const color = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
const cleanChannel = (v) =>
  String(v || '')
    .trim()
    .replace(/^#/, '')
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();

/**
 * opts: {
 *   dataDir, log,
 *   twitchLogin(): string            — the broadcaster logged into Steez (channel fallback)
 *   keyOk(req): bool                 — Steez key check (in-app requests)
 *   lanHost: '0.0.0.0'               — tests bind to 127.0.0.1
 *   appPath: string                  — Steez.exe, for the firewall fixer
 *   twitch, donations                — injectable for tests
 * }
 */
function createSubathon(opts) {
  const log = opts.log || console;
  const store = createDb(opts.dataDir, log);
  const D = () => store.db;
  const twitch = opts.twitch || new TwitchChat();
  const donations = opts.donations || new Donations();
  const statuses = { twitch: { status: 'disconnected', detail: '' }, donations: { status: 'off', detail: '' }, tvs: 0 };
  const recentChat = [];
  const intervals = [];
  const listeners = new Set(); // in-process subscribers (bot integration): fn(msg)

  // ---------------------------------------------------------------- auth (remote /admin)
  const hashPassword = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
  const sign = (value) => crypto.createHmac('sha256', D().auth.secret).update(String(value)).digest('hex');
  function makeSession() {
    const exp = Date.now() + 30 * 24 * 3600 * 1000;
    return exp + '.' + sign(exp + ':' + D().auth.hash);
  }
  function parseCookies(header) {
    const out = {};
    (header || '').split(';').forEach((p) => {
      const i = p.indexOf('=');
      if (i > 0) {
        try {
          out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
        } catch {
          /* ignore */
        }
      }
    });
    return out;
  }
  function cookieAdmin(req) {
    if (!D().auth.hash) return false;
    const sid = parseCookies(req.headers.cookie).smp_sid || '';
    const [exp, sig] = sid.split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    const expected = sign(exp + ':' + D().auth.hash);
    return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }
  function setSessionCookie(req, res) {
    const secure = req.secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `smp_sid=${makeSession()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}${secure}`);
  }
  const loginAttempts = new Map();
  function rateLimited(ip) {
    const now = Date.now();
    const rec = loginAttempts.get(ip) || { n: 0, reset: now + 15 * 60 * 1000 };
    if (now > rec.reset) {
      rec.n = 0;
      rec.reset = now + 15 * 60 * 1000;
    }
    rec.n++;
    loginAttempts.set(ip, rec);
    return rec.n > 10;
  }
  function setPassword(pw) {
    D().auth.salt = crypto.randomBytes(16).toString('hex');
    D().auth.hash = hashPassword(pw, D().auth.salt);
    store.saveNow();
  }

  // ---------------------------------------------------------------- timer
  function remainingMs() {
    const t = D().timer;
    return t.running ? Math.max(0, t.endsAt - Date.now()) : Math.max(0, t.remaining);
  }
  function timerState() {
    const t = D().timer;
    return { running: t.running, endsAt: t.endsAt, remaining: remainingMs(), ended: t.ended, startedAt: t.startedAt, serverNow: Date.now() };
  }
  // Adds time from an event (applies multiplier + cap). Returns seconds actually added.
  function addEventTime(secs) {
    const db = D();
    const t = db.timer,
      tm = db.settings.time;
    if (!(secs > 0) || t.ended) return 0;
    let ms = secs * 1000 * (Number(tm.multiplier) || 1);
    if (tm.capHours > 0) {
      const room = tm.capHours * 3600e3 - (tm.initialHours * 3600e3 + db.stats.timeAdded * 1000);
      ms = Math.max(0, Math.min(ms, room));
    }
    ms = Math.round(ms);
    if (!ms) return 0;
    if (t.running) t.endsAt += ms;
    else t.remaining += ms;
    db.stats.timeAdded += ms / 1000;
    return ms / 1000;
  }
  // Manual time (dashboard buttons, bot) doesn't count toward stats or the cap.
  function manualTime(secs) {
    const t = D().timer;
    const ms = Math.round(secs * 1000);
    if (t.running) t.endsAt = Math.max(Date.now(), t.endsAt + ms);
    else t.remaining = Math.max(0, remainingMs() + ms);
    if (ms > 0 && t.ended) t.ended = false;
  }
  // Steez: a running clock picks up where it left off after Steez was closed (or crashed): the time
  // Steez was closed is added back, measured from the last heartbeat.
  {
    const t = D().timer;
    if (t.running && t.heartbeat && !t.ended) {
      const closedFor = Math.max(0, Date.now() - t.heartbeat);
      t.endsAt += closedFor;
      t.heartbeat = Date.now();
      store.save();
      if (closedFor > 30000) log?.info?.(`Subathon clock resumed where it left off (Steez was closed for ${Math.round(closedFor / 60000)} min).`);
    }
  }
  intervals.push(
    setInterval(() => {
      const t = D().timer;
      if (t.running && !t.ended) {
        t.heartbeat = Date.now();
        store.save();
      }
    }, 10000),
  );
  intervals.push(
    setInterval(() => {
      const t = D().timer;
      if (t.running && t.endsAt <= Date.now()) {
        t.running = false;
        t.remaining = 0;
        t.ended = true;
        store.save();
        broadcast({ t: 'timer', timer: timerState() });
        broadcast({ t: 'ended' });
      }
    }, 500),
  );

  function timerAction(action, secs) {
    const t = D().timer;
    secs = Number(secs) || 0;
    switch (action) {
      case 'start':
        if (!t.running && remainingMs() > 0) {
          t.endsAt = Date.now() + t.remaining;
          t.running = true;
          t.ended = false;
          if (!t.startedAt) t.startedAt = Date.now();
        }
        break;
      case 'pause':
        if (t.running) {
          t.remaining = remainingMs();
          t.running = false;
        }
        break;
      case 'add':
        manualTime(secs);
        break;
      case 'set':
        if (t.running) t.endsAt = Date.now() + Math.max(0, secs) * 1000;
        else t.remaining = Math.max(0, secs) * 1000;
        t.ended = false;
        break;
      case 'reset':
        t.running = false;
        t.ended = false;
        t.startedAt = 0;
        t.remaining = D().settings.time.initialHours * 3600e3;
        break;
      default:
        return null;
    }
    store.save();
    broadcast({ t: 'timer', timer: timerState() });
    return timerState();
  }

  // ---------------------------------------------------------------- state builders
  function goalProgress(g) {
    const s = D().stats;
    switch (g.metric) {
      case 'subs':
        return s.subs;
      case 'bits':
        return s.bits;
      case 'donations':
        return Math.round(s.donations * 100) / 100;
      case 'time':
        return Math.round((s.timeAdded / 3600) * 100) / 100;
      case 'coins':
        return s.tiktokCoins || 0;
      default:
        return Number(g.progress) || 0;
    }
  }
  const goalsOut = () => D().goals.map((g) => ({ ...g, current: goalProgress(g) }));
  const giftsFor = (m) =>
    D()
      .tiktokRules.filter((r) => r.enabled !== false && r.mediaId === m.id)
      .map((r) => ({ gift: r.gift, image: r.image || catalogEntry(r.gift).image || '', coins: r.coins || catalogEntry(r.gift).coins || 0, minCount: r.minCount || 1 }));
  const mediaPublic = (m) => ({
    id: m.id, name: m.name, description: m.description, type: m.type, code: m.code, prices: m.prices, effect: m.effect,
    previewUrl: D().settings.viewer.previews !== false ? '/media/' + m.file : undefined,
    tiktok: giftsFor(m),
  });
  const feedPublic = (f) => ({ id: f.id, ts: f.ts, type: f.type, user: f.user, amount: f.amount, tier: f.tier, recipient: f.recipient, added: f.added, media: f.media, gift: f.gift, giftImage: f.giftImage, coins: f.coins, fx: f.fx });
  function publicSettings() {
    const s = D().settings;
    return {
      title: s.title, accent: s.accent, accent2: s.accent2, currencySymbol: s.currencySymbol,
      triggerPrefix: s.triggerPrefix, matchMode: s.matchMode, channel: effectiveChannel(), viewer: s.viewer,
      time: { prime: s.time.prime, tier1: s.time.tier1, tier2: s.time.tier2, tier3: s.time.tier3, per100Bits: s.time.per100Bits, perDollar: s.time.perDollar, per100Coins: s.time.per100Coins, multiplier: s.time.multiplier, eventsAddTime: s.time.eventsAddTime === true },
      donationsEnabled: s.donation.provider !== 'none', mediaPaused: s.mediaPaused,
      tiktokEnabled: s.tiktok.enabled !== false && D().tiktokRules.some((r) => r.enabled !== false),
      overlay: s.overlay,
    };
  }
  function publicState() {
    const db = D();
    return {
      settings: publicSettings(), timer: timerState(), stats: db.stats, goals: goalsOut(),
      media: db.media.filter((m) => m.enabled && m.showOnViewer !== false).map(mediaPublic),
      feed: db.settings.viewer.showRecent ? db.feed.filter((f) => !f.test).slice(0, 15).map(feedPublic) : [],
    };
  }
  function tvState() {
    const db = D();
    return {
      settings: { ...publicSettings(), tv: db.settings.tv }, timer: timerState(), stats: db.stats,
      goals: goalsOut(), feed: db.feed.slice(0, 30), chat: recentChat.slice(-40),
    };
  }
  function lanUrls() {
    if (!lan.server) return [];
    const port = lan.port;
    // List the real Wi-Fi/Ethernet address first. Windows and Macs also list virtual adapters
    // (WSL, Hyper-V, VirtualBox, VPNs) that a TV can't reach.
    const found = [];
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
      for (const i of ifs[name] || []) {
        if ((i.family !== 'IPv4' && i.family !== 4) || i.internal || i.address.startsWith('169.254.')) continue;
        let score = 0;
        if (/^(wi-?fi|wlan|ethernet|en\d|eth\d|wlp|enp)/i.test(name)) score += 2;
        if (/^192\.168\./.test(i.address)) score += 1;
        if (/vethernet|virtual|vmware|vbox|hyper-v|wsl|docker|loopback|tailscale|zerotier|vpn|utun|bridge/i.test(name)) score -= 5;
        found.push({ url: `http://${i.address}:${port}`, score });
      }
    }
    return found.sort((a, b) => b.score - a.score).map((f) => f.url);
  }
  function lanState() {
    return { enabled: !!D().lan.enabled, port: D().lan.port, running: !!lan.server, boundPort: lan.port, error: lan.error, urls: lanUrls() };
  }
  function adminState() {
    // eslint-disable-next-line no-unused-vars
    const { auth, ...rest } = D();
    statuses.tvs = tvCount();
    const urls = lanUrls();
    return {
      ...rest,
      goals: goalsOut(),
      timer: timerState(),
      statuses,
      lanUrls: urls,
      chat: recentChat.slice(-40),
      lan: lanState(),
      tunnel: tunnel.state(),
      hasPassword: !!auth.hash,
      twitchLogin: twitchLogin(),
      channelInUse: effectiveChannel(),
      remoteAdminUrl: urls[0] ? urls[0] + '/admin' : '',
      tiktokCatalog: catalogList(),
      tiktokStatus,
      effectNames: EFFECTS,
    };
  }
  function twitchLogin() {
    try {
      return cleanChannel(opts.twitchLogin ? opts.twitchLogin() : '');
    } catch {
      return '';
    }
  }
  const effectiveChannel = () => cleanChannel(D().settings.channel) || twitchLogin();

  // ---------------------------------------------------------------- websockets
  const clients = new Set();
  function attach(ws, role) {
    ws.role = role;
    ws.isAlive = true;
    clients.add(ws);
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('close', () => {
      clients.delete(ws);
      if (ws.role === 'tv') pushStatus();
    });
    ws.on('error', () => {});
    ws.on('message', (raw) => {
      let m;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      if (m.t === 'ping') send(ws, { t: 'pong', serverNow: Date.now() });
      if (ws.role === 'tv' && m.t === 'nowPlaying') {
        nowPlaying = { item: m.item || null, queue: m.queue || 0 };
        sendTo('admin', { t: 'nowPlaying', ...nowPlaying });
      }
    });
    sendInit(ws);
    if (role === 'tv') pushStatus();
  }
  let nowPlaying = { item: null, queue: 0 };
  // LAN: /ws?role=admin|tv|public  (admin needs the session cookie, tv needs the TV code)
  const lanWss = new WebSocketServer({ noServer: true });
  function lanUpgrade(req, socket, head) {
    let url;
    try {
      url = new URL(req.url, 'http://x');
    } catch {
      return socket.destroy();
    }
    if (url.pathname !== '/ws') return socket.destroy();
    let role = url.searchParams.get('role') || 'public';
    if (!['admin', 'tv', 'public'].includes(role)) role = 'public';
    if (role === 'admin' && !cookieAdmin(req)) role = 'public';
    if (role === 'tv' && (url.searchParams.get('code') || '').toUpperCase() !== D().tvCode) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return socket.destroy();
    }
    lanWss.handleUpgrade(req, socket, head, (ws) => {
      ws._lan = true;
      attach(ws, role);
    });
  }
  // Steez: /subathon/ws?role=admin&key=… — the in-app page only.
  const appWss = new WebSocketServer({ noServer: true });
  appWss.on('connection', (ws, req) => {
    if (!opts.keyOk || !opts.keyOk(req)) return ws.close(4001, 'unauthorized');
    attach(ws, 'admin');
    send(ws, { t: 'nowPlaying', ...nowPlaying });
  });

  // Steez: /subathon/public-ws - read-only public state for the OBS menu overlay (localhost).
  const publicWss = new WebSocketServer({ noServer: true });
  publicWss.on('connection', (ws) => attach(ws, 'public'));

  const tvCount = () => {
    let n = 0;
    for (const ws of clients) if (ws.role === 'tv') n++;
    return n;
  };
  function pushStatus() {
    statuses.tvs = tvCount();
    sendTo('admin', { t: 'status', statuses });
    emitLocal({ t: 'status', statuses });
  }
  intervals.push(
    setInterval(() => {
      for (const ws of clients) {
        if (!ws.isAlive) {
          ws.terminate();
          clients.delete(ws);
          continue;
        }
        ws.isAlive = false;
        try {
          ws.ping();
        } catch {
          /* ignore */
        }
      }
    }, 25000),
  );
  function sendInit(ws) {
    const state = ws.role === 'admin' ? adminState() : ws.role === 'tv' ? tvState() : publicState();
    send(ws, { t: 'init', role: ws.role, state });
  }
  function send(ws, obj) {
    if (ws.readyState === 1) ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  }
  function sendTo(roles, obj) {
    const list = Array.isArray(roles) ? roles : [roles];
    const msg = JSON.stringify(obj);
    for (const ws of clients) if (list.includes(ws.role)) send(ws, msg);
  }
  function emitLocal(obj) {
    for (const fn of listeners) {
      try {
        fn(obj);
      } catch {
        /* ignore */
      }
    }
  }
  function broadcast(obj) {
    sendTo(['admin', 'tv', 'public'], obj);
    emitLocal(obj);
  }
  function refreshAll() {
    for (const ws of clients) if (ws.readyState === 1) sendInit(ws);
    emitLocal({ t: 'refresh' });
  }
  const pushStats = () => broadcast({ t: 'stats', stats: D().stats, goals: goalsOut() });

  // ---------------------------------------------------------------- events & media matching
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function findCode(msg, code) {
    const re = new RegExp('(^|[^a-z0-9_])' + escapeRe(code.toLowerCase()) + '(?![a-z0-9_])', 'i');
    const m = re.exec(msg);
    return m ? m.index : -1;
  }
  function priceOf(m, currency) {
    const p = m.prices && Number(m.prices[currency]);
    return p > 0 ? p : 0;
  }
  function matchMedia(currency, amount, message) {
    const db = D();
    const items = db.media.filter((m) => m.enabled && priceOf(m, currency) > 0);
    if (!items.length) return [];
    const prefix = db.settings.triggerPrefix || '';
    const msg = String(message || '');
    // 1) Trigger codes in the message ("#horn"). Several codes can be used if the amount covers them all.
    const coded = items
      .filter((m) => m.code)
      .map((m) => ({ m, at: findCode(msg, prefix + m.code) }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at);
    if (coded.length) {
      const out = [];
      let left = amount + 0.0001;
      for (const { m } of coded) {
        const p = priceOf(m, currency);
        if (p <= left) {
          out.push(m);
          left -= p;
        }
      }
      if (out.length) return out;
    }
    // 2) Amount match
    if (db.settings.matchMode === 'tier') {
      const eligible = items.filter((m) => priceOf(m, currency) <= amount + 0.0001);
      if (!eligible.length) return [];
      const top = Math.max(...eligible.map((m) => priceOf(m, currency)));
      const best = eligible.filter((m) => Math.abs(priceOf(m, currency) - top) < 0.001);
      return [best[Math.floor(Math.random() * best.length)]];
    }
    const exact = items.filter((m) => Math.abs(priceOf(m, currency) - amount) < 0.005);
    return exact.length ? [exact[Math.floor(Math.random() * exact.length)]] : [];
  }
  function playPayload(m, extra) {
    return {
      t: 'play',
      item: { id: m.id, name: m.name, type: m.type, url: '/media/' + m.file, volume: m.volume, duration: m.duration, effect: m.effect, maxSeconds: m.maxSeconds },
      by: extra.by || '', message: extra.message || '', reason: extra.reason || '',
    };
  }
  function playMedia(m, extra) {
    if (D().settings.mediaPaused && !extra.force) return false;
    sendTo('tv', playPayload(m, extra));
    return true;
  }
  /** Which alert effect an event gets: the highest tier it reaches. */
  function fxFor(ev) {
    const fx = D().settings.effects || {};
    const tiers = Array.isArray(fx.tiers) && fx.tiers.length ? fx.tiers : [{ effect: 'pop' }];
    if (fx.enabled === false) return { effect: 'pop', level: 1 };
    const kind = ev.type === 'bits' ? 'bits' : ev.type === 'donation' ? 'donation' : ev.type === 'tiktok' ? 'tiktok' : 'subs';
    const value = kind === 'tiktok' ? Number(ev.coins) || 0 : kind === 'subs' ? (ev.type === 'giftbomb' ? Number(ev.amount) || 1 : 1) : Number(ev.amount) || 0;
    let level = 1;
    tiers.forEach((t, i) => {
      const need = Number(t[kind]);
      if (need > 0 && value >= need) level = i + 1;
    });
    const t = tiers[level - 1] || tiers[0];
    return { effect: EFFECTS.includes(t.effect) ? t.effect : 'pop', level: Math.min(5, level) };
  }

  function describe(f) {
    const cs = D().settings.currencySymbol;
    switch (f.type) {
      case 'tiktok':
        return f.amount + 'x ' + f.gift;
      case 'bits':
        return `${f.amount} bits`;
      case 'donation':
        return `${cs}${Number(f.amount).toFixed(2)}`;
      case 'giftbomb':
        return `${f.amount} gifted sub${f.amount === 1 ? '' : 's'}`;
      case 'gift':
        return 'gifted sub';
      default:
        return 'sub';
    }
  }

  function processEvent(ev, o) {
    o = o || {};
    const db = D();
    const s = db.settings,
      st = db.stats;
    const real = !o.dry;
    let secs = 0,
      currency = null,
      added = 0;
    if (ev.type === 'sub' || ev.type === 'resub' || ev.type === 'gift') {
      currency = 'subs';
      secs = Number(s.time[ev.tier] != null ? s.time[ev.tier] : s.time.tier1) || 0;
      if (real) st.subs += 1;
    } else if (ev.type === 'giftbomb') {
      currency = 'subs';
      // From Twitch, time and sub count arrive with each individual gifted sub that follows,
      // so the bomb itself is only the alert. Test bombs have no follow-ups, so count them here.
      if (o.test) {
        if (real) st.subs += ev.amount;
        secs = (Number(s.time[ev.tier]) || s.time.tier1) * ev.amount;
      }
    } else if (ev.type === 'bits') {
      currency = 'bits';
      secs = (s.time.per100Bits * ev.amount) / 100;
      if (real) st.bits += ev.amount;
    } else if (ev.type === 'donation') {
      currency = 'donation';
      secs = s.time.perDollar * ev.amount;
      if (real) st.donations = Math.round((st.donations + ev.amount) * 100) / 100;
    } else if (ev.type === 'tiktok') {
      currency = 'tiktok';
      const coins = Math.max(0, Number(ev.coins) || 0);
      secs = ((Number(s.time.per100Coins) || 0) * coins) / 100 + (Number(ev.extraSeconds) || 0);
      if (real) st.tiktokCoins = (st.tiktokCoins || 0) + coins;
    } else return null;

    // Events only add time when the streamer has turned that on (they still count, alert and play media).
    const addsTime = s.time.eventsAddTime === true;
    if (!addsTime) secs = 0;

    if (real) added = addEventTime(secs);
    else added = Math.round(secs * (Number(s.time.multiplier) || 1));

    if (ev.type === 'giftbomb' && !o.test && addsTime) {
      // Estimate for the alert; the real time is added by the individual gifts.
      added = Math.round((Number(s.time[ev.tier]) || s.time.tier1) * ev.amount * (Number(s.time.multiplier) || 1));
    }

    // Individual subs of a gift bomb only count; the bomb itself gets the alert.
    // Small TikTok gifts below the alert minimum also just count (no alert, no media).
    if ((ev.type === 'gift' && ev.partOfBomb) || (ev.type === 'tiktok' && ev.silent)) {
      store.save();
      broadcast({ t: 'timer', timer: timerState() });
      pushStats();
      return null;
    }

    const matched =
      currency === 'tiktok'
        ? (ev.mediaIds || []).map((id) => db.media.find((m) => m.id === id && m.enabled)).filter(Boolean)
        : matchMedia(currency, ev.amount, ev.message);
    const item = {
      id: crypto.randomUUID(), ts: Date.now(), type: ev.type, user: ev.user, amount: ev.amount,
      tier: ev.tier || null, months: ev.months || null, recipient: ev.recipient || null,
      message: ev.message || '', currency: ev.currency || '', added, test: !!o.test,
      media: matched.map((m) => m.name),
      fx: fxFor(ev),
    };
    if (ev.type === 'tiktok') Object.assign(item, { gift: ev.gift || 'Gift', giftImage: ev.giftImage || '', coins: Number(ev.coins) || 0 });
    db.feed.unshift(item);
    if (db.feed.length > 100) db.feed.length = 100;
    store.save();

    sendTo(['admin', 'tv'], { t: 'feed', item });
    emitLocal({ t: 'feed', item });
    if (!item.test && db.settings.viewer.showRecent) sendTo('public', { t: 'feed', item: feedPublic(item) });
    broadcast({ t: 'timer', timer: timerState() });
    pushStats();
    for (const m of matched) playMedia(m, { by: ev.user, message: ev.message, reason: describe(item) });
    return item;
  }

  twitch.on('status', (s) => {
    statuses.twitch = s;
    pushStatus();
  });
  twitch.on('chat', (c) => {
    recentChat.push(c);
    if (recentChat.length > 60) recentChat.shift();
    sendTo(['tv', 'admin'], { t: 'chat', msg: c });
  });
  // Timeouts, bans and deleted messages disappear from the TV chat too.
  twitch.on('clear', (c) => {
    for (let i = recentChat.length - 1; i >= 0; i--) {
      const m = recentChat[i];
      if ((c.id && m.id === c.id) || (c.user && m.user.toLowerCase() === c.user.toLowerCase()) || (!c.id && !c.user)) recentChat.splice(i, 1);
    }
    sendTo(['tv', 'admin'], { t: 'clear', ...c });
  });
  twitch.on('event', (ev) => processEvent(ev));
  donations.on('status', (s) => {
    statuses.donations = s;
    pushStatus();
  });
  donations.on('event', (ev) => processEvent(ev));

  const isOn = () => D().settings.enabled === true;
  function applyConnections() {
    if (!isOn()) {
      // Off: no Twitch chat reading, no donation listener.
      try {
        twitch.disconnect();
      } catch {
        /* ignore */
      }
      donations.configure('none', '');
      statuses.twitch = { status: 'off', detail: 'The subathon is turned off' };
      pushStatus();
      return;
    }
    twitch.connect(effectiveChannel());
    const d = D().settings.donation;
    donations.configure(d.provider, d.provider === 'kofi' ? d.kofiToken : d.token);
  }
  async function setEnabled(on) {
    D().settings.enabled = !!on;
    // Off means off: the countdown stops too (Start it again when you're ready).
    if (!on && D().timer.running) timerAction('pause');
    store.save();
    applyConnections();
    await restartLan();
  }

  // ---------------------------------------------------------------- settings
  function applySettings(input) {
    const s = D().settings;
    const i = input || {};
    if (typeof i.channel === 'string') s.channel = cleanChannel(str(i.channel, s.channel, 60));
    s.title = str(i.title, s.title, 60);
    s.accent = color(i.accent, s.accent);
    s.accent2 = color(i.accent2, s.accent2);
    s.currencySymbol = str(i.currencySymbol, s.currencySymbol, 4);
    s.triggerPrefix = str(i.triggerPrefix, s.triggerPrefix, 3);
    s.matchMode = ['exact', 'tier'].includes(i.matchMode) ? i.matchMode : s.matchMode;
    s.mediaPaused = bool(i.mediaPaused, s.mediaPaused);
    s.publicUrl = str(i.publicUrl, s.publicUrl || '', 200).trim().replace(/\/$/, '');
    if (i.time) {
      for (const k of ['prime', 'tier1', 'tier2', 'tier3', 'per100Bits', 'perDollar', 'per100Coins']) s.time[k] = num(i.time[k], s.time[k], 0, 86400 * 7);
      s.time.multiplier = num(i.time.multiplier, s.time.multiplier, 0, 100);
      if (typeof i.time.eventsAddTime === 'boolean') s.time.eventsAddTime = i.time.eventsAddTime;
      s.time.capHours = num(i.time.capHours, s.time.capHours, 0, 24 * 365);
      s.time.initialHours = num(i.time.initialHours, s.time.initialHours, 0, 24 * 365);
    }
    if (i.donation) {
      s.donation.provider = ['none', 'streamlabs', 'streamelements', 'kofi'].includes(i.donation.provider) ? i.donation.provider : s.donation.provider;
      s.donation.token = str(i.donation.token, s.donation.token, 2000).trim();
      s.donation.kofiToken = str(i.donation.kofiToken, s.donation.kofiToken, 200).trim();
    }
    if (i.tv) {
      for (const k of ['showChat', 'showFeed', 'showGoals', 'showNames']) s.tv[k] = bool(i.tv[k], s.tv[k]);
      s.tv.alertSeconds = num(i.tv.alertSeconds, s.tv.alertSeconds, 2, 30);
      s.tv.volume = num(i.tv.volume, s.tv.volume, 0, 100);
    }
    if (i.viewer) {
      s.viewer.intro = str(i.viewer.intro, s.viewer.intro, 600);
      s.viewer.showRecent = bool(i.viewer.showRecent, s.viewer.showRecent);
      s.viewer.previews = bool(i.viewer.previews, s.viewer.previews !== false);
    }
    if (i.tiktok) {
      s.tiktok.enabled = bool(i.tiktok.enabled, s.tiktok.enabled !== false);
      s.tiktok.alertMinCoins = num(i.tiktok.alertMinCoins, s.tiktok.alertMinCoins, 0, 1e6);
    }
    if (i.effects) {
      s.effects.enabled = bool(i.effects.enabled, s.effects.enabled !== false);
      if (Array.isArray(i.effects.tiers)) {
        s.effects.tiers = i.effects.tiers.slice(0, 5).map((t, idx) => ({
          effect: EFFECTS.includes(t && t.effect) ? t.effect : (s.effects.tiers[idx] || {}).effect || 'pop',
          subs: num(t && t.subs, 0, 0, 1e6),
          bits: num(t && t.bits, 0, 0, 1e9),
          donation: num(t && t.donation, 0, 0, 1e9),
          tiktok: num(t && t.tiktok, 0, 0, 1e9),
        }));
      }
    }
    if (i.overlay) {
      const ov = s.overlay;
      ov.style = ['steez', 'glass', 'neon', 'minimal'].includes(i.overlay.style) ? i.overlay.style : ov.style;
      ov.interval = num(i.overlay.interval, ov.interval, 1, 60);
      for (const k of ['showDescription', 'showPrices', 'showCode', 'showTiktok']) ov[k] = bool(i.overlay[k], ov[k]);
      ov.header = str(i.overlay.header, ov.header, 40);
    }
  }
  function saveSettings(input) {
    applySettings(input);
    store.save();
    applyConnections();
    refreshAll();
    return D().settings;
  }

  // ---------------------------------------------------------------- media
  const ALLOWED_EXT = {
    audio: ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus', '.weba'],
    video: ['.mp4', '.webm', '.mov', '.m4v', '.ogv'],
    image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg'],
  };
  function kindOf(mime, ext) {
    for (const k of Object.keys(ALLOWED_EXT)) if (ALLOWED_EXT[k].includes(ext)) return k;
    const top = (mime || '').split('/')[0];
    return ['audio', 'video', 'image'].includes(top) ? top : null;
  }
  const upload = multer({
    storage: multer.diskStorage({
      destination: store.uploadDir,
      filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')),
    }),
    limits: { fileSize: 500 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, !!kindOf(file.mimetype, path.extname(file.originalname).toLowerCase())),
  });
  // multer errors (file too large) as JSON instead of an HTML error page
  const uploadSingle = (req, res, next) =>
    upload.single('file')(req, res, (err) => {
      if (!err) return next();
      res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That file is over 500 MB' : err.message || 'Upload failed' });
    });

  function priceIn(v) {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return n > 0 ? Math.round(n * 100) / 100 : null;
  }
  function applyMedia(m, i) {
    m.name = str(i.name, m.name, 80) || 'Untitled';
    m.description = str(i.description, m.description || '', 300);
    m.code = str(i.code, m.code || '', 30).trim().replace(/^[#!]+/, '').replace(/\s+/g, '').toLowerCase();
    m.volume = num(i.volume, m.volume != null ? m.volume : 100, 0, 100);
    m.duration = num(i.duration, m.duration || 6, 1, 600);
    m.maxSeconds = num(i.maxSeconds, m.maxSeconds || 0, 0, 3600);
    m.effect = ['none', 'flash', 'shake', 'both'].includes(i.effect) ? i.effect : m.effect || 'none';
    m.enabled = bool(i.enabled === 'true' ? true : i.enabled === 'false' ? false : i.enabled, m.enabled !== false);
    m.showOnViewer = bool(i.showOnViewer === 'true' ? true : i.showOnViewer === 'false' ? false : i.showOnViewer, m.showOnViewer !== false);
    let prices = i.prices;
    if (typeof prices === 'string') {
      try {
        prices = JSON.parse(prices);
      } catch {
        prices = null;
      }
    }
    if (prices) m.prices = { bits: priceIn(prices.bits), subs: priceIn(prices.subs), donation: priceIn(prices.donation) };
    if (m.prices && m.prices.bits) m.prices.bits = Math.round(m.prices.bits);
    if (m.prices && m.prices.subs) m.prices.subs = Math.round(m.prices.subs);
  }
  function applyGoal(g, i) {
    g.title = str(i.title, g.title, 100) || 'New goal';
    g.description = str(i.description, g.description || '', 300);
    g.metric = ['subs', 'bits', 'donations', 'time', 'coins', 'manual'].includes(i.metric) ? i.metric : g.metric || 'subs';
    g.target = num(i.target, g.target || 10, 0, 1e9);
    g.progress = num(i.progress, g.progress || 0, 0, 1e9);
    g.done = bool(i.done, !!g.done);
  }

  // ---------------------------------------------------------------- HTTP API
  /** keyAuth: the in-app door (Steez key). Otherwise the LAN door (password + cookie). */
  function apiRouter({ keyAuth }) {
    const r = express.Router();
    r.use(express.json({ limit: '1mb' }));
    r.use(express.urlencoded({ extended: false, limit: '1mb' }));
    const isAdmin = (req) => (keyAuth ? !!(opts.keyOk && opts.keyOk(req)) : cookieAdmin(req));
    const requireAdmin = (req, res, next) => (isAdmin(req) ? next() : res.status(401).json({ error: 'Not logged in' }));

    if (!keyAuth) {
      r.get('/api/auth', (req, res) => res.json({ setup: !D().auth.hash, loggedIn: cookieAdmin(req) }));
      r.post('/api/setup', (req, res) => {
        if (D().auth.hash) return res.status(400).json({ error: 'Already set up' });
        const pw = String((req.body || {}).password || '');
        if (pw.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
        setPassword(pw);
        setSessionCookie(req, res);
        res.json({ ok: true });
      });
      r.post('/api/login', (req, res) => {
        if (rateLimited(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
        if (!D().auth.hash) return res.status(400).json({ error: 'Not set up yet' });
        const h = hashPassword((req.body || {}).password || '', D().auth.salt);
        if (!crypto.timingSafeEqual(Buffer.from(h), Buffer.from(D().auth.hash))) return res.status(401).json({ error: 'Wrong password' });
        loginAttempts.delete(req.ip);
        setSessionCookie(req, res);
        res.json({ ok: true });
      });
      r.post('/api/logout', (req, res) => {
        res.setHeader('Set-Cookie', 'smp_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
        res.json({ ok: true });
      });
    }
    r.post('/api/password', requireAdmin, (req, res) => {
      const b = req.body || {};
      // The in-app page is already trusted, so it can set or reset the remote password directly.
      if (!keyAuth && hashPassword(b.current || '', D().auth.salt) !== D().auth.hash) return res.status(400).json({ error: 'Current password is wrong' });
      const pw = String(b.password || '');
      if (pw.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
      setPassword(pw);
      if (!keyAuth) setSessionCookie(req, res);
      refreshAll();
      res.json({ ok: true });
    });

    r.get('/api/admin/state', requireAdmin, (req, res) => res.json(adminState()));
    r.put('/api/settings', requireAdmin, (req, res) => res.json({ ok: true, settings: saveSettings(req.body) }));

    r.post('/api/media', requireAdmin, uploadSingle, (req, res) => {
      if (!req.file) return res.status(400).json({ error: 'Pick an audio, video or image file' });
      const ext = path.extname(req.file.filename);
      const m = {
        id: crypto.randomUUID(), file: req.file.filename, original: req.file.originalname.slice(0, 200),
        mime: req.file.mimetype, size: req.file.size, type: kindOf(req.file.mimetype, ext),
        prices: { bits: null, subs: null, donation: null }, createdAt: Date.now(),
      };
      applyMedia(m, { name: path.basename(req.file.originalname, path.extname(req.file.originalname)), ...req.body });
      D().media.push(m);
      store.save();
      refreshAll();
      res.json({ ok: true, item: m });
    });
    r.post('/api/media/reorder', requireAdmin, (req, res) => {
      const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
      D().media.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      store.save();
      refreshAll();
      res.json({ ok: true });
    });
    r.put('/api/media/:id', requireAdmin, (req, res) => {
      const m = D().media.find((x) => x.id === req.params.id);
      if (!m) return res.status(404).json({ error: 'Not found' });
      applyMedia(m, req.body || {});
      store.save();
      refreshAll();
      res.json({ ok: true, item: m });
    });
    r.post('/api/media/:id/file', requireAdmin, uploadSingle, (req, res) => {
      const m = D().media.find((x) => x.id === req.params.id);
      if (!m || !req.file) return res.status(400).json({ error: 'Pick an audio, video or image file' });
      fs.unlink(path.join(store.uploadDir, path.basename(m.file)), () => {});
      m.file = req.file.filename;
      m.original = req.file.originalname.slice(0, 200);
      m.mime = req.file.mimetype;
      m.size = req.file.size;
      m.type = kindOf(req.file.mimetype, path.extname(req.file.filename));
      store.save();
      refreshAll();
      res.json({ ok: true, item: m });
    });
    r.delete('/api/media/:id', requireAdmin, (req, res) => {
      const idx = D().media.findIndex((x) => x.id === req.params.id);
      if (idx < 0) return res.status(404).json({ error: 'Not found' });
      const [m] = D().media.splice(idx, 1);
      fs.unlink(path.join(store.uploadDir, path.basename(m.file)), () => {});
      store.save();
      refreshAll();
      res.json({ ok: true });
    });
    r.post('/api/media/:id/play', requireAdmin, (req, res) => {
      const m = D().media.find((x) => x.id === req.params.id);
      if (!m) return res.status(404).json({ error: 'Not found' });
      playMedia(m, { by: str((req.body || {}).by, '', 40), message: '', reason: 'Played from dashboard', force: true });
      res.json({ ok: true });
    });

    r.post('/api/goals', requireAdmin, (req, res) => {
      const g = { id: crypto.randomUUID() };
      applyGoal(g, req.body || {});
      D().goals.push(g);
      store.save();
      refreshAll();
      res.json({ ok: true, goal: g });
    });
    r.post('/api/goals/reorder', requireAdmin, (req, res) => {
      const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
      D().goals.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      store.save();
      refreshAll();
      res.json({ ok: true });
    });
    r.put('/api/goals/:id', requireAdmin, (req, res) => {
      const g = D().goals.find((x) => x.id === req.params.id);
      if (!g) return res.status(404).json({ error: 'Not found' });
      applyGoal(g, { ...g, ...(req.body || {}) });
      store.save();
      refreshAll();
      res.json({ ok: true, goal: g });
    });
    r.delete('/api/goals/:id', requireAdmin, (req, res) => {
      D().goals = D().goals.filter((x) => x.id !== req.params.id);
      store.save();
      refreshAll();
      res.json({ ok: true });
    });

    r.put('/api/tiktok-rules', requireAdmin, (req, res) => {
      const list = Array.isArray((req.body || {}).rules) ? req.body.rules : [];
      D().tiktokRules = list
        .slice(0, 200)
        .map((x) => {
          const gift = str(x.gift, '', 60).trim();
          const known = catalogEntry(gift);
          return {
            id: str(x.id, '', 60) || crypto.randomUUID(),
            gift: known.name || gift,
            giftId: str(x.giftId, known.giftId || '', 40),
            image: str(x.image, known.image || '', 500),
            coins: num(x.coins, known.coins || 0, 0, 1e6),
            mediaId: str(x.mediaId, '', 60),
            minCount: Math.round(num(x.minCount, 1, 1, 10000)),
            addSeconds: num(x.addSeconds, 0, 0, 86400),
            enabled: bool(x.enabled, true),
          };
        })
        .filter((x) => x.gift);
      store.save();
      refreshAll();
      res.json({ ok: true, rules: D().tiktokRules });
    });
    r.post('/api/timer', requireAdmin, (req, res) => {
      const t = timerAction((req.body || {}).action, (req.body || {}).seconds);
      if (!t) return res.status(400).json({ error: 'Unknown action' });
      res.json({ ok: true, timer: t });
    });
    r.post('/api/stats/reset', requireAdmin, (req, res) => {
      D().stats = { subs: 0, bits: 0, donations: 0, timeAdded: 0, tiktokCoins: 0 };
      D().feed = [];
      store.save();
      refreshAll();
      res.json({ ok: true });
    });
    r.put('/api/stats', requireAdmin, (req, res) => {
      const st = D().stats,
        i = req.body || {};
      st.subs = num(i.subs, st.subs, 0);
      st.bits = num(i.bits, st.bits, 0);
      st.donations = num(i.donations, st.donations, 0);
      st.tiktokCoins = num(i.tiktokCoins, st.tiktokCoins || 0, 0);
      store.save();
      pushStats();
      res.json({ ok: true });
    });
    r.post('/api/feed/clear', requireAdmin, (req, res) => {
      D().feed = [];
      store.save();
      refreshAll();
      res.json({ ok: true });
    });
    r.post('/api/test', requireAdmin, (req, res) => {
      res.json({ ok: true, item: testEvent(req.body || {}) });
    });
    r.post('/api/test-match', requireAdmin, (req, res) => {
      const b = req.body || {};
      const currency = ['bits', 'subs', 'donation'].includes(b.currency) ? b.currency : 'bits';
      const matched = matchMedia(currency, num(b.amount, 0, 0), str(b.message, '', 300));
      res.json({ ok: true, matched: matched.map((m) => ({ id: m.id, name: m.name })) });
    });
    r.post('/api/reconnect', requireAdmin, (req, res) => {
      reconnect();
      res.json({ ok: true });
    });
    r.post('/api/test-chat', requireAdmin, (req, res) => {
      testChat(req.body || {});
      res.json({ ok: true });
    });
    r.post('/api/tv/control', requireAdmin, (req, res) => {
      const action = ['skip', 'clear', 'reload', 'test-sound'].includes((req.body || {}).action) ? req.body.action : null;
      if (!action) return res.status(400).json({ error: 'Unknown action' });
      sendTo('tv', { t: 'control', action });
      res.json({ ok: true });
    });
    r.post('/api/tv/regen-code', requireAdmin, (req, res) => {
      D().tvCode = randomCode(6);
      store.save();
      for (const ws of clients) if (ws.role === 'tv') ws.close();
      refreshAll();
      res.json({ ok: true, tvCode: D().tvCode });
    });

    if (keyAuth) {
      // Steez-only controls
      r.put('/api/enabled', requireAdmin, async (req, res) => {
        await setEnabled(!!(req.body || {}).enabled);
        if (opts.onEnabledChange) opts.onEnabledChange();
        res.json({ ok: true, enabled: isOn() });
      });
      r.put('/api/lan', requireAdmin, async (req, res) => {
        const b = req.body || {};
        if (b.port != null) D().lan.port = Math.round(num(b.port, D().lan.port, 1024, 65535));
        if (typeof b.enabled === 'boolean') D().lan.enabled = b.enabled;
        store.save();
        await restartLan();
        res.json({ ok: true, lan: lanState() });
      });
      r.post('/api/tunnel', requireAdmin, async (req, res) => {
        const a = (req.body || {}).action;
        if (a === 'stop') tunnel.stop();
        else {
          tunnel.start(); // reports progress over the websocket
        }
        res.json({ ok: true, tunnel: tunnel.state() });
      });
      r.post('/api/fix-tv', requireAdmin, (req, res) => {
        try {
          if (!opts.runFixTv) throw new Error('Not available here');
          opts.runFixTv({ port: lan.port || D().lan.port, code: D().tvCode });
          res.json({ ok: true });
        } catch (e) {
          res.status(500).json({ error: e.message });
        }
      });
      r.post('/api/import', requireAdmin, async (req, res) => {
        try {
          if (!opts.pickImport) throw new Error('Not available here');
          const dir = await opts.pickImport();
          if (!dir) return res.json({ ok: false, cancelled: true });
          res.json({ ok: true, ...importFrom(dir) });
        } catch (e) {
          res.status(400).json({ error: e.message });
        }
      });
      r.use('/media', express.static(store.uploadDir, { maxAge: '7d', fallthrough: false, dotfiles: 'deny' }));
    }
    return r;
  }

  function testEvent(i) {
    if (i.type === 'tiktok') {
      const gift = str(i.gift, 'Rose', 60) || 'Rose';
      const g = {
        name: str(i.user, 'TestViewer', 40) || 'TestViewer', giftName: catalogEntry(gift).name || gift, giftId: '', giftImage: '',
        diamonds: catalogEntry(gift).coins || num(i.coins, 1, 0, 1e6), repeatCount: Math.max(1, Math.round(num(i.amount, 1, 1, 10000))), giftType: 0,
      };
      return tiktokGift(g, { test: true, dry: !i.real });
    }
    const type = ['sub', 'resub', 'gift', 'giftbomb', 'bits', 'donation'].includes(i.type) ? i.type : 'sub';
    const ev = {
      type, user: str(i.user, 'TestViewer', 40) || 'TestViewer', tier: ['prime', 'tier1', 'tier2', 'tier3'].includes(i.tier) ? i.tier : 'tier1',
      amount: type === 'sub' || type === 'resub' || type === 'gift' ? 1 : Math.max(0.01, num(i.amount, 1, 0.01, 1e7)),
      message: str(i.message, '', 300), months: type === 'resub' ? 6 : 1, recipient: type === 'gift' ? 'LuckyViewer' : '',
    };
    if (type === 'bits' || type === 'giftbomb') ev.amount = Math.max(1, Math.round(ev.amount));
    return processEvent(ev, { test: true, dry: !i.real });
  }
  function testChat(b) {
    const names = ['NightOwl', 'CoffeeGoblin', 'SleepyPanda', 'xXGamerXx', 'ModSquad', 'pixelpirate'];
    const colors = ['#ff6b6b', '#ffd93d', '#6bcB77', '#4d96ff', '#c77dff', '#ff9f1c'];
    const k = Math.floor(Math.random() * names.length);
    const text = str(b.text, '', 300) || 'Test message from the dashboard Kappa';
    const at = text.indexOf('Kappa');
    const c = {
      id: crypto.randomUUID(), user: str(b.user, '', 40) || names[k], color: colors[k],
      text, emotes: !b.text && at >= 0 ? `25:${at}-${at + 4}` : '', badges: '', action: false,
    };
    recentChat.push(c);
    if (recentChat.length > 60) recentChat.shift();
    sendTo(['tv', 'admin'], { t: 'chat', msg: c });
  }
  function reconnect() {
    twitch.channel = '';
    donations.provider = '__';
    applyConnections();
  }

  // ---------------------------------------------------------------- import from the standalone app
  function importFrom(dir) {
    const dataDir = fs.existsSync(path.join(dir, 'data', 'db.json')) ? path.join(dir, 'data') : dir;
    const file = path.join(dataDir, 'db.json');
    if (!fs.existsSync(file)) throw new Error('No Subathon Media Player data found there (looking for data/db.json).');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    let copied = 0;
    const up = path.join(dataDir, 'uploads');
    if (fs.existsSync(up)) {
      for (const f of fs.readdirSync(up)) {
        const dest = path.join(store.uploadDir, f);
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(path.join(up, f), dest);
          copied++;
        }
      }
    }
    store.importFrom(data);
    applyConnections();
    refreshAll();
    log.info?.(`Imported Subathon Media Player data from ${dataDir} (${(data.media || []).length} media, ${copied} files).`);
    return { media: (data.media || []).length, goals: (data.goals || []).length, files: copied };
  }

  // ---------------------------------------------------------------- pages (LAN)
  function lanApp() {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', true); // the Cloudflare tunnel
    app.use(apiRouter({ keyAuth: false }));
    app.get('/api/public', (req, res) => res.json(publicState()));
    app.post('/webhook/kofi', express.urlencoded({ extended: false, limit: '1mb' }), express.json({ limit: '1mb' }), (req, res) => {
      if (D().settings.donation.provider !== 'kofi') return res.status(404).end();
      const ok = donations.handleKofi(req.body || {}, D().settings.donation.kofiToken);
      res.status(ok ? 200 : 401).end();
    });
    app.use('/media', express.static(store.uploadDir, { maxAge: '7d', fallthrough: false, dotfiles: 'deny' }));
    // no-cache: revalidate (ETag) so TVs pick up new page code right after a Steez update
    app.use('/static', express.static(PUB, { maxAge: 0, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
    app.get('/', (req, res) => res.sendFile(path.join(PUB, 'viewer.html')));
    app.get('/admin', (req, res) => res.sendFile(path.join(PUB, 'admin.html')));
    app.get('/overlay/menu', (req, res) => res.sendFile(path.join(PUB, 'overlay.html')));
    app.get('/tv', (req, res) => res.sendFile(path.join(PUB, 'tv-code.html')));
    app.get('/tv/:code', (req, res) => {
      if (String(req.params.code).toUpperCase() !== D().tvCode) return res.redirect('/tv?wrong=1');
      res.sendFile(path.join(PUB, 'tv.html'));
    });
    app.post('/tv', express.urlencoded({ extended: false }), (req, res) => {
      const code = String((req.body || {}).code || '').trim().toUpperCase();
      res.redirect(code === D().tvCode ? '/tv/' + code : '/tv?wrong=1');
    });
    app.use((req, res) => res.status(404).send('Not found'));
    return app;
  }

  const lan = { server: null, port: 0, error: '' };
  const lanHandler = lanApp();
  function stopLan() {
    return new Promise((resolve) => {
      const s = lan.server;
      lan.server = null;
      lan.port = 0;
      if (!s) return resolve();
      for (const ws of clients) if (ws._lan) ws.close();
      try {
        s.closeAllConnections && s.closeAllConnections();
        s.close(() => resolve());
      } catch {
        resolve();
      }
      setTimeout(resolve, 1000).unref?.();
    });
  }
  async function startLan() {
    const port = D().lan.port || 3000;
    const s = http.createServer(lanHandler);
    s.on('upgrade', lanUpgrade);
    try {
      await new Promise((resolve, reject) => {
        s.once('error', reject);
        s.listen(port, opts.lanHost || '0.0.0.0', () => {
          s.off('error', reject);
          resolve();
        });
      });
      lan.server = s;
      lan.port = s.address().port;
      lan.error = '';
      s.on('error', (e) => log.warn?.('Subathon server: ' + e.message));
      log.info?.(`Subathon TV & viewer server on port ${lan.port}`);
    } catch (e) {
      lan.error = e.code === 'EADDRINUSE' ? `Port ${port} is already in use by another program — pick another port.` : e.message;
      log.warn?.('Subathon server could not start: ' + lan.error);
    }
  }
  async function restartLan() {
    await stopLan();
    if (D().lan.enabled && isOn()) await startLan();
    if (!lan.server && tunnel.state().state !== 'off') tunnel.stop();
    pushLan();
    refreshAll();
  }
  const pushLan = () => {
    sendTo('admin', { t: 'lan', lan: lanState() });
    emitLocal({ t: 'lan', lan: lanState() });
  };

  const tunnel = createTunnel({
    getPort: () => lan.port,
    log,
    onChange: (t) => {
      sendTo('admin', { t: 'tunnel', tunnel: t });
      emitLocal({ t: 'tunnel', tunnel: t });
    },
  });

  // ---------------------------------------------------------------- TikTok gifts (Steez)
  // Gifts come from the TikTok connection on the TikTok Gifts page. Combo gifts (tapped many
  // times) arrive as a run of events; only the final count is used, with a stall fallback.
  let tiktokStatus = { status: 'off', username: '' };
  const pendingCombos = new Map();
  const norm = (n) => String(n || '').trim().toLowerCase();
  function catalogEntry(name) {
    const k = norm(name);
    const seen = (D().tiktokCatalog || {})[k];
    if (seen) return seen;
    const b = TIKTOK_GIFTS.find(([n]) => norm(n) === k);
    return b ? { name: b[0], coins: b[1], image: '', giftId: '' } : {};
  }
  function catalogList() {
    const out = new Map();
    for (const [n, c] of TIKTOK_GIFTS) out.set(norm(n), { name: n, coins: c, image: '', giftId: '', seen: false });
    for (const [k, v] of Object.entries(D().tiktokCatalog || {})) out.set(k, { ...out.get(k), ...v, seen: true });
    return [...out.values()].sort((a, b) => (a.coins || 0) - (b.coins || 0) || a.name.localeCompare(b.name));
  }
  function remember(g) {
    const k = norm(g.giftName);
    if (!k) return;
    const cat = D().tiktokCatalog || (D().tiktokCatalog = {});
    const prev = cat[k] || {};
    cat[k] = { name: g.giftName, giftId: String(g.giftId || prev.giftId || ''), image: g.giftImage || prev.image || '', coins: Number(g.diamonds) || prev.coins || 0, lastSeen: Date.now() };
    // fill in pictures/ids on rules made before the gift was seen
    for (const r of D().tiktokRules) {
      if (norm(r.gift) !== k) continue;
      if (!r.image && cat[k].image) r.image = cat[k].image;
      if (!r.giftId && cat[k].giftId) r.giftId = cat[k].giftId;
      if (!r.coins && cat[k].coins) r.coins = cat[k].coins;
    }
    const keys = Object.keys(cat);
    if (keys.length > 300) {
      keys.sort((a, b) => (cat[a].lastSeen || 0) - (cat[b].lastSeen || 0));
      for (const old of keys.slice(0, keys.length - 300)) delete cat[old];
    }
  }
  /** A finished gift (count = combo length). */
  function tiktokGift(g, o) {
    o = o || {};
    if (!o.test) remember(g);
    const s = D().settings;
    if (s.tiktok.enabled === false && !o.test) return null;
    const count = Math.max(1, Number(g.repeatCount) || 1);
    const coins = (Number(g.diamonds) || catalogEntry(g.giftName).coins || 0) * count;
    const rules = D().tiktokRules.filter(
      (r) => r.enabled !== false && ((r.giftId && g.giftId && r.giftId === String(g.giftId)) || norm(r.gift) === norm(g.giftName)) && count >= (r.minCount || 1),
    );
    const ev = {
      type: 'tiktok', user: g.name || g.login || 'Someone', amount: count, gift: g.giftName || 'Gift',
      giftImage: g.giftImage || catalogEntry(g.giftName).image || '', coins,
      mediaIds: [...new Set(rules.map((r) => r.mediaId).filter(Boolean))],
      extraSeconds: rules.reduce((a, r) => a + (Number(r.addSeconds) || 0), 0),
      silent: !rules.length && coins < (Number(s.tiktok.alertMinCoins) || 0),
    };
    return processEvent(ev, o);
  }
  function handleTiktokGift(g) {
    if (!g || !g.giftName || !isOn()) return null;
    const key = (g.login || g.name) + '|' + (g.giftId || g.giftName);
    const streak = Number(g.giftType) === 1;
    if (!streak) return tiktokGift(g);
    const prev = pendingCombos.get(key);
    if (prev) clearTimeout(prev);
    if (g.repeatEnd) {
      pendingCombos.delete(key);
      return tiktokGift(g);
    }
    const timer = setTimeout(() => {
      pendingCombos.delete(key);
      tiktokGift(g);
    }, 8000);
    if (timer.unref) timer.unref();
    pendingCombos.set(key, timer);
    return null;
  }
  function setTiktokStatus(st) {
    tiktokStatus = { status: (st && st.status) || 'off', username: (st && st.username) || '' };
    sendTo('admin', { t: 'tiktok', tiktok: tiktokStatus });
  }

  // ---------------------------------------------------------------- lifecycle
  async function start() {
    applyConnections();
    if (D().lan.enabled && isOn()) await startLan();
  }
  async function close() {
    for (const i of intervals) clearInterval(i);
    tunnel.stop();
    try {
      twitch.disconnect();
    } catch {
      /* ignore */
    }
    try {
      donations.stop();
    } catch {
      /* ignore */
    }
    for (const ws of clients) {
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
    }
    await stopLan();
    if (D().timer.running) D().timer.heartbeat = Date.now();
    store.saveNow();
  }

  return {
    store,
    get db() {
      return D();
    },
    start,
    close,
    appRouter: apiRouter({ keyAuth: true }),
    appWss,
    publicWss,
    overlayFile: path.join(PUB, 'overlay.html'),
    handleTiktokGift,
    setTiktokStatus,
    setEnabled,
    isOn,
    fxFor,
    lanState,
    tunnel,
    restartLan,
    processEvent,
    matchMedia,
    timerState,
    timerAction,
    remainingMs,
    goalsOut,
    adminState,
    effectiveChannel,
    applyConnections,
    importFrom,
    testEvent,
    playMedia: (id) => {
      const m = D().media.find((x) => x.id === id || x.name.toLowerCase() === String(id).toLowerCase());
      if (!m) return null;
      playMedia(m, { by: '', message: '', reason: 'Played by the bot', force: true });
      return m;
    },
    on: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    statuses,
    twitch,
    donations,
  };
}

module.exports = { createSubathon, cleanChannel };
