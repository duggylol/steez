'use strict';
// QueueUp inside Steez: the viewer queue (party + queue filled from Twitch chat) and the
// TikTok LIVE gift tracker, each with an OBS overlay. All state lives here in the main
// process; the renderer talks to it through `window.hq` (see preload.cjs) over qu:* IPC.
//
// Steez provides the window, the updater, the local server and the one Twitch connection,
// so none of the standalone app's equivalents are carried over.
const fs = require('fs');
const path = require('path');
const { Store, formatQueueMessage, importLegacyState, writeJsonAtomic } = require('./state.cjs');
const { createGiftTracker } = require('./gifts.cjs');
const { TikTokLive } = require('./tiktok.cjs');
const { createAvatarService } = require('./avatars.cjs');
const { createTiktokStats, createSampleLogger } = require('./tiktokStats.cjs');
const { mountOverlays } = require('./server.cjs');
const widgetStyles = require('./widgetStyles.cjs');

const STATE_FILE = 'queueup-state.json';
const AVATARS_FILE = 'queueup-avatars.json';
const RANK_SAMPLES_FILE = 'tiktok-rank-samples.log';
const LIST_COOLDOWN_MS = 8000; // one !queue post every 8s at most, so it can't flood chat
const LOG_LIMIT = 300;

const OVERLAY_PATHS = { queue: '/overlay/queue', gifts: '/overlay/gifts', tiktokRank: '/overlay/tiktok-rank', tiktokGallery: '/overlay/tiktok-gallery' };

/**
 * One-time import from the standalone QueueUp app: queue, party, rules and both overlay
 * styles plus the gift session and the avatar cache. Twitch credentials, channel, port
 * and updater settings stay behind (see LEGACY_SETTINGS in state.cjs).
 */
function importFromQueueUp(ctx, stateFile, avatarsFile) {
  const legacy = ctx.imports && ctx.imports.queueup;
  if (!legacy || !legacy.data || ctx.importsDone().queueup || fs.existsSync(stateFile)) return false;
  try {
    const data = importLegacyState(legacy.data);
    writeJsonAtomic(stateFile, data);
    if (legacy.avatarsFile && fs.existsSync(legacy.avatarsFile) && !fs.existsSync(avatarsFile)) {
      fs.copyFileSync(legacy.avatarsFile, avatarsFile);
    }
    ctx.markImported('queueup');
    ctx.log.info(`Imported QueueUp: ${data.queue.length} queued, ${data.party.length} in the party, overlay styles and gift session.`);
    return true;
  } catch (err) {
    ctx.log.warn('QueueUp import failed: ' + err.message);
    return false;
  }
}

function normCmd(s) {
  return String(s || '').trim().toLowerCase();
}

async function init(ctx) {
  const stateFile = path.join(ctx.userData, STATE_FILE);
  const avatarsFile = path.join(ctx.userData, AVATARS_FILE);
  importFromQueueUp(ctx, stateFile, avatarsFile);

  const store = new Store(stateFile);
  const logs = [];
  const send = (channel, payload) => ctx.send(channel, payload);

  function pushLog(entry) {
    const item = { ts: Date.now(), type: entry.type || 'info', text: String(entry.text || '') };
    logs.push(item);
    if (logs.length > LOG_LIMIT) logs.shift();
    send('qu:log', item);
    if (item.type === 'error') ctx.log.error(item.text);
    else if (item.type === 'warn') ctx.log.warn(item.text);
  }

  /* ----------------------------- avatars ----------------------------- */

  const avatars = createAvatarService({
    cacheFile: avatarsFile,
    getAuth: () => ctx.twitch.getAuth(),
    onLog: pushLog,
  });
  let avatarTimer = null;

  /**
   * Fills in profile pictures for everyone listed. Debounced because queue changes arrive
   * in bursts (a raid, Fill Party), and cached, so it settles to zero network traffic.
   */
  function syncAvatars(delay = 250) {
    clearTimeout(avatarTimer);
    avatarTimer = setTimeout(async () => {
      try {
        if (await avatars.apply([store.data.party, store.data.queue])) store.changed('avatars');
      } catch (err) {
        ctx.log.warn('avatar sync failed: ' + err.message);
      }
    }, delay);
  }

  function withCachedAvatar(entry) {
    const cached = avatars.get(entry.login);
    if (cached) entry.avatar = cached;
  }

  /* ------------------------- gifts + tiktok -------------------------- */

  let overlays = null;
  const gifts = createGiftTracker({
    onChange: (_state, reason) => {
      send('qu:gifts', { gifts: gifts.snapshot(), reason });
      if (overlays) overlays.pushGifts(reason);
      // Combos change many times a second; only settle to disk on real events.
      if (reason !== 'streak') store.saveGifts(gifts.serialize());
    },
  });
  gifts.load(store.data.gifts);

  // Daily gaming rank + Gift Gallery. Last-known values persist so the badges show
  // something sensible straight after a restart.
  const stats = createTiktokStats({
    onChange: (reason) => {
      send('qu:tiktokStats', { tiktokStats: stats.snapshot(), reason });
      if (overlays) overlays.pushStats(reason);
      store.saveTiktokStats(stats.serialize());
    },
  });
  stats.load(store.data.tiktokStats);

  // These payloads haven't been seen live yet: keep the first few of each per LIVE.
  const samples = createSampleLogger({
    file: path.join(ctx.userData, RANK_SAMPLES_FILE),
    onError: (err) => ctx.log.warn('rank sample log failed: ' + err.message),
  });
  let sampledRoom = null;

  const tiktok = new TikTokLive();
  tiktok.on('gift', (g) => {
    gifts.handleGift(g);
    stats.handleGift(g);
  });
  const statsEvent = (name, fn) =>
    tiktok.on(name, (d) => {
      samples.log(name, d);
      try {
        fn(d);
      } catch (err) {
        ctx.log.warn(`TikTok ${name} not understood: ${err.message}`);
      }
    });
  statsEvent('rankUpdate', (d) => stats.handleRankUpdate(d));
  statsEvent('gameRankNotify', (d) => stats.handleGameRankNotify(d));
  statsEvent('giftPanelUpdate', (d) => stats.handleGiftPanel(d));
  tiktok.on('status', (st) => {
    send('qu:tiktok', st);
    if (overlays) overlays.pushGifts('tiktok');
    if (st.status === 'live' && st.roomId !== sampledRoom) {
      sampledRoom = st.roomId;
      samples.reset();
    }
  });
  tiktok.on('viewers', () => send('qu:tiktok', tiktok.state));
  tiktok.on('log', pushLog);

  /* ----------------------------- overlays ---------------------------- */

  overlays = mountOverlays({
    router: ctx.server.router,
    addUpgrade: (p, wss) => ctx.server.addUpgrade(p, wss),
    store,
    getGifts: () => ({ ...gifts.snapshot(), tiktok: tiktok.state }),
    getStats: () => stats.snapshot(),
    onLog: pushLog,
  });
  ctx.overlays.register({
    id: 'queue',
    name: 'Viewer queue',
    path: OVERLAY_PATHS.queue,
    description: 'Who is up next: live queue with wait timers, avatars and sub badges.',
    width: 460,
    height: 470,
  });
  ctx.overlays.register({
    id: 'gifts',
    name: 'TikTok gifts',
    path: OVERLAY_PATHS.gifts,
    description: 'Top TikTok gifter and biggest gift streak, with live combos.',
    width: 444,
    height: 440,
  });
  ctx.overlays.register({
    id: 'tiktok-rank',
    name: 'TikTok gaming rank',
    path: OVERLAY_PATHS.tiktokRank,
    description: "Compact badge with today's TikTok LIVE gaming rank.",
    width: 260,
    height: 110,
  });
  ctx.overlays.register({
    id: 'tiktok-gallery',
    name: 'TikTok Gift Gallery',
    path: OVERLAY_PATHS.tiktokGallery,
    description: 'Compact badge with Gift Gallery progress, e.g. 3/25.',
    width: 260,
    height: 110,
  });

  store.on('change', (reason) => {
    overlays.pushState();
    send('qu:state', { ...store.snapshot(), reason });
    // A queue that gained people may have gained faces to look up.
    if (reason === 'add' || reason === 'move' || reason === 'fill' || reason === 'next') syncAvatars();
  });

  /* ------------------------------ chat ------------------------------- */

  let lastListAt = 0;

  /** Chat replies go out through the shared bot account, and only when enabled. */
  function reply(message) {
    if (!store.data.settings.botReplies) return;
    ctx.twitch.say(message);
  }

  function handleChatMessage(msg) {
    const s = store.data.settings;
    const text = String(msg.text || '').trim();
    const first = normCmd(text.split(/\s+/)[0]);
    if (!first.startsWith('!')) return;

    const join = normCmd(s.joinCommand) || '!join';
    const leave = normCmd(s.leaveCommand) || '!dequeue';
    const list = normCmd(s.listCommand) || '!queue';

    if (first === list) {
      if (Date.now() - lastListAt < LIST_COOLDOWN_MS) return;
      lastListAt = Date.now();
      if (!s.botReplies) {
        pushLog({ type: 'warn', text: `${msg.display} used ${list} — turn on "Reply in chat" under Rules to post the queue.` });
        return;
      }
      if (!ctx.twitch.say(formatQueueMessage(store.data.queue, s.joinCommand))) {
        pushLog({ type: 'warn', text: `Couldn't post the queue — Twitch chat isn't connected.` });
      }
      return;
    }

    if (first === join) {
      if (!s.queueOpen) {
        reply(`@${msg.display} the queue is closed right now.`);
        return;
      }
      const res = store.addUser(msg, { source: 'chat' });
      if (res.ok) {
        withCachedAvatar(res.entry);
        syncAvatars(0);
        pushLog({ type: 'join', text: `${msg.display} joined the queue (#${res.position})` });
        reply(`@${msg.display} you've been added to the queue — you're #${res.position}.`);
      } else if (res.reason === 'already') {
        reply(`@${msg.display} you're already in the queue at #${res.position}.`);
      } else if (res.reason === 'in_party') {
        reply(`@${msg.display} you're already in the party!`);
      }
      return;
    }

    if (first === leave) {
      const res = store.removeByLogin(msg.login);
      if (res.ok) {
        pushLog({ type: 'leave', text: `${msg.display} left the queue` });
        reply(`@${msg.display} you've been removed from the queue.`);
      } else {
        reply(`@${msg.display} you're not in the queue.`);
      }
    }
  }

  const offChat = ctx.twitch.onChat((msg) => {
    try {
      handleChatMessage(msg);
    } catch (err) {
      ctx.log.error('chat handler failed: ' + err.message);
    }
  });

  let wasConnected = false;
  let wasLoggedIn = false;
  function onTwitchStatus(st) {
    send('qu:twitch', st);
    if (!st) return;
    if (st.connected && !wasConnected && st.channel) pushLog({ type: 'info', text: `Watching #${st.channel} for ${store.data.settings.joinCommand || '!join'}` });
    if (!st.connected && wasConnected) pushLog({ type: 'warn', text: 'Twitch chat disconnected.' });
    // A fresh login can authenticate the avatar lookups — backfill every face.
    if (st.loggedIn && !wasLoggedIn) syncAvatars(0);
    wasConnected = !!st.connected;
    wasLoggedIn = !!st.loggedIn;
  }
  const offStatus = ctx.twitch.onStatus(onTwitchStatus);
  try {
    const st = ctx.twitch.status();
    wasConnected = !!(st && st.connected);
    wasLoggedIn = !!(st && st.loggedIn);
  } catch (_) {
    /* status is best-effort at boot */
  }

  /* ------------------------------- IPC ------------------------------- */

  function fullState() {
    let twitch = null;
    try {
      twitch = ctx.twitch.status();
    } catch (_) {
      /* not ready */
    }
    return {
      ...store.snapshot(),
      tiktok: tiktok.state,
      gifts: gifts.snapshot(),
      tiktokStats: stats.snapshot(),
      twitch,
      overlayClients: overlays.clientCount,
      overlayPaths: OVERLAY_PATHS,
      widgetKit: widgetStyles.kitInfo(),
      baseUrl: ctx.server.port ? ctx.server.url('') : '',
    };
  }

  const handle = (channel, fn) => ctx.ipcMain.handle(channel, (_e, arg) => fn(arg));

  handle('qu:getState', () => fullState());
  handle('qu:getLogs', () => logs);

  handle('qu:queue:add', (name) => {
    const login = String(name || '').trim().replace(/^@/, '');
    if (!login) return { ok: false, reason: 'invalid' };
    const res = store.addUser({ login, display: login }, { source: 'manual' });
    if (res.ok) {
      withCachedAvatar(res.entry);
      syncAvatars(0);
      pushLog({ type: 'join', text: `${login} added manually (#${res.position})` });
    }
    // The entry object is live state; hand back a copy over IPC.
    return { ok: res.ok, reason: res.reason, position: res.position };
  });
  handle('qu:queue:remove', (id) => store.removeById(id));
  handle('qu:queue:move', ({ id, list, index } = {}) => store.move(id, list, index));
  handle('qu:queue:promote', (id) => store.promote(id));
  handle('qu:queue:toTop', (id) => store.toTop(id));
  handle('qu:queue:clear', (which) => {
    store.clear(which);
    return true;
  });
  handle('qu:queue:fill', () => store.fillParty());
  handle('qu:queue:next', () => store.nextGame());

  // Remote control for the Steez Mod Panel (runs through the bot's action registry).
  const botActions = ctx.twitch.bot;
  if (botActions?.action) {
    const lite = (e) => ({ id: e.id, login: e.login, display: e.display || e.name || e.login, isSub: !!e.isSub });
    botActions.action('queueup:state', () => {
      const s = store.snapshot();
      return { open: s.settings.queueOpen !== false, party: (s.party || []).map(lite), queue: (s.queue || []).map(lite), partySize: s.settings.partySize };
    });
    botActions.action('queueup:next', () => store.nextGame());
    botActions.action('queueup:remove', ({ id } = {}) => store.removeById(id));
    botActions.action('queueup:open', ({ open } = {}) => store.updateSettings({ queueOpen: !!open }));
  }

  handle('qu:settings:update', (patch) => {
    const clean = { ...(patch || {}) };
    if ('partySize' in clean) clean.partySize = Math.min(20, Math.max(1, parseInt(clean.partySize, 10) || 1));
    return store.updateSettings(clean);
  });

  handle('qu:overlay:update', (patch) => store.updateOverlay(patch || {}));
  handle('qu:overlay:reset', () => store.resetOverlay());

  handle('qu:giftOverlay:update', (patch) => {
    const next = store.updateGiftOverlay(patch || {});
    overlays.pushGifts('overlay');
    return next;
  });
  handle('qu:giftOverlay:reset', () => {
    const next = store.resetGiftOverlay();
    overlays.pushGifts('overlay');
    return next;
  });

  handle('qu:tiktok:connect', (username) => {
    const clean = TikTokLive.cleanUsername(username || store.data.settings.tiktokUsername);
    if (!clean) return { ok: false, reason: 'no_username' };
    store.updateSettings({ tiktokUsername: clean });
    tiktok.start(clean);
    return { ok: true, username: clean, state: tiktok.state };
  });
  handle('qu:tiktok:disconnect', () => {
    tiktok.stop();
    return tiktok.state;
  });

  handle('qu:gifts:reset', () => {
    gifts.reset();
    store.saveGifts(null);
    return gifts.snapshot();
  });
  let stopDemo = null;
  handle('qu:gifts:simulate', () => {
    if (stopDemo) stopDemo();
    stopDemo = simulateGifts(gifts);
    return { ok: true };
  });

  handle('qu:tiktokStats:manual', (patch) => {
    stats.setManual(patch || {});
    return stats.snapshot();
  });
  handle('qu:tiktokStats:style', (patch) => {
    stats.setStyle(patch || {});
    return stats.snapshot();
  });
  handle('qu:tiktokStats:resetStyle', () => {
    stats.resetStyle();
    return stats.snapshot();
  });
  // One style API for all three TikTok widgets: 'gifts', 'rank' and 'gallery'.
  // Each returns the widget's new style; the overlays are pushed the change live.
  function widgetStyle(widget) {
    if (widget === 'gifts') return store.data.giftOverlay;
    const snap = stats.snapshot();
    return widget === 'gallery' ? snap.galleryStyle : snap.style;
  }
  function editWidget(widget, fn) {
    if (!widgetStyles.isWidget(widget)) return null;
    if (widget === 'gifts') {
      fn.gifts();
      overlays.pushGifts('overlay');
    } else {
      fn.stats(widget);
    }
    return widgetStyle(widget);
  }
  handle('qu:widgetStyle:update', ({ widget, patch } = {}) =>
    editWidget(widget, { gifts: () => store.updateGiftOverlay(patch || {}), stats: (w) => stats.setStyle(patch || {}, w) }),
  );
  handle('qu:widgetStyle:preset', ({ widget, preset } = {}) =>
    editWidget(widget, { gifts: () => store.applyGiftPreset(preset), stats: (w) => stats.applyPreset(w, preset) }),
  );
  handle('qu:widgetStyle:reset', ({ widget } = {}) =>
    editWidget(widget, { gifts: () => store.resetGiftOverlay(), stats: (w) => stats.resetStyle(w) }),
  );
  /** Puts all three widgets on one preset so they match. */
  handle('qu:widgetStyle:matchAll', ({ preset } = {}) => {
    if (!widgetStyles.isPreset(preset)) return null;
    const out = {};
    for (const w of widgetStyles.WIDGETS) {
      out[w] = editWidget(w, { gifts: () => store.applyGiftPreset(preset), stats: (x) => stats.applyPreset(x, preset) });
    }
    return out;
  });

  handle('qu:tiktokStats:reset', () => {
    stats.reset();
    return stats.snapshot();
  });

  handle('qu:util:copy', (text) => {
    ctx.clipboard.writeText(String(text || ''));
    return true;
  });
  handle('qu:util:openExternal', (url) => {
    if (/^https?:\/\//i.test(String(url))) ctx.shell.openExternal(String(url));
    return true;
  });
  handle('qu:util:confirm', async ({ title, message, confirmLabel } = {}) => {
    const opts = {
      type: 'warning',
      buttons: [confirmLabel || 'Confirm', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: title || 'Are you sure?',
      message: title || 'Are you sure?',
      detail: message || '',
    };
    const win = ctx.getWindow();
    const res = win ? await ctx.dialog.showMessageBox(win, opts) : await ctx.dialog.showMessageBox(opts);
    return res.response === 0;
  });

  /* ------------------------------ boot ------------------------------- */

  const tiktokBoot = setTimeout(() => {
    const s = store.data.settings;
    if (s.tiktokAutoConnect && s.tiktokUsername) tiktok.start(s.tiktokUsername);
  }, 1200);
  syncAvatars(1200);

  // The queue is the user's data - it must survive every way out of the app. Saves are
  // debounced, so anything from the last quarter second would otherwise be lost.
  let closed = false;
  function shutdown() {
    if (closed) return;
    closed = true;
    clearTimeout(tiktokBoot);
    clearTimeout(avatarTimer);
    if (stopDemo) stopDemo();
    store.saveGifts(gifts.serialize());
    store.saveTiktokStats(stats.serialize());
    tiktok.stop(true);
    store.flush();
    overlays.close();
    offChat && offChat();
    offStatus && offStatus();
  }
  ctx.onQuit(shutdown);

  // Returned for tests; Steez itself only awaits init().
  return { store, gifts, stats, tiktok, avatars, overlays, logs, fullState, handleChatMessage, shutdown };
}

/**
 * A short fake gift session so the overlay can be styled without being live.
 * Returns a function that cancels whatever is still to come.
 */
function simulateGifts(gifts) {
  const timers = new Set();
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };
  const demo = [
    { login: 'beststreamerever', name: 'BestStreamerEver', diamonds: 1, gift: 'Rose', id: '5655', type: 1, count: 12 },
    { login: 'rhysszn', name: 'rhysszn', diamonds: 5, gift: 'Finger Heart', id: '5487', type: 1, count: 7 },
    { login: 'lovediddyo', name: 'lovediddyo', diamonds: 99, gift: 'Hand Hearts', id: '6096', type: 1, count: 3 },
    { login: 'jeffunderdog', name: 'jeffunderdog', diamonds: 500, gift: 'Galaxy', id: '7122', type: 0, count: 1 },
  ];
  const base = 'https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/';
  let i = 0;
  const step = () => {
    const d = demo[i % demo.length];
    const evt = {
      login: d.login,
      name: d.name,
      avatar: '',
      userId: '',
      giftId: d.id,
      giftName: d.gift,
      giftImage: base + 'gift_' + d.id + '.png~tplv-obj.webp',
      diamonds: d.diamonds,
      giftType: d.type,
      repeatCount: 1,
      repeatEnd: false,
      at: Date.now(),
    };
    if (d.type === 1) {
      for (let n = 1; n <= d.count; n++) {
        later(() => gifts.handleGift({ ...evt, repeatCount: n, repeatEnd: n >= d.count }), n * 260);
      }
    } else {
      gifts.handleGift({ ...evt, repeatEnd: true });
    }
    i++;
    if (i < demo.length) later(step, d.count * 260 + 900);
  };
  step();
  return () => {
    timers.forEach(clearTimeout);
    timers.clear();
  };
}

module.exports = { init, importFromQueueUp, OVERLAY_PATHS };
