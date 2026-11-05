// Steez — main process.
// Launch sequence: splash (animation + update check) → core services (bot, local server,
// feature modules) → main window fades in.
import { app, BrowserWindow, ipcMain, shell, clipboard, dialog } from 'electron';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createStore } from './store.js';
import { runBootUpdate, createBackgroundUpdater, updateLog } from './updater.js';
import { findSongSeek, findQueueUp, describeImports } from './importer.js';

const require = createRequire(import.meta.url);
// Testing: run with a throwaway profile, and optionally save screenshots of every page.
if (process.env.STEEZ_USER_DATA) app.setPath('userData', process.env.STEEZ_USER_DATA);
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const DEV = process.env.STEEZ_DEV === '1';
const API_KEY = crypto.randomBytes(24).toString('hex'); // per-launch secret for the local API

/** Feature modules (CommonJS) living in src/main/<name>/index.cjs */
const FEATURE_MODULES = ['songseek', 'queueup'];

let win = null;
let splash = null;
let booting = true;
let server = null;
let steez = null; // app settings store
let updater = null;
let twitchHub = null;
let log = console;
const overlays = [];
const quitHooks = [];

const send = (channel, payload) => {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readAppConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'app-config.json'), 'utf8'));
  } catch {
    return {};
  }
}

// The Steez Twitch application (public client, redirect http://localhost:43111). A Client ID is
// a public identifier, not a secret — it appears in every Twitch login URL.
const BUILTIN_TWITCH_CLIENT_ID = 'ozc63b300yxoa4w6vwygci39njppml';
// SteezBot relay (relay/ — Cloudflare Worker). Empty until deployed with `npm run relay:setup`.
const BUILTIN_RELAY_URL = 'https://steez-relay.steezbot.workers.dev';
const twitchClientId = () => steez?.get('twitchClientId') || readAppConfig().twitchClientId || BUILTIN_TWITCH_CLIENT_ID;

// ─── Splash ─────────────────────────────────────────────────────
function createSplash() {
  const w = new BrowserWindow({
    width: 440,
    height: 250,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    backgroundColor: '#141414',
    title: 'Steez',
    icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  w.removeMenu();
  w.loadFile(path.join(here, 'splash.html'));
  w.once('ready-to-show', () => {
    if (w.isDestroyed()) return;
    w.show();
    run(w, `splash.version(${JSON.stringify('v' + app.getVersion())})`);
    if (process.env.STEEZ_SNAPSHOTS) {
      setTimeout(async () => {
        if (w.isDestroyed()) return;
        fs.mkdirSync(process.env.STEEZ_SNAPSHOTS, { recursive: true });
        fs.writeFileSync(path.join(process.env.STEEZ_SNAPSHOTS, 'splash.png'), (await w.webContents.capturePage()).toPNG());
      }, 1250);
    }
  });
  return w;
}
function run(w, js) {
  if (!w || w.isDestroyed()) return Promise.resolve();
  return w.webContents.executeJavaScript(js).catch(() => {});
}
const say = (text, pct) => run(splash, `splash.set(${JSON.stringify(text)}, ${pct == null ? 'null' : pct})`);

// ─── Core services ──────────────────────────────────────────────
async function startCore() {
  const userData = app.getPath('userData');
  const appData = app.getPath('appData');
  steez = createStore(userData, 'steez', { twitchClientId: '', checkUpdatesOnLaunch: true, importsDone: {}, windowBounds: null });

  // The bot reads these on import.
  process.env.STEEZ_BOT_DATA = path.join(userData, 'bot');
  const { config } = await import('./bot/config.js');
  const botLogger = await import('./bot/logger.js');
  log = botLogger.log;
  const logFile = path.join(userData, 'steez.log');
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2 * 1024 * 1024) fs.writeFileSync(logFile, '');
  } catch {
    /* ignore */
  }

  // Twitch app: a custom one from Settings → app-config.json → the built-in Steez app.
  const songseek = findSongSeek(appData);
  config.clientId = twitchClientId();
  config.relayUrl = (readAppConfig().relayUrl || BUILTIN_RELAY_URL).replace(/\/$/, '');

  const { startBot, connectBot, bot } = await import('./bot/index.js');
  const { storeToken } = await import('./bot/twitch/auth.js');
  const { db } = await import('./bot/store.js');
  const { createHub, broadcast } = await import('./bot/web/hub.js');
  const { createBotRouter } = await import('./bot/web/api.js');
  const { createServer } = await import('./server.js');
  const { createTwitchHub } = await import('./twitchHub.js');

  await startBot({ openUrl: (url) => shell.openExternal(url) });

  // Import a still-valid SongSeek Twitch login so returning users are connected immediately.
  if (!db.auth.broadcaster && !steez.get('importsDone').songseekTwitch && songseek?.data?.twitchTokens?.access_token) {
    try {
      await storeToken('broadcaster', songseek.data.twitchTokens.access_token, songseek.data.twitchClientId || config.clientId);
      log.info('Imported your Twitch login from SongSeek.');
    } catch (e) {
      log.warn('SongSeek Twitch login could not be imported:', e.message);
    }
    steez.merge({ importsDone: { ...steez.get('importsDone'), songseekTwitch: true } });
  }

  // Local server: UI + overlays + bot API + websockets.
  server = createServer({ rendererDir: path.join(ROOT, 'dist'), log });
  const keyOk = (req) => {
    try {
      return new URL(req.url, 'http://x').searchParams.get('key') === API_KEY;
    } catch {
      return false;
    }
  };
  server.addUpgrade('/ws', createHub({ isAuthed: keyOk }));
  server.router.use(createBotRouter({ key: API_KEY, openUrl: (u) => shell.openExternal(u) }));
  botLogger.setLogSink((line) => {
    broadcast('log', line, { dashboardOnly: true });
    try {
      fs.appendFileSync(logFile, `[${new Date(line.t).toISOString()}] ${line.level.toUpperCase()} ${line.msg}\n`);
    } catch {
      /* ignore */
    }
  });

  twitchHub = createTwitchHub();
  twitchHub.onStatus((s) => send('steez:twitch', s));

  overlays.push(
    { id: 'alerts', module: 'Bot', name: 'Alerts & widgets', path: '/overlay/alerts', description: 'Follows, subs, raids, achievements, shop effects, raid boss, polls, bets, hype meter.', width: 1920, height: 1080 },
    { id: 'alerts-only', module: 'Bot', name: 'Alerts only', path: '/overlay/alerts?widgets=alerts', description: 'Just the event alerts with sound and TTS.', width: 1920, height: 1080 },
    { id: 'effects', module: 'Bot', name: 'Shop effects', path: '/overlay/alerts?widgets=effects', description: 'Confetti, emote rain, TTS, shake, spotlight.', width: 1920, height: 1080 },
    { id: 'boss', module: 'Bot', name: 'Raid boss', path: '/overlay/alerts?widgets=boss', description: 'Boss HP bar and top attackers.', width: 1920, height: 1080 },
    { id: 'poll', module: 'Bot', name: 'Polls & bets', path: '/overlay/alerts?widgets=poll,bets', description: 'Live poll and betting pools.', width: 1920, height: 1080 },
  );

  // Feature modules (SongSeek, QueueUp)
  const imports = { songseek, queueup: findQueueUp(appData) };
  for (const name of FEATURE_MODULES) {
    const entry = path.join(here, name, 'index.cjs');
    if (!fs.existsSync(entry)) continue;
    const prefix = `[${name}]`;
    const ctx = {
      name,
      app,
      ipcMain,
      shell,
      clipboard,
      dialog,
      BrowserWindow,
      send,
      getWindow: () => win,
      userData,
      appRoot: ROOT,
      resourcesPath: app.isPackaged ? process.resourcesPath : path.join(ROOT, 'resources'),
      isPackaged: app.isPackaged,
      createStore: (file, defaults) => createStore(userData, file, defaults),
      imports,
      importsDone: () => steez.get('importsDone') || {},
      markImported: (key) => steez.merge({ importsDone: { ...steez.get('importsDone'), [key]: Date.now() } }),
      twitch: twitchHub,
      server,
      overlays: { register: (o) => overlays.push({ module: name, ...o }) },
      log: { info: (...a) => log.info(prefix, ...a), warn: (...a) => log.warn(prefix, ...a), error: (...a) => log.error(prefix, ...a) },
      onQuit: (fn) => quitHooks.push(fn),
    };
    try {
      const mod = require(entry);
      await mod.init(ctx);
      log.info(`${name} module loaded`);
    } catch (e) {
      log.error(`${name} module failed to load: ${e.stack || e.message}`);
    }
  }

  const port = await server.listen();
  config.publicUrl = `http://127.0.0.1:${port}`;
  log.info(`Local server on http://127.0.0.1:${port}`);
  connectBot();
  const { startModPanel } = await import('./modPanel.js');
  startModPanel({ send, version: app.getVersion() });
  void bot;
}

// ─── Main window ────────────────────────────────────────────────
async function createWindow() {
  const b = steez.get('windowBounds');
  win = new BrowserWindow({
    width: b?.width || 1400,
    height: b?.height || 880,
    x: b?.x,
    y: b?.y,
    minWidth: 1080,
    minHeight: 680,
    frame: false,
    show: false,
    backgroundColor: '#161616',
    title: 'Steez',
    icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload requires the per-module preload files
      backgroundThrottling: false, // keeps YouTube/SoundCloud playback and timers running when minimised
    },
  });
  win.removeMenu();
  if (b?.maximized) win.maximize();
  win.on('maximize', () => send('win:maximized', true));
  win.on('unmaximize', () => send('win:maximized', false));
  const saveBounds = () => {
    if (!win || win.isDestroyed()) return;
    steez.set('windowBounds', { ...win.getNormalBounds(), maximized: win.isMaximized() });
  };
  win.on('close', saveBounds);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  const ready = new Promise((r) => win.once('ready-to-show', r));
  await win.loadURL(DEV ? 'http://127.0.0.1:5173' : server.url('/'));
  await ready;
}

// ─── IPC (shell-level) ──────────────────────────────────────────
function registerIpc() {
  ipcMain.handle('steez:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    dev: DEV,
    packaged: app.isPackaged,
    apiKey: API_KEY,
    port: server?.port,
    baseUrl: server ? server.url('') : null,
  }));
  ipcMain.handle('steez:settings:get', () => ({ ...steez.all(), builtinTwitchApp: BUILTIN_TWITCH_CLIENT_ID }));
  ipcMain.handle('steez:settings:set', async (_e, patch) => {
    steez.merge(patch || {});
    if ('twitchClientId' in (patch || {})) {
      const { config } = await import('./bot/config.js');
      config.clientId = twitchClientId();
    }
    return { ...steez.all(), builtinTwitchApp: BUILTIN_TWITCH_CLIENT_ID };
  });
  ipcMain.handle('steez:overlays', () => ({ baseUrl: server ? server.url('') : '', list: overlays }));
  ipcMain.handle('steez:imports', () => describeImports(app.getPath('appData')));
  ipcMain.handle('steez:twitch:status', () => twitchHub?.status());
  ipcMain.handle('steez:twitch:login', async () => {
    await twitchHub.login();
    return twitchHub.status();
  });
  ipcMain.handle('steez:update:state', () => updater?.state);
  ipcMain.handle('steez:update:check', () => updater?.check());
  ipcMain.handle('steez:update:install', () => {
    for (const fn of quitHooks) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    return updater?.install();
  });
  ipcMain.handle('steez:open', (_e, url) => {
    if (/^https?:\/\//i.test(String(url))) shell.openExternal(String(url));
  });
  ipcMain.handle('steez:copy', (_e, text) => {
    clipboard.writeText(String(text ?? ''));
    return true;
  });
  ipcMain.handle('steez:openLogs', () => shell.openPath(app.getPath('userData')));
  ipcMain.handle('win:minimize', () => win?.minimize());
  ipcMain.handle('win:maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
  ipcMain.handle('win:close', () => win?.close());
  ipcMain.handle('win:isMaximized', () => !!win?.isMaximized());
}

// ─── Lifecycle ──────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.setAppUserModelId('gg.steez.app');

  app.whenReady().then(async () => {
    registerIpc();
    splash = createSplash();
    const minimum = sleep(process.env.STEEZ_SNAPSHOTS ? 3000 : 1600); // let the intro animation finish
    try {
      const settingsPeek = createStore(app.getPath('userData'), 'steez', { checkUpdatesOnLaunch: true });
      const r = await runBootUpdate({ say, enabled: settingsPeek.get('checkUpdatesOnLaunch') !== false });
      updateLog(`boot update result: ${r.reason}`);
    } catch (e) {
      updateLog('boot update threw, continuing: ' + (e?.message || e));
    }
    try {
      say('Starting', null);
      await startCore();
      say('Loading interface', null);
      await createWindow();
    } catch (e) {
      console.error('[startup]', e);
      dialog.showErrorBox('Steez failed to start', String(e?.stack || e));
    }
    await minimum;
    await run(splash, 'splash.out()');
    await sleep(260);
    if (splash && !splash.isDestroyed()) splash.destroy();
    splash = null;
    win?.show();
    booting = false;
    updater = createBackgroundUpdater({ onState: (s) => send('steez:update', s) });
    setTimeout(() => updater.check(), 60_000);
    if (process.env.STEEZ_SNAPSHOTS) snapshotPages(process.env.STEEZ_SNAPSHOTS);
  });

  /** Dev/test helper: screenshot each page into `dir`, then quit. */
  async function snapshotPages(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const routes = (process.env.STEEZ_SNAPSHOT_ROUTES || 'home,music,queue,gifts,commands,moderation,loyalty,games,overlays,settings').split(',');
    win.setSize(1400, 880);
    for (const spec of routes) {
      // "page@Tab label" opens a page, then clicks the tab/button with that label.
      const [r, click] = spec.split('@');
      await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(r)}`);
      await sleep(1500);
      if (click) {
        await win.webContents.executeJavaScript(
          `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(click)})?.click()`,
        );
        await sleep(2500);
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(dir, `${spec.replace(/[^\w-]+/g, '_')}.png`), img.toPNG());
    }
    app.quit();
  }

  app.on('before-quit', () => {
    for (const fn of quitHooks) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    try {
      steez?.flush();
    } catch {
      /* ignore */
    }
    server?.close();
  });
  app.on('window-all-closed', () => {
    if (booting) return;
    app.quit();
  });
}
