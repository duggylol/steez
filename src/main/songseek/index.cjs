// SongSeek inside Steez — main-process side of song requests.
// Spotify is remote-controlled through the Web API; YouTube/SoundCloud play in the renderer
// (MusicEngine). This module owns settings, Spotify auth/control, search, the OBS overlay and
// the Twitch glue (chat commands + channel-point redemptions via the shared Twitch hub).
// Every IPC channel is prefixed `ss:`.
const fs = require('fs');
const path = require('path');
const account = require('./spotifyAccount.cjs');
const spotifySearch = require('./spotifySearch.cjs');
const search = require('./searchProxy.cjs');
const overlay = require('./overlay.cjs');
const { SpotifyControl } = require('./spotifyControl.cjs');
const { createYtdlp } = require('./ytdlp.cjs');

// Same keys as the standalone SongSeek's songseek.json, minus its theme and its own Twitch login
// (Steez owns the Twitch connection).
const DEFAULTS = {
  spotifySearchClientId: '', // built-in app id (bundled or imported)
  spotifySearchClientSecret: '', // only in private builds; never sent to the renderer
  spotifyUserClientId: '', // the user's own Spotify app (no allowlist)
  spotifyLibraryTokens: null,
  spotifyUser: null,
  setupComplete: false, // the first-run guide shows until this is true
  rewardName: 'Song Request',
  allowSpotify: true,
  allowYoutube: true,
  allowSoundcloud: true,
  chatCommandEnabled: true,
  chatCommand: '!sr', // a custom SongSeek trigger becomes an extra alias of !sr
  chatAnnounce: true,
  modCommandsEnabled: true,
  volume: 0.8,
  queue: [], // pending requests (survive restarts)
};

const NOT_IMPORTED = new Set(['twitchTokens', 'twitchUser', 'twitchClientId', 'theme']);
const PRIVATE_KEYS = ['spotifyLibraryTokens', 'spotifySearchClientSecret']; // never cross IPC

const GROUP = 'Song requests';

async function init(ctx) {
  const store = ctx.createStore('songseek', DEFAULTS);
  importFromSongSeek(ctx, store);
  const bundled = applyBundledKeys(ctx, store);

  // Anyone already connected has clearly finished setup.
  if (!store.get('setupComplete') && store.get('spotifyLibraryTokens')) store.set('setupComplete', true);

  const ytdlp = createYtdlp(ctx.resourcesPath);
  const send = ctx.send;
  const openExternal = (url) => ctx.shell.openExternal(url);

  // ─── Spotify playback control ───────────────────────────────────
  let control = null;
  const spotifyStatus = () => account.status(store);
  const initControl = () => {
    if (control) return control;
    control = new SpotifyControl(store);
    control.on('state', (s) => send('ss:spotify:state', s));
    control.on('queue', (q) => send('ss:spotify:queue', q));
    control.start();
    return control;
  };
  if (store.get('spotifyLibraryTokens')) initControl();

  // ─── Twitch (shared hub) ────────────────────────────────────────
  const twitchStatus = () => {
    const s = ctx.twitch.status() || {};
    return {
      connected: !!(s.loggedIn && s.connected),
      loggedIn: !!s.loggedIn,
      chat: !!s.connected,
      eventsub: !!s.eventsub,
      expired: !!s.expired,
      user: s.login ? { login: s.login, id: s.userId } : null,
    };
  };
  ctx.twitch.onStatus(() => send('ss:twitch:status', twitchStatus()));
  registerChatCommands(ctx, store);
  ctx.twitch.onRedemption((e) => {
    const want = String(store.get('rewardName') || '').trim().toLowerCase();
    const got = String(e.reward || '').trim().toLowerCase();
    if (want && got !== want) return;
    send('ss:twitch:request', { user: e.user, input: e.input || '', via: 'redeem', reward: e.reward });
  });

  // `$(song)` in custom bot commands reads the current track from here.
  const bot = ctx.twitch.bot;
  if (bot && !bot.songs) bot.songs = { current: () => overlay.current() };

  // ─── Overlay ────────────────────────────────────────────────────
  overlay.mount(ctx.server.router);
  const overlayFile = overlay.writeOverlayFile(ctx.userData);
  ctx.overlays.register({
    id: 'nowplaying',
    name: 'Now playing',
    path: '/overlay',
    description: 'Song card that slides in on every new song and on !song. Same URL as the standalone SongSeek.',
    width: 800,
    height: 160,
  });

  ctx.onQuit(() => {
    if (control) control.stop();
    overlay.closeAll();
    store.flush();
  });

  // ─── IPC ────────────────────────────────────────────────────────
  const handle = (channel, fn) => ctx.ipcMain.handle(channel, (_e, ...args) => fn(...args));
  const rendererSettings = () => {
    const d = store.all();
    for (const k of PRIVATE_KEYS) delete d[k];
    d._bundled = { spotifySearch: bundled.search, spotifyApp: !!store.get('spotifySearchClientId') };
    return d;
  };

  handle('ss:settings:get', () => rendererSettings());
  handle('ss:settings:set', (patch) => {
    const clean = { ...(patch || {}) };
    for (const k of [...PRIVATE_KEYS, '_bundled', 'spotifyUser']) delete clean[k];
    store.merge(clean);
    return rendererSettings();
  });

  handle('ss:spotify:connect', async () => {
    await account.connect(store, openExternal);
    initControl().refresh();
    send('ss:spotify:status', spotifyStatus());
    return spotifyStatus();
  });
  handle('ss:spotify:disconnect', () => {
    if (control) control.stop();
    control = null;
    account.disconnect(store);
    send('ss:spotify:status', spotifyStatus());
    return spotifyStatus();
  });
  handle('ss:spotify:status', () => spotifyStatus());
  handle('ss:spotify:addToQueue', (uri) => initControl().addToQueue(String(uri)));
  handle('ss:spotify:next', () => initControl().next());
  handle('ss:spotify:previous', () => initControl().previous());
  handle('ss:spotify:pause', () => initControl().pause());
  handle('ss:spotify:resume', () => initControl().play());
  handle('ss:spotify:seek', (ms) => initControl().seek(Number(ms) || 0));
  handle('ss:spotify:setVolume', (pct) => initControl().setVolume(Number(pct) || 0));
  handle('ss:spotify:playContext', (opts) => initControl().playContext(opts || {}));
  handle('ss:spotify:devices', () => initControl().devices());
  handle('ss:spotify:transfer', (id) => initControl().transferTo(String(id)));
  handle('ss:spotify:refresh', () => {
    if (store.get('spotifyLibraryTokens')) initControl().refresh();
  });
  handle('ss:spotify:diagnose', () => diagnose(store));

  handle('ss:library:status', () => account.status(store));
  handle('ss:library:playlists', () => account.playlists(store));
  handle('ss:library:tracks', (id) => account.playlistTracks(store, String(id)));

  handle('ss:search:spotify', (q, limit) => spotifySearch.search(store, q, limit));
  handle('ss:search:youtube', (q) => search.youtubeSearch(q));
  handle('ss:search:soundcloud', (q) => search.soundcloudSearch(q));
  handle('ss:resolve:spotify', (id) => spotifySearch.getTrack(store, String(id)));
  handle('ss:resolve:youtube', (id) => search.youtubeResolve(String(id)));
  handle('ss:resolve:youtubeStream', (id) => ytdlp.resolveStream(id));
  handle('ss:resolve:soundcloud', (url) => search.soundcloudResolve(String(url)));

  handle('ss:overlay:update', (track) => overlay.setTrack(track));
  handle('ss:overlay:show', () => overlay.replay());
  handle('ss:overlay:hide', () => overlay.hide());

  handle('ss:twitch:status', () => twitchStatus());
  handle('ss:twitch:say', (text) => ctx.twitch.say(String(text || '').replace(/[\r\n]+/g, ' ').slice(0, 450)));

  handle('ss:app:info', () => ({
    version: ctx.app.getVersion(),
    overlayUrl: ctx.server.port ? ctx.server.url('/overlay') : null,
    overlayFile,
    // True when Steez lost 43112 — existing OBS URL sources point at the old port.
    overlayPortMoved: !!ctx.server.port && ctx.server.port !== 43112,
    redirectUri: account.REDIRECT_URI,
    ytdlp: fs.existsSync(ytdlp.bin),
  }));
}

/**
 * One-time carry-over from the standalone SongSeek: Spotify login, own Spotify app, reward name,
 * toggles, volume and pending queue. Twitch login/app and theme are skipped (Steez owns Twitch).
 * Only fills keys that are still at their defaults, so it can never clobber Steez settings.
 */
function importFromSongSeek(ctx, store) {
  const src = ctx.imports && ctx.imports.songseek;
  if (ctx.importsDone().songseek || !src || !src.data) return;
  const patch = {};
  for (const [key, value] of Object.entries(src.data)) {
    if (NOT_IMPORTED.has(key) || value === undefined) continue;
    const cur = store.get(key);
    const isDefault = cur === undefined || JSON.stringify(cur) === JSON.stringify(DEFAULTS[key]);
    if (isDefault) patch[key] = value;
  }
  if (patch.spotifyLibraryTokens) patch.setupComplete = true;
  store.merge(patch);
  store.flush();
  ctx.markImported('songseek');
  // Key names only — never values.
  ctx.log.info(
    `Imported SongSeek settings (${Object.keys(patch).length} values${patch.spotifyLibraryTokens ? ', Spotify login' : ''}${
      Array.isArray(patch.queue) && patch.queue.length ? `, ${patch.queue.length} queued requests` : ''
    }).`,
  );
}

/**
 * Optional built-in Spotify app from Steez's app-config.json ({ spotifyClientId, spotifyClientSecret }).
 * Fills only empty values: an imported login was issued to the imported app id, and refreshing it
 * with a different id would fail.
 */
function applyBundledKeys(ctx, store) {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(ctx.appRoot, 'app-config.json'), 'utf8'));
  } catch {
    /* no bundled config */
  }
  const patch = {};
  if (cfg.spotifyClientId && !store.get('spotifySearchClientId')) patch.spotifySearchClientId = cfg.spotifyClientId;
  if (cfg.spotifyClientSecret && !store.get('spotifySearchClientSecret')) patch.spotifySearchClientSecret = cfg.spotifyClientSecret;
  if (Object.keys(patch).length) store.merge(patch);
  return { search: !!(store.get('spotifySearchClientId') && store.get('spotifySearchClientSecret')) };
}

/**
 * Chat commands go through the bot's command system (permissions, cooldowns, aliases and
 * enable/disable are managed on the Commands page). The renderer does the actual work.
 */
function registerChatCommands(ctx, store) {
  const send = ctx.send;
  const forward = (cmd) => (msg) => {
    if (!store.get('modCommandsEnabled')) return false;
    send('ss:twitch:command', { cmd, user: msg.display, isMod: !!(msg.isMod || msg.isBroadcaster) });
  };

  // A custom trigger from SongSeek (e.g. "!request") becomes an extra alias of !sr.
  const legacy = String(store.get('chatCommand') || '').trim().replace(/^!/, '').toLowerCase();
  const srAliases = ['songrequest', ...(legacy && !['sr', 'songrequest'].includes(legacy) && /^\w+$/.test(legacy) ? [legacy] : [])];

  ctx.twitch.registerCommand('sr', {
    description: 'Request a song (Spotify, YouTube or SoundCloud — name or link)',
    usage: '!sr <song name or link>',
    level: 'everyone',
    aliases: srAliases,
    group: GROUP,
    handler: (msg, args) => {
      if (!store.get('chatCommandEnabled')) return false;
      send('ss:twitch:request', { user: msg.display, input: args.join(' ').trim(), via: 'chat' });
    },
  });
  ctx.twitch.registerCommand('song', {
    description: 'Show the song that is playing now',
    usage: '!song',
    level: 'everyone',
    cooldown: 5,
    aliases: ['currentsong', 'np'],
    group: GROUP,
    handler: forward('song'),
  });
  const mod = [
    ['skip', 'Skip the current song', 'skip', []],
    ['pause', 'Pause playback', 'pause', []],
    ['play', 'Resume playback', 'resume', ['resume']],
    ['clearqueue', 'Clear pending song requests', 'clearqueue', []],
  ];
  for (const [name, description, cmd, aliases] of mod) {
    ctx.twitch.registerCommand(name, { description, usage: `!${name}`, level: 'moderator', cooldown: 3, aliases, group: GROUP, handler: forward(cmd) });
  }
}

/** Plain-English connection self-test — turns "it doesn't work" into a reason. */
async function diagnose(store) {
  const lines = [];
  const usingOwn = !!(store.get('spotifyUserClientId') || '').trim();
  lines.push(`Spotify app in use: ${usingOwn ? 'your own Client ID' : 'the built-in one'}`);
  if (!store.get('spotifyLibraryTokens')) {
    lines.push('✗ Not logged in — click "Connect Spotify".');
    return lines.join('\n');
  }
  lines.push(account.hasPlayerScopes(store) ? '✓ Playback permissions granted' : '✗ Missing playback permissions — click "Reconnect".');
  try {
    const me = await account.request(store, 'GET', '/me');
    lines.push(`✓ Spotify accepted the login (account: ${me.display_name || me.id})`);
  } catch (e) {
    lines.push(`✗ Spotify rejected the account: ${e.message}`);
    if (e.code === 'FORBIDDEN') {
      lines.push("   This usually means the account is not on the built-in app's approved list.", '   Fix: use your own Spotify app (below).');
    }
    return lines.join('\n');
  }
  try {
    const p = await account.request(store, 'GET', '/me/player');
    if (!p) lines.push('• Spotify is connected but idle — press play in Spotify and test again.');
    else lines.push(`✓ Sees playback: ${(p.item && p.item.name) || 'nothing'} on ${(p.device && p.device.name) || 'unknown device'}`);
  } catch (e) {
    lines.push(`✗ Can't read playback: ${e.message}`);
  }
  return lines.join('\n');
}

module.exports = { init };
