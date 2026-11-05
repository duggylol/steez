// Mod panel backend.
//  • Each streamer's Steez keeps a websocket to a ChannelHub Durable Object (one per channel).
//  • Mods log in with Twitch on /mod; we check with Twitch which channels they moderate and give
//    them a signed session. Their actions are forwarded to that channel's Steez, which applies
//    only what the streamer allowed and answers. Nothing is stored here except the open socket.
import { PANEL_HTML } from './panel.js';

const SESSION_HOURS = 12;
const CALL_TIMEOUT_MS = 15_000;
const MOD_RATE = 60; // actions per minute per mod
const modBuckets = new Map();

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

// ─── Sessions (HMAC-signed, key derived from the Twitch client secret) ─────────
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
let keyCache = null;
async function hmacKey(env) {
  if (keyCache?.secret === env.TWITCH_CLIENT_SECRET) return keyCache.key;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`steez-mod-session:${env.TWITCH_CLIENT_SECRET}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  keyCache = { secret: env.TWITCH_CLIENT_SECRET, key };
  return key;
}
async function signSession(env, payload) {
  const body = b64u(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64u(await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(body)));
  return `${body}.${sig}`;
}
async function readSession(env, request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), fromB64u(sig), new TextEncoder().encode(body));
  if (!ok) return null;
  const s = JSON.parse(new TextDecoder().decode(fromB64u(body)));
  return s.exp > Date.now() ? s : null;
}

function allowMod(id) {
  const now = Date.now();
  const list = (modBuckets.get(id) || []).filter((t) => now - t < 60_000);
  const ok = list.length < MOD_RATE;
  if (ok) list.push(now);
  modBuckets.set(id, list);
  if (modBuckets.size > 20000) modBuckets.clear();
  return ok;
}

const hub = (env, channelId) => env.HUB.get(env.HUB.idFromName(String(channelId)));

/** Returns a Response for mod-panel routes, or null if the path isn't one of ours. */
export async function handleMods(request, env, url, { validateUser }) {
  const p = url.pathname;

  if (request.method === 'GET' && (p === '/mod' || p === '/mod/')) {
    const html = PANEL_HTML.replace('__CLIENT_ID__', env.TWITCH_CLIENT_ID);
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' } });
  }

  // Steez app ↔ hub socket. Authenticated with the streamer's own Twitch token.
  if (p === '/v1/hub') {
    if (request.headers.get('upgrade') !== 'websocket') return json({ error: 'expected_websocket' }, 426);
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const user = token && (await validateUser(token));
    if (!user) return json({ error: 'invalid_token' }, 401);
    if (user.clientId !== env.TWITCH_CLIENT_ID) return json({ error: 'wrong_app' }, 403);
    const req = new Request('https://hub/connect', request);
    req.headers.set('x-channel-id', user.userId);
    req.headers.set('x-channel-login', user.login);
    return hub(env, user.userId).fetch(req);
  }

  // Mod logs in: exchange their Twitch token for a session listing the channels they moderate.
  if (request.method === 'POST' && p === '/mod/session') {
    const { token } = (await request.json().catch(() => ({}))) || {};
    const user = token && (await validateUser(String(token)));
    if (!user) return json({ error: 'Twitch did not accept that login. Try again.' }, 401);
    if (user.clientId !== env.TWITCH_CLIENT_ID) return json({ error: 'wrong_app' }, 403);
    const channels = [];
    if (user.scopes.includes('user:read:moderated_channels')) {
      let after = '';
      for (let i = 0; i < 5; i++) {
        const r = await fetch(`https://api.twitch.tv/helix/moderation/channels?user_id=${user.userId}&first=100${after ? `&after=${after}` : ''}`, {
          headers: { 'Client-Id': env.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` },
        });
        if (!r.ok) break;
        const j = await r.json();
        for (const c of j.data || []) channels.push({ id: c.broadcaster_id, login: c.broadcaster_login, name: c.broadcaster_name });
        after = j.pagination?.cursor || '';
        if (!after) break;
      }
    }
    // Streamers can use the panel for their own channel too.
    channels.unshift({ id: user.userId, login: user.login, name: user.login, own: true });
    const session = await signSession(env, { uid: user.userId, login: user.login, channels: channels.slice(0, 300), exp: Date.now() + SESSION_HOURS * 3600_000 });
    return json({ session, user: { id: user.userId, login: user.login } });
  }

  if (p.startsWith('/mod/api/')) {
    const s = await readSession(env, request);
    if (!s) return json({ error: 'session_expired' }, 401);

    // Which of my channels have Steez running right now?
    if (request.method === 'GET' && p === '/mod/api/channels') {
      const list = s.channels.slice(0, 60);
      const status = await Promise.all(
        list.map((c) =>
          hub(env, c.id)
            .fetch('https://hub/status')
            .then((r) => r.json())
            .catch(() => ({ online: false })),
        ),
      );
      return json({ user: { id: s.uid, login: s.login }, channels: list.map((c, i) => ({ ...c, online: !!status[i].online, info: status[i].info || null })) });
    }

    if (request.method === 'POST' && p === '/mod/api/call') {
      const body = await request.json().catch(() => null);
      const channel = s.channels.find((c) => c.id === String(body?.channelId));
      if (!channel) return json({ error: 'You are not a moderator of that channel.' }, 403);
      if (!allowMod(s.uid)) return json({ error: 'Slow down — too many changes in a minute.' }, 429);
      const action = String(body?.action || '').slice(0, 60);
      if (!/^[a-z]+(\.[a-zA-Z]+)?$/.test(action)) return json({ error: 'Bad action' }, 400);
      return hub(env, channel.id).fetch('https://hub/call', {
        method: 'POST',
        body: JSON.stringify({ action, args: body.args ?? {}, mod: { id: s.uid, login: s.login, own: channel.own === true } }),
      });
    }
  }
  return null;
}

// ─── One Durable Object per channel: holds that streamer's Steez socket ──────────
export class ChannelHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.pending = new Map();
  }

  sock() {
    return this.ctx.getWebSockets('steez')[0] || null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/connect') {
      for (const old of this.ctx.getWebSockets('steez')) {
        try {
          old.close(4000, 'Replaced by a newer Steez connection');
        } catch {
          /* already closed */
        }
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, ['steez']);
      server.serializeAttachment({ channelId: request.headers.get('x-channel-id'), login: request.headers.get('x-channel-login'), connectedAt: Date.now(), info: null });
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === '/status') {
      const ws = this.sock();
      const a = ws?.deserializeAttachment() || {};
      return json({ online: !!ws, info: a.info || null, connectedAt: a.connectedAt || null });
    }
    if (url.pathname === '/call') {
      const ws = this.sock();
      if (!ws) return json({ ok: false, error: 'offline' }, 503);
      const body = await request.json();
      const id = crypto.randomUUID();
      const reply = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          resolve({ ok: false, error: 'Steez did not answer in time. The streamer’s PC may be busy or offline.' });
        }, CALL_TIMEOUT_MS);
        this.pending.set(id, (msg) => {
          clearTimeout(timer);
          resolve(msg);
        });
        try {
          ws.send(JSON.stringify({ type: 'call', id, action: body.action, args: body.args, mod: body.mod }));
        } catch {
          clearTimeout(timer);
          this.pending.delete(id);
          resolve({ ok: false, error: 'offline' });
        }
      });
      return json({ ok: !!reply.ok, result: reply.result ?? null, error: reply.error || null }, reply.ok ? 200 : reply.error === 'offline' ? 503 : 400);
    }
    return json({ error: 'not_found' }, 404);
  }

  async webSocketMessage(ws, data) {
    let msg;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
    } catch {
      return;
    }
    if (msg.type === 'reply') {
      const fn = this.pending.get(msg.id);
      if (fn) {
        this.pending.delete(msg.id);
        fn(msg);
      }
    } else if (msg.type === 'hello') {
      const a = ws.deserializeAttachment() || {};
      // Keep it small: attachments are limited to 2 KB.
      const info = { name: String(msg.info?.name || '').slice(0, 40), permissions: msg.info?.permissions || {}, version: String(msg.info?.version || '').slice(0, 20) };
      ws.serializeAttachment({ ...a, info });
    } else if (msg.type === 'ping') {
      ws.send('{"type":"pong"}');
    }
  }

  async webSocketClose(ws, code, reason) {
    try {
      ws.close(code, reason);
    } catch {
      /* ignore */
    }
  }
}
