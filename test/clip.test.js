// !clip: Steez's own command always runs (an imported copy can't hide it), and new clips
// can be posted in Discord as the video file, or as the link when that isn't possible.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.STEEZ_BOT_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tbclip-'));
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...a) => realSetInterval(...a).unref();

const { bot } = await import('../src/main/bot/core/bot.js');
const { db } = await import('../src/main/bot/store.js');
const { postClipToDiscord, WEBHOOK_RE } = await import('../src/main/bot/discordClip.js');

const WEBHOOK = 'https://discord.com/api/webhooks/123456/abc-DEF_ghi';
const said = [];
bot.on('bot:said', (t) => said.push(t));
const chat = async (text) => {
  said.length = 0;
  await bot.runAction('chat:simulate', { user: 'viewer1', text, level: 'everyone' });
  await new Promise((r) => setTimeout(r, 30));
  return said.join(' || ');
};

// A pretend Twitch + Discord behind fetch.
const realFetch = globalThis.fetch;
const net = { posts: [], downloadsAsked: 0, readyAfter: 1, videoBytes: 2048, helixCalls: [] };
function fakeFetch(url, opts = {}) {
  const u = String(url);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (u.startsWith('https://api.twitch.tv/helix/clips/downloads')) {
    net.helixCalls.push(u);
    net.downloadsAsked++;
    const ready = net.downloadsAsked > net.readyAfter;
    return Promise.resolve(json({ data: [{ clip_id: 'AbcClip', landscape_download_url: ready ? 'https://production.assets.clips.twitchcdn.net/AbcClip.mp4' : null, portrait_download_url: null }] }));
  }
  if (u.startsWith('https://api.twitch.tv/helix/clips')) {
    net.helixCalls.push(u);
    return Promise.resolve(json({ data: [{ id: 'AbcClip', edit_url: 'https://clips.twitch.tv/AbcClip/edit' }] }, 202));
  }
  if (u.startsWith('https://production.assets.clips.twitchcdn.net/')) {
    const buf = new Uint8Array(net.videoBytes).fill(7);
    return Promise.resolve(new Response(buf, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(buf.length) } }));
  }
  if (u.startsWith(WEBHOOK)) {
    net.posts.push({ url: u, body: opts.body });
    return Promise.resolve(json({ id: '1' }));
  }
  return Promise.reject(new Error(`unexpected fetch ${u}`));
}

before(async () => {
  await bot.init();
  for (const n of ['stream', 'commands', 'events', 'hype', 'achievements']) (await import(`../src/main/bot/modules/${n}.js`)).init(bot);
  db.settings.events.firstTimeChatter.enabled = false;
  db.settings.events.returningViewer.enabled = false;
  db.settings.achievements.announce = false;
  globalThis.fetch = fakeFetch;
});
after(() => {
  globalThis.fetch = realFetch;
});

test('a switched-off imported !clip no longer hides Steez’s own !clip', async () => {
  db.commands.clip = { response: '$(urlfetch https://old-bot.example/clip)', enabled: false, createdBy: 'import:nightbot' };
  const found = bot.findCommand('clip');
  assert.equal(found.type, 'builtin');
  // With no Twitch account connected the built-in explains why instead of staying silent.
  assert.match(await chat('!clip'), /Twitch account isn’t connected/);
  // A custom command that is switched on still wins (the streamer chose it).
  db.commands.clip.enabled = true;
  assert.equal(bot.findCommand('clip').type, 'custom');
  delete db.commands.clip;
});

test('!clip makes the clip even when the live flag hasn’t caught up yet', async () => {
  db.auth.broadcaster = { login: 'streamer', userId: '42', accessToken: 'tok', clientId: 'cid', scopes: ['clips:edit', 'channel:manage:clips'] };
  bot.state.live = false;
  bot.cooldowns.clear();
  const out = await chat('!clip');
  assert.match(out, /Clip created by viewer1: https:\/\/clips\.twitch\.tv\/AbcClip/);
  assert.equal(db.clips[0].id, 'AbcClip');
  assert.equal(db.clips[0].by, 'viewer1');
});

test('!clip works with the Chat bot switch off (Steez starts with every switch off)', async () => {
  db.settings.general.botEnabled = false;
  bot.cooldowns.clear();
  assert.match(await chat('!clip'), /Clip created by viewer1/);
  // other chat-bot commands stay quiet while it's off
  assert.equal(await chat('!uptime'), '');
  db.settings.general.botEnabled = true;
});

test('webhook links are recognised', () => {
  assert.ok(WEBHOOK_RE.test(WEBHOOK));
  assert.ok(WEBHOOK_RE.test('https://discordapp.com/api/webhooks/1/x'));
  assert.ok(!WEBHOOK_RE.test('https://evil.example/api/webhooks/1/x'));
  assert.ok(!WEBHOOK_RE.test('https://discord.com/channels/1/2'));
});

const clip = { id: 'AbcClip', url: 'https://clips.twitch.tv/AbcClip', by: 'viewer1' };
const fast = { waitOpts: { tries: 4, every: 5 } };

test('a clip is posted in Discord as the video file once Twitch has made it', async () => {
  Object.assign(db.settings.clips, { discordVideo: true, discordWebhookUrl: WEBHOOK, discordUploadLimit: '10' });
  bot.state.stream = { title: 'Ranked grind', game: 'Valorant' };
  bot.state.channel = 'streamer';
  net.posts.length = 0;
  net.downloadsAsked = 0;
  net.readyAfter = 1; // the first ask comes back "not ready yet"
  const r = await postClipToDiscord(bot, clip, fast);
  assert.deepEqual(r, { sent: 'video' });
  assert.equal(net.posts.length, 1);
  const form = net.posts[0].body;
  assert.ok(form instanceof FormData);
  const payload = JSON.parse(form.get('payload_json'));
  assert.match(payload.content, /\*\*viewer1\*\* clipped this on stream — Ranked grind/);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  const file = form.get('files[0]');
  assert.equal(file.name, 'streamer-clip-AbcClip.mp4');
  assert.equal(file.size, 2048);
  assert.ok(net.helixCalls.some((u) => u.includes('editor_id=42') && u.includes('broadcaster_id=42') && u.includes('clip_id=AbcClip')));
});

test('a clip too big for the server’s upload limit is posted as the link', async () => {
  net.posts.length = 0;
  net.downloadsAsked = 5;
  net.videoBytes = 11 * 1024 * 1024;
  const r = await postClipToDiscord(bot, clip, fast);
  net.videoBytes = 2048;
  assert.equal(r.sent, 'link');
  assert.match(r.note, /11\.0 MB, over your 10 MB/);
  const body = JSON.parse(net.posts[0].body);
  assert.match(body.content, /https:\/\/clips\.twitch\.tv\/AbcClip/);
  assert.ok(!body.content.includes('<https://clips.twitch.tv/AbcClip>'), 'the link keeps its Discord player');
});

test('without the download permission the link is posted and the streamer is told to reconnect', async () => {
  db.auth.broadcaster.scopes = ['clips:edit'];
  net.posts.length = 0;
  const asked = net.downloadsAsked;
  const r = await postClipToDiscord(bot, clip, fast);
  assert.equal(r.sent, 'link');
  assert.match(r.note, /Reconnect your Twitch account/);
  assert.equal(net.downloadsAsked, asked, 'Twitch is not asked for the file');
  db.auth.broadcaster.scopes = ['clips:edit', 'channel:manage:clips'];
});

test('switched off, nothing is posted; a bad webhook link is explained', async () => {
  db.settings.clips.discordVideo = false;
  assert.equal(await postClipToDiscord(bot, clip, fast), null);
  db.settings.clips.discordWebhookUrl = 'https://example.com/hook';
  await assert.rejects(postClipToDiscord(bot, clip, { ...fast, force: true }), /doesn’t look like a Discord webhook/);
  db.settings.clips.discordWebhookUrl = '';
  db.settings.discord.webhookUrl = '';
  await assert.rejects(postClipToDiscord(bot, clip, { ...fast, force: true }), /Add a Discord webhook link/);
});
