// Local preview of the web casino: the real relay worker code and the real Steez casino engine,
// wired together on this PC with a pretend Twitch login. Nothing here talks to Twitch.
//   node scripts/casino-dev.mjs  →  http://127.0.0.1:8790/casino/devchannel
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8790);
process.env.STEEZ_BOT_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-dev-'));

const { db } = await import('../src/main/bot/store.js');
const { bot } = await import('../src/main/bot/core/bot.js');
const { casinoCall } = await import('../src/main/bot/casino/service.js');
bot.say = async (t) => console.log('[chat]', t);
db.settings.casino.enabled = true; // off by default in Steez; the preview is the casino
for (const [login, pts] of [['viewer1', 50000], ['viewer2', 2000], ['bigspender', 1_000_000]]) {
  db.users[login] = { login, display: login, points: pts, stats: {}, achievements: {} };
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const reply = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (u.startsWith('https://id.twitch.tv/oauth2/token')) return reply({ access_token: 'app', expires_in: 3600 });
  if (u.startsWith('https://id.twitch.tv/oauth2/validate')) {
    const tok = String(opts.headers?.Authorization || '').replace('OAuth ', '');
    const m = /^dev-([a-z0-9_]{1,25})$/.exec(tok);
    return m ? reply({ user_id: String(1000 + m[1].length), login: m[1], client_id: 'dev', scopes: [] }) : reply({}, 401);
  }
  if (u.startsWith('https://api.twitch.tv/helix/users')) {
    const login = new URL(u).searchParams.get('login');
    return reply({ data: [{ id: login === 'devchannel' ? '42' : String(1000 + login.length), login, display_name: login === 'devchannel' ? 'DevChannel' : login, profile_image_url: '' }] });
  }
  return realFetch(url, opts);
};

const { handle } = await import('../relay/src/index.js');
const site = path.join(root, 'relay', 'casino-site');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const env = {
  TWITCH_CLIENT_ID: 'dev',
  TWITCH_CLIENT_SECRET: 'dev-secret',
  BOT_LOGIN: 'steezbot',
  TWITCH_AUTHORIZE_URL: `http://127.0.0.1:${PORT}/dev-authorize`,
  ASSETS: {
    async fetch(req) {
      const file = path.join(site, decodeURIComponent(new URL(req.url).pathname));
      if (!file.startsWith(site) || !fs.existsSync(file)) return new Response('nope', { status: 404 });
      return new Response(fs.readFileSync(file), { headers: { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' } });
    },
  },
  HUB: {
    idFromName: (n) => n,
    get: () => ({
      async fetch(u, init) {
        const p = new URL(String(u)).pathname;
        if (p === '/status') return Response.json({ online: true, info: { casino: { title: '' } } });
        if (p === '/casino') {
          const b = JSON.parse(init.body);
          try {
            return Response.json({ ok: true, result: casinoCall(b.action, b.args, b.user) });
          } catch (e) {
            if (!e.user) console.error(e);
            return Response.json({ ok: false, error: e.user ? e.message : 'Something went wrong in the casino. Try again.' }, { status: 400 });
          }
        }
        return Response.json({ error: 'not_found' }, { status: 404 });
      },
    }),
  },
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname === '/dev-authorize') {
      const back = url.searchParams.get('redirect_uri');
      const state = url.searchParams.get('state');
      const as = url.searchParams.get('as');
      if (as) {
        res.writeHead(302, { location: `${back}#access_token=dev-${as}&state=${state}` });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<body style="font:16px system-ui;background:#111;color:#eee;padding:40px">Pretend Twitch login (dev only):<ul>${['viewer1', 'viewer2', 'bigspender', 'newbie'].map((l) => `<li><a style="color:#a78bfa" href="?${new URLSearchParams({ redirect_uri: back, state, as: l })}">${l}</a></li>`).join('')}</ul></body>`);
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await handle(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  })
  .listen(PORT, '127.0.0.1', () => console.log(`Casino preview: http://127.0.0.1:${PORT}/casino/devchannel`));
