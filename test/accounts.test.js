// Import accounts: StreamElements / Streamlabs / CSV data → Steez.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromStreamElements, fromStreamlabs, fromCsv, applyBundle, convertSE, convertSL, morePages, seLevel, classify, summarize } from '../src/main/accounts/convert.js';

const freshDb = () => ({
  users: { alice: { login: 'alice', display: 'Alice', points: 500, watchMinutes: 100 } },
  commands: { discord: { response: 'my discord', level: 'everyone' } },
  timers: [],
  quotes: [{ id: 1, text: 'Already here', date: 1 }],
  counters: { deaths: 3 },
  meta: { quoteSeq: 1 },
  settings: { loyalty: { currencyName: 'points', pointsPerInterval: 10, intervalMinutes: 5, subscriberMultiplier: 2 }, general: { ignoredUsers: [] } },
});

const SE_RAW = {
  channel: 'Streamer',
  loyalty: { loyalty: { name: 'gems', amount: 25, interval: 10, subscriberMultiplier: 3, bonuses: { follow: 50, subscriber: 200, raid: 0 }, ignored: ['StreamElements'] } },
  points: [
    { username: 'alice', points: 300 },
    { username: 'Bob', points: 1200 },
    { username: 'not a login!', points: 9 },
  ],
  watchtime: [
    { username: 'alice', minutes: 600 },
    { username: 'bob', minutes: 30 },
  ],
  commands: [
    { command: 'discord', reply: 'new discord', accessLevel: 100, cooldown: { global: 5, user: 15 }, enabled: true, aliases: [] },
    { command: 'lurk', reply: '${user} is lurking ${random.1-5} ${pointsname}', accessLevel: 100, cooldown: { global: 0, user: 30 }, aliases: ['lurking'], type: 'reply', cost: 10 },
    { command: 'modonly', reply: 'hi mods', accessLevel: 500, cooldown: {}, enabled: false },
    { command: 'points', reply: 'custom points', accessLevel: 100 },
    { command: 'api', reply: '${customapi.https://example.com/x?u=${user}}', accessLevel: 1500 },
  ],
  timers: [{ name: 'Socials', enabled: true, chatLines: 4, messages: ['Follow!', ''], online: { enabled: true, interval: 20 }, offline: { enabled: false, interval: 20 } }],
  quotes: [{ id: 1, text: 'Already here' }, { id: 2, text: 'New quote', createdAt: '2024-01-02T00:00:00Z' }],
  counters: [{ id: 'deaths', count: 1 }, { id: 'wins', count: 7 }],
};

test('StreamElements data becomes a Steez bundle', () => {
  const b = fromStreamElements(SE_RAW);
  assert.equal(b.users.length, 2, 'invalid usernames are dropped');
  const bob = b.users.find((u) => u.login === 'bob');
  assert.deepEqual([bob.points, bob.minutes, bob.display], [1200, 30, 'Bob']);
  assert.equal(b.users.find((u) => u.login === 'alice').minutes, 600);
  const lurk = b.commands.find((c) => c.name === 'lurk');
  assert.equal(lurk.response, '${user} is lurking ${random.1-5} ${currency}');
  assert.deepEqual(lurk.aliases, ['lurking']);
  assert.equal(lurk.replyType, 'reply');
  assert.equal(lurk.userCooldown, 30);
  assert.equal(lurk.cost, 10);
  assert.equal(b.commands.find((c) => c.name === 'modonly').level, 'moderator');
  assert.equal(b.commands.find((c) => c.name === 'modonly').enabled, false);
  assert.equal(b.commands.find((c) => c.name === 'api').response, '${customapi https://example.com/x?u=${user}}');
  assert.equal(b.timers[0].intervalMinutes, 20);
  assert.deepEqual(b.timers[0].messages, ['Follow!']);
  assert.equal(b.timers[0].onlineOnly, true);
  assert.equal(b.loyalty.currencyName, 'gems');
  assert.deepEqual(b.loyalty.ignored, ['streamelements']);
  assert.equal(b.counters.wins, 7);
  assert.equal(summarize(b).points, 1500);
});

test('access levels', () => {
  assert.deepEqual([100, 250, 300, 400, 500, 1000, 1500].map(seLevel), ['everyone', 'subscriber', 'regular', 'vip', 'moderator', 'moderator', 'broadcaster']);
});

test('applying: keep-the-higher points, keep Steez commands, built-ins switched off, no duplicate quotes', () => {
  const db = freshDb();
  const b = fromStreamElements(SE_RAW);
  const r = applyBundle(db, b, { builtins: ['points', 'commands'] });
  assert.equal(db.users.alice.points, 500, 'Steez already had more');
  assert.equal(db.users.alice.watchMinutes, 600);
  assert.equal(db.users.bob.points, 1200);
  assert.deepEqual(r.users, { added: 1, updated: 1 });
  assert.equal(db.commands.discord.response, 'my discord', 'existing Steez command kept');
  assert.equal(r.commands.kept, 1);
  assert.equal(db.commands.points.enabled, false, 'clashes with a built-in come in switched off');
  assert.deepEqual(r.commands.off, ['points']);
  assert.equal(db.commands.lurk.createdBy, 'import:streamelements');
  assert.equal(db.timers.length, 1);
  assert.equal(db.quotes.length, 2);
  assert.equal(db.quotes[1].id, 2);
  assert.equal(db.counters.deaths, 3);
  assert.equal(db.counters.wins, 7);
  assert.equal(db.settings.loyalty.currencyName, 'gems');
  assert.equal(db.settings.loyalty.pointsPerInterval, 25);
  assert.deepEqual(db.settings.general.ignoredUsers, ['streamelements']);

  // Running it again changes nothing (no doubled points, timers or quotes)
  const again = applyBundle(db, b, { builtins: ['points'] });
  assert.equal(db.users.bob.points, 1200);
  assert.equal(db.timers.length, 1);
  assert.equal(db.quotes.length, 2);
  assert.equal(again.timers, 0);
});

test('applying: add, replace, overwrite and skip', () => {
  const b = fromStreamElements(SE_RAW);
  let db = freshDb();
  applyBundle(db, b, { points: 'add', commands: 'overwrite', timers: false, quotes: false, counters: false, loyaltySettings: false });
  assert.equal(db.users.alice.points, 800);
  assert.equal(db.commands.discord.response, 'new discord');
  assert.equal(db.timers.length, 0);
  assert.equal(db.settings.loyalty.currencyName, 'points');
  db = freshDb();
  applyBundle(db, b, { points: 'replace', commands: 'skip' });
  assert.equal(db.users.alice.points, 300);
  assert.equal(db.commands.lurk, undefined);
  db = freshDb();
  applyBundle(db, b, { points: 'skip' });
  assert.equal(db.users.bob, undefined);
});

test('Streamlabs variables', () => {
  assert.equal(convertSL('{user.name} hugs {touser.name} {random.1-10} {readapi.https://a.b/c}'), '${user} hugs ${touser} ${random.1-10} ${customapi https://a.b/c}');
  assert.equal(convertSL('$user has $points $currencyname, roll $randnum(1,6) $readapi(https://x.y)'), '${user} has ${points} ${currency}, roll ${random.1-6} ${customapi https://x.y}');
  assert.equal(convertSL('literal {braces} and $5 stay'), 'literal {braces} and $5 stay');
  assert.equal(convertSE('${user.name} ${touser.name} ${queryescape ${1:}}'), '${user} ${touser} ${urlencode ${1:}}');
});

test('Streamlabs: records are recognised from what the dashboard loads', () => {
  const captures = [
    { url: 'https://streamlabs.com/api/v5/cloudbot/loyalty?page=1', json: { cloudbot: { current_page: 1, last_page: 3, data: [{ points: 900, time: 1200, viewer: { name: 'Carol', platform_id: '1' } }, { points: 5, time: 1, viewer: { name: 'dave' } }] } } },
    { url: 'https://streamlabs.com/api/v5/cloudbot/commands?page=1', json: { data: [{ command: '!socials', response: 'Follow {user}!', permission: 'Moderator', cooldowns: { global: 10, user: 0 }, enabled: true }] } },
    { url: 'https://streamlabs.com/api/v5/cloudbot/timers', json: [{ name: 'Hydrate', message: 'Drink water', interval: 15, lines: 5, enabled: true }] },
    { url: 'https://streamlabs.com/api/v5/cloudbot/quotes', json: { quotes: [{ id: 1, custom_id: 1, quote: 'Quote one', game: 'Chess', created_at: '2023-05-01' }] } },
    { url: 'https://streamlabs.com/api/v5/user', json: { display_name: 'Streamer' } },
  ];
  const b = fromStreamlabs(captures);
  assert.equal(b.users.length, 2);
  assert.equal(b.users.find((u) => u.login === 'carol').minutes, 1200);
  assert.equal(b.commands.length, 1);
  assert.equal(b.commands[0].name, 'socials');
  assert.equal(b.commands[0].response, 'Follow ${user}!');
  assert.equal(b.commands[0].level, 'moderator');
  assert.equal(b.commands[0].cooldown, 10);
  assert.equal(b.timers.length, 1);
  assert.equal(b.timers[0].intervalMinutes, 15);
  assert.equal(b.quotes.length, 1);
  assert.equal(b.quotes[0].game, 'Chess');
  assert.equal(classify({ points: 1, viewer: { name: 'x' } }, 'https://x/loyalty'), 'points');
  assert.deepEqual(morePages(captures[0].url, captures[0].json), ['https://streamlabs.com/api/v5/cloudbot/loyalty?page=2', 'https://streamlabs.com/api/v5/cloudbot/loyalty?page=3']);
  assert.deepEqual(morePages('https://streamlabs.com/api/v5/cloudbot/loyalty?page=2', { last_page: 3, current_page: 2 }), []);
});

test('CSV: with and without a header', () => {
  const a = fromCsv('Username,Points,Hours\nalice,100,2\nBob,50,0.5\n');
  assert.deepEqual(a.users.map((u) => [u.login, u.points, u.minutes]), [['alice', 100, 120], ['bob', 50, 30]]);
  const se = fromCsv('carol,123456,900,1500,4000\ndave,1,5,10,20');
  assert.deepEqual(se.users.map((u) => [u.login, u.points, u.minutes]), [['carol', 900, 4000], ['dave', 5, 20]]);
  const two = fromCsv('erin;42');
  assert.deepEqual(two.users.map((u) => [u.login, u.points]), [['erin', 42]]);
});
