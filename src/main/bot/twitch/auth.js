// Twitch login without a client secret: OAuth implicit flow through a loopback page on
// http://localhost:43111 (the same redirect SongSeek uses, so an existing SongSeek Twitch
// app works unchanged). Tokens last ~60 days; they're validated hourly and the UI asks
// for a reconnect when one expires.
import http from 'node:http';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, save } from '../store.js';
import { log } from '../logger.js';

export const REDIRECT_PORT = 43111;
export const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

export const SCOPES = {
  broadcaster: [
    'chat:read',
    'chat:edit',
    'channel:manage:broadcast',
    'channel:read:subscriptions',
    'channel:read:redemptions',
    'channel:read:ads',
    'clips:edit',
    'moderator:read:followers',
    'moderator:read:chatters',
    'moderator:manage:chat_settings',
    'moderator:manage:shoutouts',
    'moderator:manage:announcements',
    'moderator:manage:banned_users',
    'moderator:manage:chat_messages',
  ],
  bot: [
    'chat:read',
    'chat:edit',
    'moderator:manage:banned_users',
    'moderator:manage:chat_messages',
    'moderator:manage:announcements',
    'moderator:manage:shoutouts',
    'moderator:read:chatters',
  ],
};

let openBrowser = (url) => log.info(`Open this URL to log in: ${url}`);
export function setBrowserOpener(fn) {
  openBrowser = fn;
}

const listeners = new Set();
export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function changed(role) {
  for (const fn of listeners) {
    try {
      fn(role);
    } catch (e) {
      log.error(e);
    }
  }
}

export async function validate(accessToken) {
  try {
    const res = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${accessToken}` } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return undefined; // network problem — unknown, not invalid
  }
}

let pending = null;
/** Opens the browser for Twitch login and resolves with the stored account. */
export async function login(role) {
  if (!config.clientId) throw new Error('No Twitch Client ID set. Add one in Settings → Twitch app.');
  if (pending) {
    pending.cancel();
    pending = null;
  }
  const state = crypto.randomBytes(12).toString('hex');
  const token = await new Promise((resolve, reject) => {
    const page = (msg) =>
      `<!doctype html><meta charset="utf-8"><title>Steez</title><body style="margin:0;background:#161616;color:#e6e6e6;font:15px system-ui;display:grid;place-items:center;height:100vh"><div style="border:1px solid #333;padding:28px 36px;background:#1d1d1d"><div style="letter-spacing:.3em;font-weight:700;margin-bottom:10px">STEEZ</div>${msg}</div>`;
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT_URI);
      if (u.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page(`Finishing login…<script>location.replace('/capture?'+location.hash.slice(1))</script>`));
        return;
      }
      if (u.pathname === '/capture') {
        const error = u.searchParams.get('error_description') || u.searchParams.get('error');
        const accessToken = u.searchParams.get('access_token');
        const ok = !error && accessToken && u.searchParams.get('state') === state;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page(ok ? 'Twitch connected. You can close this tab and return to Steez.' : 'Twitch login failed. You can close this tab.'));
        finish();
        if (error) reject(new Error(`Twitch login refused: ${error}`));
        else if (u.searchParams.get('state') !== state) reject(new Error('Login state mismatch — please try again.'));
        else if (!accessToken) reject(new Error('Twitch returned no token.'));
        else resolve(accessToken);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const timer = setTimeout(() => {
      finish();
      reject(new Error('Timed out waiting for the Twitch login.'));
    }, 5 * 60 * 1000);
    const finish = () => {
      clearTimeout(timer);
      server.close();
      pending = null;
    };
    pending = { cancel: () => (finish(), reject(new Error('Login cancelled.'))) };
    server.on('error', (e) =>
      reject(e.code === 'EADDRINUSE' ? new Error('Port 43111 is busy — close SongSeek (or another login window) and try again.') : e),
    );
    server.listen(REDIRECT_PORT, () => {
      const p = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: REDIRECT_URI,
        response_type: 'token',
        scope: SCOPES[role].join(' '),
        state,
        force_verify: role === 'bot' ? 'true' : 'false',
      });
      openBrowser(`https://id.twitch.tv/oauth2/authorize?${p}`);
    });
  });
  return storeToken(role, token, config.clientId);
}

export function cancelLogin() {
  pending?.cancel();
}

/** Validate and store a token (also used to import a token from SongSeek). */
export async function storeToken(role, accessToken, clientId) {
  const info = await validate(accessToken);
  if (!info) throw new Error('Twitch rejected that login.');
  db.auth[role] = {
    accessToken,
    clientId: info.client_id || clientId,
    userId: info.user_id,
    login: info.login,
    scopes: info.scopes || [],
    expiresAt: Date.now() + (info.expires_in || 0) * 1000,
    expired: false,
  };
  save();
  log.info(`Connected ${role} account: ${info.login}`);
  changed(role);
  return db.auth[role];
}

/** The account used for a role. "bot" falls back to the broadcaster if no separate bot is connected. */
export function getAccount(role) {
  const usable = (a) => (a && !a.expired ? a : null);
  if (role === 'bot') return usable(db.auth.bot) || usable(db.auth.broadcaster);
  return usable(db.auth[role]);
}

export function actualRole(role) {
  if (role === 'bot' && !(db.auth.bot && !db.auth.bot.expired)) return 'broadcaster';
  return role;
}

/** Implicit tokens can't be refreshed: re-validate, and flag the account as expired if Twitch says no. */
export async function refresh(role) {
  role = actualRole(role);
  const acct = db.auth[role];
  if (!acct) throw new Error(`No ${role} account connected`);
  const info = await validate(acct.accessToken);
  if (info === null) {
    acct.expired = true;
    save();
    log.warn(`The ${role} Twitch login expired — reconnect it in Steez.`);
    changed(role);
    throw new Error(`Twitch ${role} login expired`);
  }
  return acct;
}

export function disconnect(role) {
  delete db.auth[role];
  save();
  changed(role);
}

export function hasScope(role, scope) {
  return (getAccount(role)?.scopes || []).includes(scope);
}

export function missingScopes(role) {
  const a = db.auth[role];
  if (!a) return SCOPES[role];
  return SCOPES[role].filter((s) => !(a.scopes || []).includes(s));
}

// Twitch requires apps to validate their tokens hourly.
setInterval(
  () => {
    for (const role of ['broadcaster', 'bot']) if (db.auth[role] && !db.auth[role].expired) refresh(role).catch(() => {});
  },
  60 * 60 * 1000,
).unref();
