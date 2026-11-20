// The relay's casino routes (with a fake Twitch API and a fake channel hub), and the channel hub
// passing a viewer's bet to the streamer's Steez and the answer back.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handle, _reset } from '../relay/src/index.js';
import { ChannelHub } from '../relay/src/mods.js';

const hubCalls = [];
const env = {
  TWITCH_CLIENT_ID: 'cid',
  TWITCH_CLIENT_SECRET: 'secret',
  BOT_LOGIN: 'steezbot',
  ASSETS: {
    async fetch(req) {
      const p = new URL(req.url).pathname;
      if (p === '/index.html') return new Response('<script>__CLIENT_ID__|__BASE__|__AUTHORIZE__</script>');
      if (p === '/app.js') return new Response('// app', { headers: { 'content-type': 'text/javascript' } });
      return new Response('missing', { status: 404 });
    },
  },
  HUB: {
    idFromName: (n) => n,
    get: (id) => ({
      async fetch(u, init) {
        const p = new URL(String(u)).pathname;
        if (p === '/status') return Response.json(id === '500' ? { online: true, info: { casino: { title: 'Lucky' } } } : { online: id === '501', info: {} });
        hubCalls.push({ id, path: p, body: JSON.parse(init.body) });
        return Response.json({ ok: true, result: { balance: 7 } });
      },
    }),
  },
};

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const reply = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (u.startsWith('https://id.twitch.tv/oauth2/token')) return reply({ access_token: 'app', expires_in: 3600 });
  if (u.startsWith('https://id.twitch.tv/oauth2/validate')) {
    const t = opts.headers.Authorization.replace('OAuth ', '');
    if (t === 'viewer') return reply({ user_id: '9', login: 'viewer', client_id: 'cid', scopes: [] });
    if (t === 'otherapp') return reply({ user_id: '9', login: 'viewer', client_id: 'nope', scopes: [] });
    return reply({}, 401);
  }
  if (u.startsWith('https://api.twitch.tv/helix/users')) {
    const login = new URL(u).searchParams.get('login');
    const ids = { streamer: '500', offcasino: '501', viewer: '9' };
    return reply({ data: ids[login] ? [{ id: ids[login], login, display_name: login.toUpperCase(), profile_image_url: 'https://img/x.png' }] : [] });
  }
  throw new Error('unexpected fetch ' + u);
};

const req = (path, { method = 'GET', body, token, host = 'relay.test' } = {}) =>
  handle(new Request(`https://${host}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);

beforeEach(() => {
  _reset();
  hubCalls.length = 0;
});

async function login() {
  const r = await req('/casino/api/session', { method: 'POST', body: { token: 'viewer' } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.user.display, 'VIEWER');
  return j.session;
}

test('the casino page and its files are served under /casino', async () => {
  const page = await req('/casino/streamer');
  assert.equal(page.status, 200);
  assert.equal(await page.text(), '<script>cid|/casino|https://id.twitch.tv/oauth2/authorize</script>');
  assert.equal((await req('/casino')).status, 200);
  assert.equal((await req('/casino/auth')).status, 200);
  const js = await req('/casino/static/app.js');
  assert.equal(js.status, 200);
  assert.equal(js.headers.get('cache-control'), 'no-cache');
  assert.equal((await req('/casino/static/../secret.js')).status, 404);
  assert.equal((await req('/casino/a/b')).status, 404);
  // the relay's own routes still work
  assert.equal((await req('/')).status, 200);
});

test('with a custom domain the casino lives at its root', async () => {
  env.CASINO_HOST = 'casino.example';
  try {
    const page = await req('/streamer', { host: 'casino.example' });
    assert.equal(await page.text(), '<script>cid||https://id.twitch.tv/oauth2/authorize</script>');
    assert.equal((await req('/static/app.js', { host: 'casino.example' })).status, 200);
    // the relay's own casino pages and www move to the domain; the API stays where it was
    const moved = await req('/casino/streamer?x=1');
    assert.equal(moved.status, 301);
    assert.equal(moved.headers.get('location'), 'https://casino.example/streamer?x=1');
    const www = await req('/streamer/', { host: 'www.casino.example' });
    assert.equal(www.headers.get('location'), 'https://casino.example/streamer/');
    assert.equal((await req('/streamer/', { host: 'casino.example' })).status, 200); // trailing slash is fine
    assert.equal((await req('/casino/api/channel?login=streamer')).status, 200);
    assert.equal((await req('/', { host: 'casino.example' })).status, 200); // pick-a-channel page
  } finally {
    delete env.CASINO_HOST;
  }
});

test('login checks the Twitch token and the app it came from', async () => {
  assert.equal((await req('/casino/api/session', { method: 'POST', body: { token: 'bogus' } })).status, 401);
  assert.equal((await req('/casino/api/session', { method: 'POST', body: { token: 'otherapp' } })).status, 403);
  await login();
});

test('a channel is open only while its Steez has the casino on', async () => {
  const open = await (await req('/casino/api/channel?login=Streamer')).json();
  assert.deepEqual([open.id, open.open, open.title, open.display], ['500', true, 'Lucky', 'STREAMER']);
  const off = await (await req('/casino/api/channel?login=offcasino')).json();
  assert.deepEqual([off.online, off.open], [true, false]);
  assert.equal((await req('/casino/api/channel?login=nobodyhere')).status, 404);
  assert.equal((await req('/casino/api/channel?login=bad name')).status, 400);
});

test('bets carry the verified viewer to the channel hub', async () => {
  const session = await login();
  assert.equal((await req('/casino/api/call', { method: 'POST', body: { channelId: '500', action: 'info' } })).status, 401);
  assert.equal((await req('/casino/api/call', { method: 'POST', token: 'forged.sig', body: { channelId: '500', action: 'info' } })).status, 401);
  const r = await req('/casino/api/call', { method: 'POST', token: session, body: { channelId: '500', action: 'bet', args: { game: 'dice', bet: 10 }, user: { login: 'someoneelse' } } });
  assert.deepEqual(await r.json(), { ok: true, result: { balance: 7 } });
  assert.deepEqual(hubCalls[0], { id: '500', path: '/casino', body: { action: 'bet', args: { game: 'dice', bet: 10 }, user: { id: '9', login: 'viewer', display: 'VIEWER' } } });
  assert.equal((await req('/casino/api/call', { method: 'POST', token: session, body: { channelId: '500', action: 'points.adjust' } })).status, 400);
  assert.equal((await req('/casino/api/call', { method: 'POST', token: session, body: { channelId: 'x', action: 'info' } })).status, 400);
  // a mod-panel session can't be used here
  let limited = 0;
  for (let i = 0; i < 30; i++) if ((await req('/casino/api/call', { method: 'POST', token: session, body: { channelId: '500', action: 'info' } })).status === 429) limited++;
  assert.ok(limited > 0, 'rate limit kicks in');
});

test('the hub passes casino requests to Steez and returns its answer', async () => {
  const sent = [];
  const ws = { send: (m) => sent.push(JSON.parse(m)), deserializeAttachment: () => ({}), serializeAttachment() {} };
  const hub = new ChannelHub({ getWebSockets: () => [ws] }, env);
  const pending = hub.fetch(new Request('https://hub/casino', { method: 'POST', body: JSON.stringify({ action: 'bet', args: { game: 'mines' }, user: { login: 'viewer' } }) }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sent[0].type, 'casino');
  assert.deepEqual(sent[0].user, { login: 'viewer' });
  await hub.webSocketMessage(ws, JSON.stringify({ type: 'reply', id: sent[0].id, ok: false, error: 'You only have 5 points.' }));
  const r = await pending;
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'You only have 5 points.');
  // hello keeps the casino title for the status check
  let att = null;
  const ws2 = { ...ws, serializeAttachment: (a) => (att = a) };
  await hub.webSocketMessage(ws2, JSON.stringify({ type: 'hello', info: { name: 'S', casino: { title: 'My Casino' } } }));
  assert.deepEqual(att.info.casino, { title: 'My Casino' });
});
