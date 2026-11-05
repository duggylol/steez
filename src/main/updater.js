// Updates from GitHub Releases (duggylol/steez).
//  • Boot: on every launch the splash asks GitHub for a newer build. If there is one it is
//    downloaded and installed before the app opens (like Discord), then relaunched.
//  • Running: re-checks every 30 minutes; a downloaded update installs on quit, and the UI
//    offers "Restart to update".
// Rule #1 (from SongSeek): nothing here may ever stop Steez from opening. Every path resolves.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import updaterPkg from 'electron-updater';

const { autoUpdater } = updaterPkg;

const CHECK_TIMEOUT_MS = 9000;
const STALL_TIMEOUT_MS = 45000;
const CEILING_MS = 5 * 60 * 1000;

export function updateLog(line) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'update.log'), `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* never break the app over logging */
  }
}

const supported = () => app.isPackaged && process.platform === 'win32';

/**
 * Runs the launch-time update check, reporting through `say(text, percent|null)`.
 * Resolves { updated:false, reason } when the app should continue opening. When an update
 * installs, the installer relaunches the app and this never needs to resolve.
 */
export function runBootUpdate({ say, enabled = true }) {
  if (!supported() || !enabled) {
    updateLog(`boot check skipped (packaged=${app.isPackaged}, platform=${process.platform}, enabled=${enabled})`);
    return Promise.resolve({ updated: false, reason: 'skipped' });
  }
  return new Promise((resolve) => {
    let done = false;
    const timers = [];
    const after = (ms, fn) => timers.push(setTimeout(fn, ms));
    const finish = (reason) => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      updateLog(`boot update → continue (${reason})`);
      resolve({ updated: false, reason });
    };
    after(CEILING_MS, () => finish('ceiling reached'));

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.logger = { info: updateLog, warn: updateLog, error: updateLog, debug: () => {} };

    say('Checking for updates', null);
    const checkTimer = setTimeout(() => finish('check timed out'), CHECK_TIMEOUT_MS);
    timers.push(checkTimer);
    let stall = null;
    const bumpStall = () => {
      clearTimeout(stall);
      stall = setTimeout(() => finish('download stalled'), STALL_TIMEOUT_MS);
      timers.push(stall);
    };

    autoUpdater.once('update-not-available', () => {
      clearTimeout(checkTimer);
      say('Up to date', 100);
      after(300, () => finish('up to date'));
    });
    autoUpdater.once('update-available', (info) => {
      clearTimeout(checkTimer);
      say(`Downloading ${info?.version || 'update'}`, 0);
      bumpStall();
      autoUpdater.downloadUpdate().catch((e) => finish('download failed: ' + e?.message));
    });
    autoUpdater.on('download-progress', (p) => {
      if (done) return;
      bumpStall();
      const pct = Math.max(0, Math.min(100, Math.round(p.percent || 0)));
      say(`Downloading update ${pct}%`, pct);
    });
    autoUpdater.once('update-downloaded', (info) => {
      timers.forEach(clearTimeout);
      updateLog('boot update downloaded, installing ' + info?.version);
      say('Installing', 100);
      setTimeout(() => {
        try {
          autoUpdater.quitAndInstall(true, true); // silent install, relaunch afterwards
          setTimeout(() => finish('install did not take effect'), 12000);
        } catch (e) {
          finish('install threw: ' + e?.message);
        }
      }, 600);
    });
    autoUpdater.once('error', (e) => finish('updater error: ' + String(e?.message || e)));
    try {
      autoUpdater.checkForUpdates().catch((e) => finish('check failed: ' + e?.message));
    } catch (e) {
      finish('check threw: ' + e?.message);
    }
  });
}

/** Background updater for while the app is open. */
export function createBackgroundUpdater({ onState }) {
  let state = { version: app.getVersion(), supported: supported(), status: supported() ? 'idle' : 'unsupported', newVersion: null, percent: 0, error: null };
  const set = (patch) => {
    state = { ...state, ...patch };
    onState?.(state);
  };
  const check = () => {
    if (!supported()) return state;
    autoUpdater.checkForUpdates().catch((e) => set({ status: 'error', error: String(e?.message || e) }));
    return state;
  };
  if (supported()) {
    autoUpdater.removeAllListeners();
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
    autoUpdater.on('update-available', (i) => set({ status: 'downloading', newVersion: i.version, percent: 0 }));
    autoUpdater.on('update-not-available', () => set({ status: 'current' }));
    autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded', (i) => set({ status: 'ready', newVersion: i.version, percent: 100 }));
    autoUpdater.on('error', (e) => set({ status: 'error', error: String(e?.message || e) }));
    setInterval(check, 30 * 60 * 1000).unref();
  }
  return {
    get state() {
      return state;
    },
    check,
    install() {
      if (state.status !== 'ready') return false;
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
      return true;
    },
  };
}
