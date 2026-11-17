// "Import accounts": log in to StreamElements or Streamlabs in a window inside Steez and bring over
// loyalty points, watch time, custom commands, timers, quotes, counters and points settings.
//
// StreamElements: the login window's own API calls carry a token; Steez borrows it (in memory only)
// to read the same data from api.streamelements.com. Points, commands and points settings are public,
// so they also work from just the channel name.
// Streamlabs: Cloudbot has no public API, so Steez opens the Cloudbot pages in the logged-in window,
// keeps the data those pages load, and reads the loyalty list page by page.
import { BrowserWindow, session, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { SE_API, fromStreamElements, fromStreamlabs, fromCsv, summarize, applyBundle, morePages, normLogin } from './convert.js';

const PARTITION = { streamelements: 'persist:steez-import-se', streamlabs: 'persist:steez-import-sl' };
const SL = 'https://streamlabs.com';
const SL_PAGES = ['cloudbot', 'cloudbot/commands', 'cloudbot/commands/custom', 'cloudbot/timers', 'cloudbot/quotes', 'cloudbot/loyalty', 'cloudbot/counters', 'loyalty'];
const SL_GUESS = ['loyalty', 'commands', 'commands/custom', 'custom-commands', 'timers', 'quotes', 'counters'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function registerAccountImport({ ipcMain, parent, send, log, bot, db, flush, dataDir }) {
  const state = {
    streamelements: { token: null, scheme: 'Bearer', channelId: null, channel: null, display: null, viaLogin: false },
    streamlabs: { loggedIn: false, account: null, captures: new Map() },
  };
  const bundles = {}; // provider -> last scanned bundle
  let busy = false;

  const progress = (provider, text) => send('steez:accounts:progress', { provider, text });
  const publicState = () => ({
    streamelements: { connected: !!state.streamelements.channelId, channel: state.streamelements.display || state.streamelements.channel, loggedIn: !!state.streamelements.token },
    streamlabs: { connected: state.streamlabs.loggedIn, account: state.streamlabs.account, seen: state.streamlabs.captures.size },
    scanned: Object.fromEntries(Object.entries(bundles).map(([k, b]) => [k, summarize(b)])),
  });

  // ─── Login windows ───────────────────────────────────────────────
  let openWin = null;
  function loginWindow(provider, url, { show = false, title } = {}) {
    if (openWin && !openWin.isDestroyed()) openWin.close();
    const w = new BrowserWindow({
      width: 1100,
      height: 800,
      show,
      parent: parent() || undefined,
      title: title || 'Log in',
      autoHideMenuBar: true,
      backgroundColor: '#111111',
      webPreferences: { partition: PARTITION[provider], contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    // Twitch / Google sign-in popups stay inside the same login session.
    w.webContents.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { partition: PARTITION[provider], contextIsolation: true, sandbox: true } },
    }));
    w.loadURL(url).catch(() => {});
    openWin = w;
    return w;
  }

  // ─── StreamElements ──────────────────────────────────────────────
  const se = state.streamelements;
  async function seGet(p, { auth = true, optional = false } = {}) {
    const headers = { Accept: 'application/json' };
    if (auth && se.token) headers.Authorization = `${se.scheme || 'Bearer'} ${se.token}`;
    for (let attempt = 0; attempt < 6; attempt++) {
      const r = await fetch(`${SE_API}/${p}`, { headers });
      if (r.status === 429) {
        const reset = Number(r.headers.get('x-ratelimit-reset'));
        await sleep(reset > Date.now() ? Math.min(15000, reset - Date.now() + 200) : 1500 * (attempt + 1));
        continue;
      }
      if (!r.ok) {
        if (optional) return null;
        const body = await r.text().catch(() => '');
        throw new Error(`StreamElements said ${r.status}${/unauthor/i.test(body) ? ' (log in again)' : ''}`);
      }
      return r.json();
    }
    if (optional) return null;
    throw new Error('StreamElements is busy right now. Try again in a minute.');
  }

  async function useSeToken(token, scheme = 'Bearer') {
    const t = String(token || '').trim();
    const m = /^(Bearer|OAuth)\s+(.+)$/i.exec(t);
    se.scheme = m ? (m[1].toLowerCase() === 'oauth' ? 'OAuth' : 'Bearer') : scheme;
    se.token = m ? m[2].trim() : t;
    if (se.token.length < 20) throw new Error('That doesn’t look like a StreamElements token.');
    const me = await seGet('channels/me');
    se.channelId = me._id;
    se.channel = me.username;
    se.display = me.displayName || me.username;
    se.viaLogin = true;
    return publicState();
  }

  function seLogin() {
    return new Promise((resolve, reject) => {
      const ses = session.fromPartition(PARTITION.streamelements);
      let done = false;
      let tried = null;
      const w = loginWindow('streamelements', 'https://streamelements.com/dashboard', { title: 'Log in to StreamElements' });
      const finish = (err, val) => {
        if (done) return;
        done = true;
        ses.webRequest.onBeforeSendHeaders(null);
        clearTimeout(showTimer);
        if (!w.isDestroyed()) w.close();
        err ? reject(err) : resolve(val);
      };
      ses.webRequest.onBeforeSendHeaders({ urls: ['https://api.streamelements.com/*'] }, (d, cb) => {
        const a = d.requestHeaders.Authorization || d.requestHeaders.authorization || '';
        const m = /^(Bearer|OAuth)\s+(\S{20,})/i.exec(a);
        cb({ requestHeaders: d.requestHeaders });
        if (m && !done && m[2] !== tried) {
          tried = m[2];
          useSeToken(m[2], m[1].toLowerCase() === 'oauth' ? 'OAuth' : 'Bearer')
            .then((s) => finish(null, s))
            .catch(() => {}); // not a channel token yet; keep waiting
        }
      });
      // Already logged in from last time? Then the window never needs to show.
      const showTimer = setTimeout(() => !done && !w.isDestroyed() && w.show(), 5000);
      w.on('closed', () => finish(new Error('Login window closed before you finished logging in.')));
    });
  }

  async function seChannel(name) {
    const login = normLogin(name);
    if (!/^[a-z0-9_]{2,25}$/.test(login)) throw new Error('Type your Twitch channel name.');
    const c = await seGet(`channels/${encodeURIComponent(login)}`, { auth: false });
    if (!c?._id) throw new Error(`StreamElements has no channel called ${login}.`);
    Object.assign(se, { channelId: c._id, channel: c.username || login, display: c.displayName || c.username || login });
    if (se.viaLogin && se.channelId !== c._id) se.token = null; // that token was for a different channel
    return publicState();
  }

  async function sePaged(kind) {
    const out = [];
    for (let offset = 0; offset < 2_000_000; offset += 1000) {
      const r = await seGet(`points/${se.channelId}/${kind}?limit=1000&offset=${offset}`, { auth: false, optional: offset > 0 });
      const users = r?.users || [];
      out.push(...users);
      progress('streamelements', `${kind === 'top' ? 'Points' : 'Watch time'}: ${out.length.toLocaleString()} viewers…`);
      if (users.length < 1000) break;
    }
    return out;
  }

  async function seScan() {
    if (!se.channelId) throw new Error('Connect StreamElements first.');
    const id = se.channelId;
    const raw = { channel: se.display || se.channel };
    progress('streamelements', 'Points settings…');
    raw.loyalty = await seGet(`loyalty/${id}`, { auth: false, optional: true });
    raw.points = await sePaged('top');
    raw.watchtime = await sePaged('watchtime');
    progress('streamelements', 'Commands…');
    raw.commands = (await seGet(`bot/commands/${id}`, { optional: true })) || [];
    const notes = [];
    if (se.token) {
      progress('streamelements', 'Timers, quotes and counters…');
      raw.timers = (await seGet(`bot/timers/${id}`, { optional: true })) || [];
      raw.counters = (await seGet(`bot/${id}/counters`, { optional: true })) || [];
      raw.quotes = [];
      for (let offset = 0; offset < 100000; offset += 100) {
        const q = await seGet(`bot/quotes/${id}?limit=100&offset=${offset}`, { optional: true });
        const list = q?.quotes || (Array.isArray(q) ? q : []);
        raw.quotes.push(...list);
        if (list.length < 100) break;
      }
    } else notes.push('Log in to StreamElements to also bring timers, quotes and counters (only points, commands and points settings are public).');
    const b = fromStreamElements(raw);
    b.notes.push(...notes);
    return b;
  }

  // ─── Streamlabs ─────────────────────────────────────────────────
  const sl = state.streamlabs;
  const slSession = () => session.fromPartition(PARTITION.streamlabs);

  async function slFetch(url) {
    const r = await slSession().fetch(url, { headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.includes('json')) return { ok: false, status: r.status };
    try {
      return { ok: true, json: await r.json() };
    } catch {
      return { ok: false, status: r.status };
    }
  }

  async function slCheckLogin() {
    const r = await slFetch(`${SL}/api/v5/cloudbot/loyalty?page=1`);
    if (r.ok) {
      sl.loggedIn = true;
      sl.captures.set(`${SL}/api/v5/cloudbot/loyalty?page=1`, r.json);
      return true;
    }
    return false;
  }

  /** Record every JSON response the Streamlabs window receives from its own API. */
  function capture(w) {
    const dbg = w.webContents.debugger;
    const pending = new Map();
    try {
      dbg.attach('1.3');
    } catch {
      return;
    }
    dbg.on('message', async (_e, method, params) => {
      if (method === 'Network.responseReceived') {
        const { url, mimeType } = params.response;
        if (/streamlabs\.com\/api\//.test(url) && /json/.test(mimeType || '')) pending.set(params.requestId, url);
      } else if (method === 'Network.loadingFinished' && pending.has(params.requestId)) {
        const url = pending.get(params.requestId);
        pending.delete(params.requestId);
        try {
          const { body, base64Encoded } = await dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId });
          const json = JSON.parse(base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body);
          sl.captures.set(url, json);
          const acct = json?.user?.display_name || json?.user?.username || json?.display_name;
          if (!sl.account && /\/api\/v\d+(\.\d+)?\/(user|me|profile)/.test(url) && typeof acct === 'string') sl.account = acct;
          send('steez:accounts:state', publicState());
        } catch {
          /* not JSON / gone */
        }
      }
    });
    dbg.sendCommand('Network.enable').catch(() => {});
  }

  function slLogin() {
    return new Promise((resolve, reject) => {
      let done = false;
      const w = loginWindow('streamlabs', `${SL}/dashboard#/cloudbot`, { title: 'Log in to Streamlabs' });
      capture(w);
      const tick = setInterval(async () => {
        if (done || w.isDestroyed()) return;
        if (await slCheckLogin().catch(() => false)) {
          done = true;
          clearInterval(tick);
          resolve(publicState());
          // Keep the window for the scan (hidden); it is reused by slScan.
          w.hide();
        }
      }, 2500);
      setTimeout(() => !done && !w.isDestroyed() && w.show(), 5000);
      w.on('closed', () => {
        clearInterval(tick);
        if (!done) {
          done = true;
          reject(new Error('Login window closed before you finished logging in.'));
        }
      });
    });
  }

  async function slScan() {
    if (!sl.loggedIn && !(await slCheckLogin().catch(() => false))) throw new Error('Log in to Streamlabs first.');
    let w = openWin && !openWin.isDestroyed() ? openWin : null;
    if (!w) {
      w = loginWindow('streamlabs', `${SL}/dashboard#/cloudbot`, { title: 'Streamlabs' });
      capture(w);
      await sleep(4000);
    }
    // Visit the Cloudbot pages so the dashboard loads its own data.
    for (const p of SL_PAGES) {
      if (w.isDestroyed()) break;
      progress('streamlabs', `Reading Cloudbot: ${p.replace('cloudbot/', '').replace('cloudbot', 'overview')}…`);
      await w.loadURL(`${SL}/dashboard#/${p}`).catch(() => {});
      await sleep(3500);
    }
    // Also ask for the usual endpoints directly.
    for (const g of SL_GUESS) {
      const url = `${SL}/api/v5/cloudbot/${g}?page=1`;
      if (sl.captures.has(url)) continue;
      const r = await slFetch(url).catch(() => ({ ok: false }));
      if (r.ok) sl.captures.set(url, r.json);
    }
    // Fetch the remaining pages of anything paginated (the viewer list mostly).
    for (const [url, json] of [...sl.captures]) {
      const rest = morePages(url, json);
      for (let i = 0; i < rest.length; i++) {
        if (sl.captures.has(rest[i])) continue;
        if (i % 5 === 0) progress('streamlabs', `Loyalty: page ${i + 2} of ${rest.length + 1}…`);
        const r = await slFetch(rest[i]).catch(() => ({ ok: false }));
        if (!r.ok) break;
        sl.captures.set(rest[i], r.json);
      }
    }
    // The loyalty list may not say how many pages it has: keep going until a page comes back empty.
    const base = `${SL}/api/v5/cloudbot/loyalty`;
    const hasMeta = morePages(`${base}?page=1`, sl.captures.get(`${base}?page=1`)).length > 0;
    if (!hasMeta && sl.captures.has(`${base}?page=1`)) {
      for (let p = 2; p < 20000; p++) {
        const url = `${base}?page=${p}`;
        const r = await slFetch(url).catch(() => ({ ok: false }));
        if (!r.ok || !fromStreamlabs([{ url, json: r.json }]).users.length) break;
        sl.captures.set(url, r.json);
        if (p % 5 === 0) progress('streamlabs', `Loyalty: page ${p}…`);
      }
    }
    if (!w.isDestroyed()) w.close();
    const b = fromStreamlabs([...sl.captures].map(([url, json]) => ({ url, json })));
    b.channel = sl.account || 'Streamlabs';
    if (!b.commands.length || !b.timers.length || !b.quotes.length)
      b.notes.push('Missing something? Press "Open Streamlabs" and click through the Cloudbot pages that hold it (Commands, Timers, Quotes, Loyalty). Steez picks up what those pages show, then scan again.');
    return b;
  }

  /** Let the streamer click around Cloudbot themselves; resolves when they close the window. */
  function slBrowse() {
    return new Promise((resolve) => {
      const w = loginWindow('streamlabs', `${SL}/dashboard#/cloudbot`, { show: true, title: 'Streamlabs — open the Cloudbot pages to import, then close this window' });
      capture(w);
      w.on('closed', () => resolve(publicState()));
    });
  }

  // ─── Applying ──────────────────────────────────────────────────
  function backupFirst() {
    flush();
    const file = path.join(dataDir, 'db.json');
    if (!fs.existsSync(file)) return null;
    const dir = path.join(dataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const to = path.join(dir, `db-before-import-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.copyFileSync(file, to);
    return to;
  }

  const guard = async (fn) => {
    if (busy) throw new Error('Already working on an import. Give it a moment.');
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
      progress(null, '');
    }
  };

  ipcMain.handle('steez:accounts:state', () => publicState());
  ipcMain.handle('steez:accounts:se:login', () => guard(seLogin));
  ipcMain.handle('steez:accounts:se:token', (_e, token) => guard(() => useSeToken(token)));
  ipcMain.handle('steez:accounts:se:channel', (_e, name) => guard(() => seChannel(name)));
  ipcMain.handle('steez:accounts:sl:login', () => guard(slLogin));
  ipcMain.handle('steez:accounts:sl:browse', () => guard(slBrowse));
  ipcMain.handle('steez:accounts:scan', (_e, provider) =>
    guard(async () => {
      const b = provider === 'streamelements' ? await seScan() : provider === 'streamlabs' ? await slScan() : null;
      if (!b) throw new Error('Unknown account type');
      bundles[provider] = b;
      log.info(`Import scan (${provider}): ${b.users.length} viewers, ${b.commands.length} commands, ${b.timers.length} timers, ${b.quotes.length} quotes`);
      return publicState();
    }),
  );
  ipcMain.handle('steez:accounts:csv', () =>
    guard(async () => {
      const r = await dialog.showOpenDialog(parent(), { title: 'Pick a points export', filters: [{ name: 'Spreadsheet (CSV)', extensions: ['csv', 'txt', 'tsv'] }], properties: ['openFile'] });
      if (r.canceled || !r.filePaths[0]) return publicState();
      const b = fromCsv(fs.readFileSync(r.filePaths[0], 'utf8'));
      b.channel = path.basename(r.filePaths[0]);
      if (!b.users.length) throw new Error('No viewers found in that file. It needs a username column and a points column.');
      bundles.csv = b;
      return publicState();
    }),
  );
  ipcMain.handle('steez:accounts:apply', (_e, provider, opts) =>
    guard(async () => {
      const b = bundles[provider];
      if (!b) throw new Error('Scan the account first.');
      const backup = backupFirst();
      const builtins = [...(bot.builtins?.keys?.() || [])];
      for (const def of bot.builtins?.values?.() || []) builtins.push(...(def.aliases || []));
      const res = applyBundle(db, b, { ...(opts || {}), builtins });
      flush();
      bot.emit?.('db:changed', { source: 'import' });
      log.info(`Imported from ${provider}: ${JSON.stringify(res)}`);
      return { ...res, backup };
    }),
  );
  ipcMain.handle('steez:accounts:logout', async (_e, provider) => {
    if (openWin && !openWin.isDestroyed()) openWin.close();
    await session.fromPartition(PARTITION[provider]).clearStorageData();
    if (provider === 'streamelements') Object.assign(se, { token: null, channelId: null, channel: null, display: null, viaLogin: false });
    if (provider === 'streamlabs') Object.assign(sl, { loggedIn: false, account: null, captures: new Map() });
    delete bundles[provider];
    return publicState();
  });
}
