// Twitch Chat page backend: every line is captured and sorted into the right pane.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.STEEZ_BOT_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tbchat-'));
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...a) => realSetInterval(...a).unref();
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (...a) => realSetTimeout(...a).unref?.() ?? realSetTimeout(...a);

const { db } = await import('../src/main/bot/store.js');
const { parseLine } = await import('../src/main/bot/twitch/irc.js');
const { createChatFeed, parseEmoteRanges, classify } = await import('../src/main/bot/chatFeed.js');

const actions = new Map();
const bot = Object.assign(new EventEmitter(), {
  irc: Object.assign(new EventEmitter(), { creds: { login: 'streamer' } }),
  relay: { info: { login: 'steezzzbot' } },
  state: {},
  prefix: '!',
  action: (name, fn) => actions.set(name, fn),
});
let feed;

const esc = (v) => String(v).replace(/;/g, '\\:').replace(/ /g, '\\s');
function say(login, text, tags = {}) {
  const all = { 'display-name': login, id: `m${Math.random()}`, ...tags };
  const m = parseLine(`@${Object.entries(all).map(([k, v]) => `${k}=${esc(v)}`).join(';')} :${login}!x@x PRIVMSG #streamer :${text}`);
  bot.irc.emit('message', { tags: m.tags, login, text: m.trailing });
  return feed.recent.at(-1);
}

before(() => {
  db.auth.broadcaster = { login: 'streamer', clientId: 'x', accessToken: 't', scopes: [] }; // no userId: no emote downloads
  feed = createChatFeed(bot);
});

test('emote ranges come out sorted, with every repeat', () => {
  assert.deepEqual(parseEmoteRanges('25:0-4,12-16/1902:6-10'), [[0, 4, '25'], [6, 10, '1902'], [12, 16, '25']]);
  assert.deepEqual(parseEmoteRanges(''), []);
});

test('lines are sorted into chat, commands, bots, mods and events', () => {
  assert.equal(say('viewer', 'hello there').cat, 'chat');
  assert.equal(say('viewer', '!points').cat, 'command');
  assert.equal(say('steezzzbot', '@viewer you have 10 points').cat, 'bot');
  assert.equal(say('nightbot', 'hi').cat, 'bot'); // on the default ignore list
  assert.equal(say('mandy', 'be nice chat', { badges: 'moderator/1', mod: '1' }).cat, 'mod');
  assert.equal(say('streamer', 'thanks all', { badges: 'broadcaster/1' }).cat, 'mod');
  const cheer = say('viewer', 'Cheer100 hype', { bits: '100' });
  assert.equal(cheer.cat, 'event');
  assert.match(cheer.event.text, /cheered 100 bits/);
  assert.equal(classify({ login: 'x', text: '!so y', badges: [['moderator', '1']], isMod: true }, { botLogins: new Set(), prefix: '!' }), 'command');
});

test('badges, actions, first messages, mentions and replies are kept', () => {
  const a = say('viewer', '\x01ACTION dances\x01', { badges: 'subscriber/12,premium/1', color: '#FF0000', 'first-msg': '1' });
  assert.equal(a.action, true);
  assert.equal(a.text, 'dances');
  assert.equal(a.first, true);
  assert.deepEqual(a.user.badges, [['subscriber', '12'], ['premium', '1']]);
  assert.equal(say('viewer', 'yo @Streamer nice').mention, true);
  assert.equal(say('viewer', 'streamers are cool').mention, false);
  // the "@parent " prefix is removed and the emote positions move with the text
  const r = say('viewer', '@streamer Kappa gg', { 'reply-parent-msg-id': 'p1', 'reply-parent-user-login': 'streamer', 'reply-parent-display-name': 'Streamer', 'reply-parent-msg-body': 'what a play', emotes: '25:10-14' });
  assert.equal(r.text, 'Kappa gg');
  assert.deepEqual(r.emotes, [[0, 4, '25']]);
  assert.equal(r.reply.display, 'Streamer');
});

test('subs, raids, follows and redemptions become events; deletions mark lines', () => {
  const m = parseLine('@msg-id=resub;login=fan;display-name=Fan;msg-param-cumulative-months=7;msg-param-sub-plan=2000;id=n1 :tmi.twitch.tv USERNOTICE #streamer :love it');
  bot.irc.emit('usernotice', { tags: m.tags, text: m.trailing });
  let e = feed.recent.at(-1);
  assert.equal(e.cat, 'event');
  assert.equal(e.event.text, 'Fan subscribed with Tier 2. They\'ve subscribed for 7 months!');
  assert.equal(e.text, 'love it');
  const raid = parseLine('@msg-id=raid;login=big;display-name=Big;msg-param-displayName=Big;msg-param-viewerCount=50 :tmi.twitch.tv USERNOTICE #streamer');
  bot.irc.emit('usernotice', { tags: raid.tags, text: raid.trailing });
  assert.equal(feed.recent.at(-1).event.text, 'Big is raiding with a party of 50.');
  bot.emit('eventsub:channel.follow', { user_name: 'Newbie', user_login: 'newbie' });
  assert.equal(feed.recent.at(-1).event.type, 'follow');
  bot.emit('eventsub:channel.channel_points_custom_reward_redemption.add', { user_name: 'Fan', user_login: 'fan', reward: { title: 'Hydrate', cost: 500 }, user_input: '' });
  assert.match(feed.recent.at(-1).event.text, /redeemed Hydrate \(500\)/);

  const gone = say('troll', 'bad words');
  bot.irc.emit('clearmsg', { tags: { 'target-msg-id': gone.id } });
  assert.equal(gone.deleted, true);
  const later = say('troll', 'more');
  bot.irc.emit('clearchat', { tags: { 'ban-duration': '600' }, login: 'troll' });
  assert.equal(later.deleted, true);
  assert.equal(feed.recent.at(-1).event.text, 'troll has been timed out for 10 minutes.');
});

test("Steez's own lines show up as bot lines, and new views get the backlog", async () => {
  bot.irc.emit('sent', 'Thanks for the follow!');
  const s = feed.recent.at(-1);
  assert.deepEqual([s.cat, s.self, s.text], ['bot', true, 'Thanks for the follow!']);
  const r = await actions.get('chatfeed:recent')();
  assert.ok(r.items.length >= 15);
  assert.ok(r.items.every((it, i) => !i || it.n > r.items[i - 1].n));
});
