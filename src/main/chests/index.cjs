'use strict';
// Fortnite chest tracker (from github.com/Inceptofn/Fortnite-Chest-Tracker, MIT).
// The counting runs in ChestTracker.exe (native/chest-tracker): it reads Fortnite's replays for the
// exact per-match count and reads the "+XP CHEST" popup off the screen for a live count while you
// play. This module starts it, keeps the settings, and serves the page, the overlays and !chests.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');

const GROUP = 'Fortnite chests';
const DEFAULTS = {
  enabled: false, // off until the streamer turns it on
  liveCounter: true, // read the XP popup off the screen while playing
  autoScan: true, // read new replays when Steez starts
  screenIndex: -1, // which monitor Fortnite is on (-1 = main)
  chatCommand: true,
  // "Count from my own number": total = base + chests counted since `since`
  total: { on: false, base: 0, since: 0 },
  overlay: { title: 'CHESTS', accent: '#f2b84b', textLabel: 'Chests Opened:', textColor: '#ffffff', showAvg: true, showBest: true, showLast: true, showTotal: true },
};

function init(ctx) {
  const store = ctx.createStore('chests', DEFAULTS);
  const S = () => store.data;
  const exe = path.join(ctx.resourcesPath, 'bin', 'win32-x64', 'ChestTracker.exe');

  const state = {
    helper: { status: 'off', error: '', ocr: null, demosExists: null, replays: 0, demos: '', screens: [] },
    live: null,
    popup: '',
    scan: null, // { done, total } while scanning
    lastScan: null,
    stats: null,
    log: [],
  };

  // ─── The helper process ─────────────────────────────────────────
  let child = null;
  let restartTimer = null;
  let restarts = 0;
  let wantRunning = false;

  function sendCmd(obj) {
    if (child && child.stdin.writable) child.stdin.write(JSON.stringify(obj) + '\n');
  }

  function start() {
    wantRunning = true;
    if (child) return;
    if (!fs.existsSync(exe)) {
      state.helper = { ...state.helper, status: 'missing', error: 'The chest tracker program is missing from this Steez install. Reinstall Steez, or run `npm run chests:build` in a dev checkout.' };
      push();
      return;
    }
    state.helper = { ...state.helper, status: 'starting', error: '' };
    push();
    let buf = '';
    child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          onEvent(JSON.parse(line));
        } catch (e) {
          ctx.log.warn('Chest tracker sent something unreadable: ' + line.slice(0, 120));
        }
      }
    });
    child.stderr.on('data', (d) => ctx.log.warn('Chest tracker: ' + String(d).trim().slice(0, 300)));
    child.on('error', (e) => {
      state.helper = { ...state.helper, status: 'error', error: e.message };
      push();
    });
    child.on('exit', (code) => {
      child = null;
      state.live = null;
      state.scan = null;
      if (!wantRunning) {
        state.helper = { ...state.helper, status: 'off' };
        push();
        return;
      }
      // It stopped by itself: start it again, waiting longer each time.
      restarts++;
      state.helper = { ...state.helper, status: 'error', error: `The chest tracker stopped (code ${code}). Restarting…` };
      push();
      clearTimeout(restartTimer);
      restartTimer = setTimeout(start, Math.min(60000, 1500 * 2 ** Math.min(restarts, 5)));
    });
  }

  function stop() {
    wantRunning = false;
    clearTimeout(restartTimer);
    if (child) {
      try {
        child.stdin.end(); // the helper exits when its input closes
      } catch {
        /* ignore */
      }
      const c = child;
      setTimeout(() => {
        try {
          c.kill();
        } catch {
          /* ignore */
        }
      }, 3000);
    }
  }

  function onEvent(m) {
    switch (m.type) {
      case 'ready':
        restarts = 0;
        state.helper = { status: 'running', error: '', ocr: m.ocr, demosExists: m.demosExists, replays: m.replays, demos: m.demos, screens: m.screens || [] };
        sendCmd({ cmd: 'screen', index: S().screenIndex });
        if (S().liveCounter) sendCmd({ cmd: 'live', on: true });
        if (S().autoScan && m.demosExists) sendCmd({ cmd: 'scan' });
        break;
      case 'live':
        state.live = m.count;
        break;
      case 'popup':
        state.popup = m.text;
        break;
      case 'progress':
        state.scan = { done: m.done, total: m.total };
        break;
      case 'scanned':
        state.scan = null;
        state.lastScan = { at: Date.now(), total: m.total, parsed: m.parsed, failed: m.failed, newMatches: m.newMatches, skippedMode: m.skippedMode };
        if (m.newMatches) ctx.log.info(`Chest tracker: ${m.newMatches} new matches from replays`);
        break;
      case 'stats':
        state.stats = m;
        if (m.live !== undefined && m.live !== null) state.live = m.live;
        break;
      case 'log':
        state.log = [...state.log.slice(-39), m.text];
        break;
      case 'error':
        state.log = [...state.log.slice(-39), 'Problem: ' + m.message];
        state.helper = { ...state.helper, lastError: m.message };
        ctx.log.warn('Chest tracker: ' + m.message);
        break;
      default:
        return;
    }
    push();
  }

  // ─── Numbers ───────────────────────────────────────────────────
  /** Chests counted since a moment: finished matches after it, plus this match so far. */
  function runningTotal() {
    const t = S().total;
    if (!t.on) return null;
    const matches = state.stats?.matches || [];
    let n = Number(t.base) || 0;
    for (const m of matches) if (Date.parse(m.t) >= t.since) n += m.n;
    return n + (state.live || 0);
  }

  function overlayData() {
    const st = state.stats;
    const all = st?.periods?.all || { matches: 0, chests: 0, avg: 0, best: 0 };
    const o = S().overlay;
    return {
      on: !!S().enabled,
      title: o.title,
      accent: o.accent,
      textLabel: o.textLabel || 'Chests Opened:',
      textColor: o.textColor || '#ffffff',
      chests: all.chests,
      show: { avg: o.showAvg, best: o.showBest, last: o.showLast, total: o.showTotal && S().total.on },
      live: state.live,
      total: runningTotal(),
      avg: all.avg,
      best: all.best,
      last: st?.last ?? null,
      matches: all.matches,
    };
  }

  function fullState() {
    const { matches, ...stats } = state.stats || {};
    return { settings: S(), helper: state.helper, live: state.live, popup: state.popup, scan: state.scan, lastScan: state.lastScan, stats: state.stats ? stats : null, total: runningTotal(), log: state.log.slice(-15), overlay: overlayData() };
  }

  // ─── Live updates (server-sent events) ─────────────────────────
  const streams = { overlay: new Set(), full: new Set() };
  let pushTimer = null;
  function push() {
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      const o = 'data: ' + JSON.stringify(overlayData()) + '\n\n';
      for (const res of streams.overlay) res.write(o);
      if (streams.full.size) {
        const f = 'data: ' + JSON.stringify(fullState()) + '\n\n';
        for (const res of streams.full) res.write(f);
      }
    }, 50);
  }
  function stream(set, payload) {
    return (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      res.write('data: ' + JSON.stringify(payload()) + '\n\n');
      set.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => {
        clearInterval(ping);
        set.delete(res);
      });
    };
  }

  // ─── Routes ────────────────────────────────────────────────────
  const r = ctx.server.router;
  const needKey = (req, res, next) => (ctx.checkKey(req) ? next() : res.status(401).json({ error: 'Not allowed' }));
  const overlayFile = path.join(__dirname, 'overlay.html');
  r.get('/overlay/chests', (req, res) => res.sendFile(overlayFile));
  r.get('/chests/overlay-stream', stream(streams.overlay, overlayData));
  r.get('/chests/api/stream', needKey, stream(streams.full, fullState));
  r.get('/chests/api/state', needKey, (req, res) => res.json(fullState()));
  r.post('/chests/api/scan', needKey, (req, res) => {
    if (!child) return res.status(409).json({ error: 'Turn the chest tracker on first.' });
    sendCmd({ cmd: 'scan' });
    state.scan = { done: 0, total: state.helper.replays || 0 };
    push();
    res.json({ ok: true });
  });
  r.post('/chests/api/adjust', needKey, express.json(), (req, res) => {
    if (!child) return res.status(409).json({ error: 'Turn the chest tracker on first.' });
    sendCmd({ cmd: 'adjust', delta: Math.max(-50, Math.min(50, Math.round(Number(req.body?.delta) || 0))) });
    res.json({ ok: true });
  });
  r.post('/chests/api/reset', needKey, (req, res) => {
    if (!child) return res.status(409).json({ error: 'Turn the chest tracker on first.' });
    sendCmd({ cmd: 'reset' });
    res.json({ ok: true });
  });
  r.put('/chests/api/settings', needKey, express.json(), (req, res) => {
    const b = req.body || {};
    const cur = S();
    const next = { ...cur };
    if (typeof b.liveCounter === 'boolean') next.liveCounter = b.liveCounter;
    if (typeof b.autoScan === 'boolean') next.autoScan = b.autoScan;
    if (typeof b.chatCommand === 'boolean') next.chatCommand = b.chatCommand;
    if (Number.isInteger(b.screenIndex)) next.screenIndex = b.screenIndex;
    if (b.overlay && typeof b.overlay === 'object') {
      const o = { ...cur.overlay };
      if (typeof b.overlay.title === 'string') o.title = b.overlay.title.slice(0, 24);
      if (/^#[0-9a-f]{6}$/i.test(b.overlay.accent || '')) o.accent = b.overlay.accent;
      if (typeof b.overlay.textLabel === 'string') o.textLabel = b.overlay.textLabel.slice(0, 40);
      if (/^#[0-9a-f]{6}$/i.test(b.overlay.textColor || '')) o.textColor = b.overlay.textColor;
      for (const k of ['showAvg', 'showBest', 'showLast', 'showTotal']) if (typeof b.overlay[k] === 'boolean') o[k] = b.overlay[k];
      next.overlay = o;
    }
    if (b.total && typeof b.total === 'object') {
      const t = { ...cur.total };
      if (typeof b.total.on === 'boolean') t.on = b.total.on;
      if (b.total.count !== undefined) {
        // "I've opened N chests so far": the total shows N right now and counts up from there.
        const n = Math.max(0, Math.round(Number(b.total.count) || 0));
        const live = state.live || 0;
        t.base = n - live;
        // A match in progress is recorded with its start time, so start the window before it.
        t.since = Date.now() - (state.live !== null ? 45 * 60000 : 0);
      }
      next.total = t;
    }
    store.replace(next);
    if (child) {
      if (next.liveCounter !== cur.liveCounter) sendCmd({ cmd: 'live', on: next.liveCounter });
      if (next.screenIndex !== cur.screenIndex) sendCmd({ cmd: 'screen', index: next.screenIndex });
    }
    push();
    res.json(fullState());
  });

  // ─── Feature switch, overlays, chat ────────────────────────────
  if (ctx.features) {
    ctx.features.register({
      id: 'chests',
      name: 'Fortnite chests',
      description: 'Counts the chests you open in Fortnite, live while you play and exactly from your replays, with OBS overlays and !chests.',
      page: 'chests',
      group: 'Features',
      get: () => !!S().enabled,
      set: (on) => {
        store.merge({ enabled: !!on });
        if (on) start();
        else stop();
        push();
      },
    });
  }
  const overlayInfo = 'Animated. Shows this match’s count live while you play, plus your average, best and (if you set one) your running total.';
  ctx.overlays.register({ id: 'chests-text', name: 'Chests opened (text)', path: '/overlay/chests?style=text', description: 'Just “Chests Opened: 1,234” in Fortnite’s font (Burbank Big Condensed, when it’s installed on this PC). The number ticks up as you loot.', width: 620, height: 100 });
  ctx.overlays.register({ id: 'chests', name: 'Chest counter', path: '/overlay/chests', description: overlayInfo, width: 400, height: 180 });
  ctx.overlays.register({ id: 'chests-total', name: 'Chest total', path: '/overlay/chests?style=total', description: 'Big animated running total of every chest you’ve opened (set your starting number on the Fortnite Chests page).', width: 460, height: 150 });
  ctx.overlays.register({ id: 'chests-pill', name: 'Chest counter — compact', path: '/overlay/chests?style=pill', description: 'A small animated badge with this match’s chests.', width: 300, height: 80 });

  ctx.twitch.registerCommand('chests', {
    description: 'How many chests the streamer has opened in Fortnite.',
    usage: '!chests',
    level: 'everyone',
    cooldown: 10,
    group: GROUP,
    handler: (msg) => {
      if (!S().enabled || !S().chatCommand) return false;
      const o = overlayData();
      const parts = [];
      if (o.live !== null) parts.push(`${o.live} chest${o.live === 1 ? '' : 's'} this match`);
      if (o.total !== null) parts.push(`${o.total.toLocaleString('en-US')} total`);
      if (o.matches) parts.push(`${o.avg.toFixed(1)} a match on average (best ${o.best})`);
      if (!parts.length) return ctx.twitch.reply(msg, 'No chests counted yet.');
      ctx.twitch.reply(msg, '🧰 ' + parts.join(' · '));
    },
  });

  ctx.onQuit(() => stop());
  if (S().enabled) start();

  // For tests
  return { state, runningTotal, overlayData, fullState, onEvent, store };
}

module.exports = { init };
