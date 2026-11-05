// Tests for the SteezBot relay worker with a fake Twitch API.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handle, _reset } from '../relay/src/index.js';

const env = { TWITCH_CLIENT_ID: 'cid', TWITCH_CLIENT_SECRET: 'secret', BOT_LOGIN: 'SteezBot', BLOCKED_CHANNELS: '666' };
const USERS = {
  good: { user_id: '100', login: 'streamer', client_id: 'cid', scopes: ['chat:read', 'channel:bot'] },
  noscope: { user_id: '101', login: 'old', client_id: 'cid', scopes: ['chat:read'] },
  otherapp: { user_id: '102', login: 'x', client_id: 'someoneelse', scopes: ['channel:bot'] },
  banned: { user_id: '666', login: 'spammer', client_id: 'cid', scopes: ['channel:bot'] },
};
let sent = [];

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (u.startsWith('https://id.twitch.tv/oauth2/token')) return reply({ access_token: 'app-token', expires_in: 3600 });
  if (u.startsWith('https://id.twitch.tv/oauth2/validate')) {
    const token = opts.headers.Authorization.replace('OAuth ', '');
    return USERS[token] ? reply(USERS[token]) : reply({ message: 'invalid' }, 401);
  }
  if (u.startsWith('https://api.twitch.tv/helix/users')) {
    assert.equal(opts.headers.Authorization, 'Bearer app-token');
    return reply({ data: [{ id: '999', login: 'steezbot', display_name: 'SteezBot' }] });
  }
  if (u.startsWith('https://api.twitch.tv/helix/chat/messages')) {
    sent.push(JSON.parse(opts.body));
    return reply({ data: [{ message_id: 'm1', is_sent: true }] });
  }
  throw new Error('unexpected fetch ' + u);
};

const say = (token, body) =>
  handle(new Request('https://relay/v1/say', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }), env);

beforeEach(() => {
  _reset();
  sent = [];
});

test('status reports the bot account', async () => {
  const r = await handle(new Request('https://relay/v1/status'), env);
  assert.deepEqual((await r.json()).bot, { id: '999', login: 'steezbot', display: 'SteezBot' });
});

test('sends as SteezBot into the caller’s own channel', async () => {
  const r = await say('good', { message: '  hello\nchat  ', replyTo: 'abc12345-reply' });
  assert.equal(r.status, 200);
  assert.deepEqual(sent[0], { broadcaster_id: '100', sender_id: '999', message: 'hello chat', reply_parent_message_id: 'abc12345-reply' });
});

test('rejects missing, invalid and foreign tokens', async () => {
  assert.equal((await say(null, { message: 'x' })).status, 401);
  assert.equal((await say('nope', { message: 'x' })).status, 401);
  assert.equal((await say('otherapp', { message: 'x' })).status, 403);
  assert.equal(sent.length, 0);
});

test('asks for a reconnect when channel:bot was not granted', async () => {
  const r = await say('noscope', { message: 'x' });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, 'missing_channel_bot');
});

test('blocked channels and rate limits', async () => {
  assert.equal((await say('banned', { message: 'x' })).status, 403);
  for (let i = 0; i < 20; i++) assert.equal((await say('good', { message: `m${i}` })).status, 200);
  assert.equal((await say('good', { message: 'one too many' })).status, 429);
  assert.equal(sent.length, 20);
});

test('setup redirects the bot owner to Twitch consent', async () => {
  const r = await handle(new Request('https://relay/setup'), env);
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.searchParams.get('client_id'), 'cid');
  assert.match(loc.searchParams.get('scope'), /user:bot/);
});
