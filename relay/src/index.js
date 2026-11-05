// SteezBot relay — a Cloudflare Worker that lets every Steez install speak in its own channel
// as the shared SteezBot account, using Twitch's official chat-bot flow:
//   app access token (needs the client secret, which only lives here)
//   + SteezBot's one-time consent (user:bot, user:write:chat)
//   + each streamer's consent (channel:bot, granted when they connect Steez)
// Streamers prove they own the channel by sending their own Twitch token; it is validated
// against Twitch and never stored (only a hash is cached for a few minutes).

const REDIRECT_URI = 'http://localhost:43111';
const BOT_SCOPES = 'user:bot user:write:chat user:read:chat';
const RATE_LIMIT = 20; // messages per channel per window (Twitch's own non-mod limit)
const RATE_WINDOW_MS = 30_000;
const VALIDATION_TTL_MS = 10 * 60_000;

// Per-isolate caches. Workers recycle isolates, which simply means a re-fetch.
let appToken = null; // { token, exp }
let botUser = null; // { id, login, display }
const validated = new Map(); // sha256(token) → { userId, login, clientId, scopes, exp }
const buckets = new Map(); // broadcasterId → [timestamps]

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getAppToken(env) {
  if (appToken && appToken.exp > Date.now() + 60_000) return appToken.token;
  const r = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID, client_secret: env.TWITCH_CLIENT_SECRET, grant_type: 'client_credentials' }),
  });
  if (!r.ok) throw new Error(`Twitch app token failed (${r.status}) — check TWITCH_CLIENT_SECRET`);
  const j = await r.json();
  appToken = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return appToken.token;
}

async function helix(env, method, path, body, retried = false) {
  const r = await fetch(`https://api.twitch.tv/helix${path}`, {
    method,
    headers: {
      'Client-Id': env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${await getAppToken(env)}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && !retried) {
    appToken = null;
    return helix(env, method, path, body, true);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.message || `Helix ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return j;
}

async function getBot(env) {
  if (botUser) return botUser;
  if (!env.BOT_LOGIN) throw new Error('BOT_LOGIN is not configured');
  const j = await helix(env, 'GET', `/users?login=${encodeURIComponent(env.BOT_LOGIN.toLowerCase())}`);
  const u = j.data?.[0];
  if (!u) throw new Error(`Twitch account "${env.BOT_LOGIN}" not found`);
  botUser = { id: u.id, login: u.login, display: u.display_name };
  return botUser;
}

async function validateUser(token) {
  const key = await sha256(token);
  const hit = validated.get(key);
  if (hit && hit.exp > Date.now()) return hit;
  const r = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token}` } });
  if (!r.ok) {
    validated.delete(key);
    return null;
  }
  const j = await r.json();
  const v = { userId: j.user_id, login: j.login, clientId: j.client_id, scopes: j.scopes || [], exp: Date.now() + VALIDATION_TTL_MS };
  if (validated.size > 5000) validated.clear();
  validated.set(key, v);
  return v;
}

function allow(id) {
  const now = Date.now();
  const list = (buckets.get(id) || []).filter((t) => now - t < RATE_WINDOW_MS);
  const ok = list.length < RATE_LIMIT;
  if (ok) list.push(now);
  buckets.set(id, list);
  if (buckets.size > 20000) buckets.clear();
  return ok;
}

const blocked = (env, id) =>
  String(env.BLOCKED_CHANNELS || '')
    .split(',')
    .map((s) => s.trim())
    .includes(id);

export async function handle(request, env) {
  const url = new URL(request.url);
  try {
    if (request.method === 'GET' && url.pathname === '/') return json({ name: 'steez-relay', ok: true });

    if (request.method === 'GET' && url.pathname === '/v1/status') {
      const bot = await getBot(env);
      return json({ ok: true, bot });
    }

    // One-time owner step: log in as the bot account and approve — Twitch records the consent.
    if (request.method === 'GET' && url.pathname === '/setup') {
      const p = new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'token', scope: BOT_SCOPES, force_verify: 'true' });
      return Response.redirect(`https://id.twitch.tv/oauth2/authorize?${p}`, 302);
    }

    if (request.method === 'POST' && url.pathname === '/v1/say') {
      const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
      if (!token) return json({ error: 'missing_token' }, 401);
      const user = await validateUser(token);
      if (!user) return json({ error: 'invalid_token' }, 401);
      if (user.clientId !== env.TWITCH_CLIENT_ID) return json({ error: 'wrong_app' }, 403);
      if (!user.scopes.includes('channel:bot')) return json({ error: 'missing_channel_bot', hint: 'Reconnect Twitch in Steez to allow SteezBot in your channel.' }, 403);
      if (blocked(env, user.userId)) return json({ error: 'channel_blocked' }, 403);
      if (!allow(user.userId)) return json({ error: 'rate_limited' }, 429);

      const body = await request.json().catch(() => null);
      const message = String(body?.message || '')
        .replace(/[\r\n]+/g, ' ')
        .trim()
        .slice(0, 500);
      if (!message) return json({ error: 'empty_message' }, 400);

      const bot = await getBot(env);
      const replyTo = body?.replyTo && /^[\w-]{8,64}$/.test(String(body.replyTo)) ? String(body.replyTo) : undefined;
      const r = await helix(env, 'POST', '/chat/messages', {
        broadcaster_id: user.userId,
        sender_id: bot.id,
        message,
        ...(replyTo ? { reply_parent_message_id: replyTo } : {}),
      });
      const d = r.data?.[0] || {};
      return json({ ok: true, sent: d.is_sent !== false, messageId: d.message_id, dropReason: d.drop_reason?.message || null });
    }

    return json({ error: 'not_found' }, 404);
  } catch (e) {
    return json({ error: 'relay_error', message: String(e?.message || e) }, e?.status === 403 ? 403 : 502);
  }
}

export default { fetch: handle };

/** Test hook: clear the per-isolate caches. */
export function _reset() {
  appToken = null;
  botUser = null;
  validated.clear();
  buckets.clear();
}
