// Web casino backend.
//  • The site lives at <relay>/casino/<channel>, or at https://<CASINO_HOST>/<channel> once a
//    custom domain points at this worker.
//  • Viewers log in with Twitch (identity only, no permissions asked). We check the login with
//    Twitch and hand back a signed session.
//  • Every bet goes to that channel's ChannelHub, which passes it to the streamer's Steez. Steez
//    holds the points and rolls the dice; nothing about the games is stored here.

const SESSION_DAYS = 7;
const RATE = 25; // casino requests per viewer per 10 seconds
const rateBuckets = new Map();
const channelCache = new Map(); // login → { id, login, display, avatar, exp }
const RESERVED = new Set(['api', 'auth', 'static', 'casino']);

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
let keyCache = null;
async function hmacKey(env) {
  if (keyCache?.secret === env.TWITCH_CLIENT_SECRET) return keyCache.key;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`steez-casino-session:${env.TWITCH_CLIENT_SECRET}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  keyCache = { secret: env.TWITCH_CLIENT_SECRET, key };
  return key;
}
async function sign(env, payload) {
  const body = b64u(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64u(await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(body)));
  return `${body}.${sig}`;
}
async function readSession(env, request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(env), fromB64u(sig), new TextEncoder().encode(body)))) return null;
    const s = JSON.parse(new TextDecoder().decode(fromB64u(body)));
    return s.kind === 'casino' && s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

function allow(id) {
  const now = Date.now();
  const list = (rateBuckets.get(id) || []).filter((t) => now - t < 10_000);
  const ok = list.length < RATE;
  if (ok) list.push(now);
  rateBuckets.set(id, list);
  if (rateBuckets.size > 20000) rateBuckets.clear();
  return ok;
}

const hub = (env, id) => env.HUB.get(env.HUB.idFromName(String(id)));

/** The casino's public address: the custom domain when there is one, else <this host>/casino. */
export function casinoUrl(env, url) {
  // CASINO_URL: the public address when the site is hosted elsewhere (e.g. on Vercel, proxying here).
  if (env.CASINO_URL && /^https:\/\/[^\s/]+$/.test(env.CASINO_URL)) return env.CASINO_URL;
  return env.CASINO_HOST ? `https://${env.CASINO_HOST}` : `${url.origin}/casino`;
}

async function lookupChannel(env, helix, login) {
  const hit = channelCache.get(login);
  if (hit && hit.exp > Date.now()) return hit;
  const j = await helix(env, 'GET', `/users?login=${encodeURIComponent(login)}`);
  const u = j.data?.[0];
  const c = u ? { id: u.id, login: u.login, display: u.display_name, avatar: u.profile_image_url, exp: Date.now() + 10 * 60_000 } : { missing: true, exp: Date.now() + 60_000 };
  if (channelCache.size > 5000) channelCache.clear();
  channelCache.set(login, c);
  return c;
}

async function page(env, url, base) {
  const r = env.ASSETS ? await env.ASSETS.fetch(new Request(new URL('/index.html', url.origin))) : null;
  if (!r || !r.ok) return json({ error: 'casino_site_missing' }, 500);
  const html = (await r.text())
    .replaceAll('__CLIENT_ID__', env.TWITCH_CLIENT_ID)
    .replaceAll('__BASE__', base)
    .replaceAll('__AUTHORIZE__', env.TWITCH_AUTHORIZE_URL || 'https://id.twitch.tv/oauth2/authorize');
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' },
  });
}

/** Returns a Response for casino routes, or null if the request isn't for the casino. */
export async function handleCasino(request, env, url, { validateUser, helix }) {
  const host = String(env.CASINO_HOST || '').toLowerCase();
  if (host && url.hostname === `www.${host}`) return Response.redirect(`https://${host}${url.pathname}${url.search}`, 301);
  const custom = !!host && url.hostname === host;
  let p = url.pathname;
  if (!custom) {
    if (p !== '/casino' && !p.startsWith('/casino/')) return null;
    p = p.slice('/casino'.length) || '/';
    // With a domain set up, the relay's own casino pages move there, so every viewer has one
    // address (and one login). The API stays here for anything still calling it.
    if (host && request.method === 'GET' && !p.startsWith('/static/') && !p.startsWith('/api/')) return Response.redirect(`https://${host}${p}${url.search}`, 301);
  }
  const base = custom ? '' : '/casino';

  // Static files: scripts, styles, sounds.
  if (request.method === 'GET' && p.startsWith('/static/')) {
    const file = p.slice('/static/'.length);
    if (!/^[\w-]+(\/[\w-]+)*\.(js|css|svg|png|webp|mp3|woff2)$/.test(file) || !env.ASSETS) return json({ error: 'not_found' }, 404);
    const r = await env.ASSETS.fetch(new Request(new URL(`/${file}`, url.origin)));
    const out = new Response(r.body, r);
    out.headers.set('cache-control', 'no-cache'); // always check for a newer copy, so a deploy never mixes old and new files
    return out;
  }

  // Log in: swap a Twitch token for a casino session. The token is checked, then forgotten.
  if (request.method === 'POST' && p === '/api/session') {
    const { token } = (await request.json().catch(() => ({}))) || {};
    const user = token && (await validateUser(String(token)));
    if (!user) return json({ error: 'Twitch didn’t accept that login. Try again.' }, 401);
    if (user.clientId !== env.TWITCH_CLIENT_ID) return json({ error: 'wrong_app' }, 403);
    let display = user.login;
    let avatar = null;
    try {
      const me = await lookupChannel(env, helix, user.login);
      if (!me.missing) ({ display, avatar } = me);
    } catch {
      /* the plain login is fine */
    }
    const session = await sign(env, { kind: 'casino', uid: user.userId, login: user.login, display, avatar, exp: Date.now() + SESSION_DAYS * 86400_000 });
    return json({ session, user: { id: user.userId, login: user.login, display, avatar } });
  }

  // Is this channel's casino open? (Its Steez has to be running.)
  if (request.method === 'GET' && p === '/api/channel') {
    const login = String(url.searchParams.get('login') || '').toLowerCase();
    if (!/^[a-z0-9_]{1,25}$/.test(login)) return json({ error: 'That isn’t a Twitch channel name.' }, 400);
    const c = await lookupChannel(env, helix, login);
    if (c.missing) return json({ error: 'There’s no Twitch channel with that name.' }, 404);
    const st = await hub(env, c.id)
      .fetch('https://hub/status')
      .then((r) => r.json())
      .catch(() => ({ online: false }));
    return json({ id: c.id, login: c.login, display: c.display, avatar: c.avatar, online: !!st.online, open: !!(st.online && st.info?.casino), title: st.info?.casino?.title || '' });
  }

  if (request.method === 'POST' && p === '/api/call') {
    const s = await readSession(env, request);
    if (!s) return json({ error: 'session_expired' }, 401);
    if (!allow(s.uid)) return json({ error: 'Slow down a little.' }, 429);
    const body = await request.json().catch(() => null);
    const channelId = String(body?.channelId || '');
    if (!/^\d{1,20}$/.test(channelId)) return json({ error: 'Pick a channel first.' }, 400);
    const action = String(body?.action || '');
    if (!['info', 'bet', 'move'].includes(action)) return json({ error: 'Bad action' }, 400);
    const args = body.args && typeof body.args === 'object' ? body.args : {};
    if (JSON.stringify(args).length > 4000) return json({ error: 'Too much in one bet.' }, 400);
    return hub(env, channelId).fetch('https://hub/casino', {
      method: 'POST',
      body: JSON.stringify({ action, args, user: { id: s.uid, login: s.login, display: s.display } }),
    });
  }

  if (request.method === 'GET') {
    const m = /^\/([A-Za-z0-9_]{1,25})?\/?$/.exec(p);
    if (m && (!m[1] || !RESERVED.has(m[1].toLowerCase()) || m[1] === 'auth')) return page(env, url, base);
    if (p === '/auth' || p === '/auth/') return page(env, url, base);
  }
  return json({ error: 'not_found' }, 404);
}

/** Test hook. */
export function _resetCasino() {
  rateBuckets.clear();
  channelCache.clear();
  keyCache = null;
}
