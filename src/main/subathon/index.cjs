'use strict';
// Subathon (from the standalone "Subathon Media Player") inside Steez.
// The engine (engine.cjs) does the work; this file wires it into Steez: the in-app page's API
// and websocket on the local server, the bot (actions, chat commands, AI tools), the OBS overlay
// list, the Windows "Fix TV connection" helper, and a one-time import of the standalone app's data.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createSubathon } = require('./engine.cjs');

/** Where people usually unzip the standalone app. Imported once, only if Steez has no subathon data yet. */
function findStandalone() {
  const home = os.homedir();
  const roots = [
    path.join(home, 'Downloads'),
    path.join(home, 'Desktop'),
    path.join(home, 'OneDrive', 'Desktop'),
    path.join(home, 'Documents'),
    path.join(home, 'OneDrive', 'Documents'),
    home,
  ];
  const names = ['SubathonMediaPlayer', 'Subathon Media Player', 'SubathonMediaPlayer-main', 'subathon-media-player'];
  for (const r of roots) {
    for (const n of names) {
      for (const dir of [path.join(r, n), path.join(r, n, n)]) {
        if (fs.existsSync(path.join(dir, 'data', 'db.json'))) return dir;
      }
    }
  }
  return null;
}

const fmtClock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    x = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
};
const fmtDur = (secs) => {
  const m = Math.round(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
};

/** Parse "10", "10m", "1h", "1h30m", "-15m", "90s" into minutes. */
function parseMinutes(input) {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  const sign = s.startsWith('-') ? -1 : 1;
  const body = s.replace(/^[+-]/, '');
  if (/^\d+(\.\d+)?$/.test(body)) return sign * Number(body);
  let total = 0,
    hit = false;
  for (const [, n, u] of body.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|seconds?)/g)) {
    hit = true;
    total += Number(n) * (u.startsWith('h') ? 60 : u.startsWith('s') ? 1 / 60 : 1);
  }
  return hit ? sign * total : null;
}

/** Runs the firewall/network fixer as administrator in a visible PowerShell window. */
function runFixTv(ctx, { port, code }) {
  if (process.platform !== 'win32') throw new Error('The TV connection fixer is for Windows.');
  // The script ships inside the app archive; PowerShell needs a real file.
  const src = path.join(__dirname, 'tools', 'fix-tv-connection.ps1');
  const dir = path.join(ctx.userData, 'subathon');
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, 'fix-tv-connection.ps1');
  fs.writeFileSync(script, fs.readFileSync(src));
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const enc = (s) => Buffer.from(s, 'utf16le').toString('base64');
  const inner = `& ${q(script)} -Port ${Number(port) || 3000} -Code ${q(code)} -AppPath ${q(process.execPath)}`;
  const outer = `Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -EncodedCommand ${enc(inner)}'`;
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc(outer)], { windowsHide: true, detached: true, stdio: 'ignore' });
  p.on('error', (e) => ctx.log.warn('Fix TV connection: ' + e.message));
  p.unref();
}

async function init(ctx) {
  const dataDir = path.join(ctx.userData, 'subathon');
  const sub = createSubathon({
    dataDir,
    log: ctx.log,
    twitchLogin: () => {
      const s = ctx.twitch.status();
      return s.login || s.channel || '';
    },
    keyOk: ctx.checkKey,
    onEnabledChange: () => ctx.features && ctx.features.changed && ctx.features.changed(),
    appPath: process.execPath,
    runFixTv: (o) => runFixTv(ctx, o),
    pickImport: async () => {
      const r = await ctx.dialog.showOpenDialog(ctx.getWindow(), {
        title: 'Pick the Subathon Media Player folder',
        properties: ['openDirectory'],
      });
      return r.canceled ? null : r.filePaths[0];
    },
  });

  if (ctx.features) {
    ctx.features.register({
      id: 'subathon',
      name: 'Subathon',
      description: 'Countdown timer that subs, bits, donations and TikTok gifts add time to, with the TV screen and viewer page.',
      page: 'subathon',
      group: 'Features',
      get: () => sub.isOn(),
      set: (on) => sub.setEnabled(on),
    });
  }

  // One-time import from the standalone app (timer, media and prices, goals, settings, TV code, password).
  if (!sub.store.existed && !ctx.importsDone().subathon) {
    const dir = findStandalone();
    if (dir) {
      try {
        sub.importFrom(dir);
        ctx.markImported('subathon');
      } catch (e) {
        ctx.log.warn('Subathon import failed: ' + e.message);
      }
    }
  }

  // In-app page: /subathon/api/* (+ /subathon/media) and /subathon/ws on the local server.
  ctx.server.router.use('/subathon', sub.appRouter);
  ctx.server.addUpgrade('/subathon/ws', sub.appWss);
  // OBS "wake-up menu" overlay: cycles through what viewers can trigger (incl. TikTok gifts).
  ctx.server.addUpgrade('/subathon/public-ws', sub.publicWss);
  ctx.server.router.get('/overlay/subathon-menu', (req, res) => res.sendFile(sub.overlayFile));

  ctx.overlays.register({
    id: 'subathon-menu',
    name: 'Wake-up menu',
    path: '/overlay/subathon-menu',
    description: 'Cycles through the sounds/videos viewers can trigger: icon, name, price, TikTok gift and description, a new one every few seconds. Style it under Subathon → Screens & links.',
    width: 640,
    height: 240,
  });
  // OBS: the TV screen works as a browser source (?obs=1 skips the "press OK" sound unlock).
  ctx.overlays.register({
    id: 'subathon-tv',
    name: 'Subathon screen',
    path: '/subathon',
    url: () => {
      const l = sub.lanState();
      return l.running ? `http://127.0.0.1:${l.boundPort}/tv/${sub.db.tvCode}?obs=1` : '';
    },
    description: 'Countdown, goals, chat, alerts and viewer-triggered media. Turn on the TV & viewer server in Subathon first.',
    width: 1920,
    height: 1080,
  });

  // TikTok gifts from the TikTok Gifts page connection.
  const busBot = ctx.twitch.bot;
  if (busBot && busBot.on) {
    busBot.on('tiktok:gift', (g) => {
      try {
        sub.handleTiktokGift(g);
      } catch (e) {
        ctx.log.warn('TikTok gift not understood: ' + e.message);
      }
    });
    busBot.on('tiktok:status', (st) => sub.setTiktokStatus(st));
    Promise.resolve()
      .then(() => busBot.runAction && busBot.runAction('queueup:tiktok'))
      .then((st) => st && sub.setTiktokStatus(st))
      .catch(() => {});
  }

  // Follow the Steez Twitch login when the subathon channel is left blank.
  let lastChannel = sub.effectiveChannel();
  ctx.twitch.onStatus(() => {
    const ch = sub.effectiveChannel();
    if (ch !== lastChannel) {
      lastChannel = ch;
      sub.applyConnections();
    }
  });

  // ─── Bot: actions (AI tools + other modules), chat commands ───
  const bot = ctx.twitch.bot;
  const stateForBot = () => {
    const db = sub.db;
    const t = sub.timerState();
    const s = db.settings;
    const goals = sub.goalsOut();
    return {
      timeLeft: fmtClock(t.remaining),
      running: t.running,
      ended: t.ended,
      timeAdded: fmtDur(db.stats.timeAdded),
      subs: db.stats.subs,
      bits: db.stats.bits,
      donations: `${s.currencySymbol}${db.stats.donations}`,
      multiplier: s.time.multiplier,
      perSub: fmtDur(s.time.tier1),
      per100Bits: fmtDur(s.time.per100Bits),
      perDonation: `${fmtDur(s.time.perDollar)} per ${s.currencySymbol}1`,
      cap: s.time.capHours ? `${s.time.capHours}h max` : 'no cap',
      goals: goals.map((g) => ({ title: g.title, metric: g.metric, current: g.current, target: g.target, done: !!(g.done || (g.target > 0 && g.current >= g.target)) })),
      media: db.media.filter((m) => m.enabled).map((m) => ({
        name: m.name,
        code: m.code ? s.triggerPrefix + m.code : '',
        prices: m.prices,
        tiktokGifts: (db.tiktokRules || []).filter((r) => r.enabled !== false && r.mediaId === m.id).map((r) => (r.minCount > 1 ? r.minCount + 'x ' : '') + r.gift),
      })),
      tiktokCoins: db.stats.tiktokCoins || 0,
    };
  };
  if (bot && bot.action) {
    bot.action('subathon:state', stateForBot);
    bot.action('subathon:timer', ({ action, minutes } = {}) => {
      if (!sub.isOn()) throw new Error('The subathon is turned off in Steez.');
      const mins = Number(minutes) || 0;
      if (action === 'add') {
        if (!mins) throw new Error('How many minutes?');
        sub.timerAction('add', mins * 60);
      } else if (action === 'set') {
        if (!(mins >= 0)) throw new Error('How many minutes should be left?');
        sub.timerAction('set', mins * 60);
      } else if (action === 'start' || action === 'pause' || action === 'reset') sub.timerAction(action);
      else throw new Error('Unknown timer action');
      const t = sub.timerState();
      return { ok: true, timeLeft: fmtClock(t.remaining), running: t.running };
    });
    bot.action('subathon:play', ({ name } = {}) => {
      if (!sub.isOn()) throw new Error('The subathon is turned off in Steez.');
      const m = sub.playMedia(String(name || ''));
      if (!m) throw new Error('No subathon media with that name.');
      return { ok: true, played: m.name, tvs: sub.statuses.tvs };
    });
    bot.action('subathon:event', (ev = {}) => sub.processEvent(ev) || { ok: true });
  }

  const GROUP = 'Subathon';
  ctx.twitch.registerCommand('subathon', {
    description: 'Time left on the subathon clock and the next goal.',
    usage: '!subathon',
    level: 'everyone',
    cooldown: 10,
    aliases: ['timeleft', 'clock'],
    group: GROUP,
    handler: (msg) => {
      if (!sub.isOn()) return false;
      const st = stateForBot();
      const next = st.goals.find((g) => !g.done);
      const state = st.ended ? 'The subathon is over — thank you!' : `${st.timeLeft} left on the subathon clock${st.running ? '' : ' (paused)'}`;
      const parts = [state, `${st.timeAdded} added so far`];
      if (st.multiplier && Number(st.multiplier) !== 1) parts.push(`${st.multiplier}x time right now`);
      if (next) parts.push(`next goal: ${next.title} (${next.current}/${next.target})`);
      ctx.twitch.reply(msg, parts.join(' · '));
    },
  });
  ctx.twitch.registerCommand('addtime', {
    description: 'Add (or remove with -) time on the subathon clock, e.g. !addtime 10m, !addtime -1h.',
    usage: '!addtime <10m | 1h | -15m>',
    level: 'moderator',
    cooldown: 2,
    group: GROUP,
    handler: (msg, args) => {
      if (!sub.isOn()) return false;
      const mins = parseMinutes(args.join(' '));
      if (!mins) return ctx.twitch.reply(msg, 'Usage: !addtime 10m (or 1h, -15m)');
      sub.timerAction('add', mins * 60);
      ctx.twitch.reply(msg, `${mins > 0 ? 'Added' : 'Removed'} ${fmtDur(Math.abs(mins) * 60)} — ${fmtClock(sub.timerState().remaining)} left.`);
    },
  });

  ctx.onQuit(() => sub.close());
  await sub.start();
  ctx.log.info(`Subathon ready${sub.lanState().running ? ` — TV & viewer server on port ${sub.lanState().boundPort}` : ''}`);
  return sub;
}

module.exports = { init, parseMinutes, findStandalone };
