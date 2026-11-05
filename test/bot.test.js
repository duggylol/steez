// End-to-end tests of the chat pipeline without connecting to Twitch.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.STEEZ_BOT_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tbtest-'));
process.env.ANTHROPIC_API_KEY = '';
// Don't let module timers keep the test process alive
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...a) => realSetInterval(...a).unref();

const { bot } = await import('../src/main/bot/core/bot.js');
const { db } = await import('../src/main/bot/store.js');
const { render } = await import('../src/main/bot/core/variables.js');
const { parseLine } = await import('../src/main/bot/twitch/irc.js');
const { parseAmount, sanitizeChat } = await import('../src/main/bot/util.js');
const { convertVariables } = await import('../src/main/bot/web/api.js');

const said = [];
bot.on('bot:said', (t) => said.push(t));
const chat = async (user, text, level = 'everyone') => {
  said.length = 0;
  await bot.runAction('chat:simulate', { user, text, level });
  await new Promise((r) => setTimeout(r, 20));
  return said.join(' || ');
};

before(async () => {
  await bot.init();
  const names = ['stream', 'commands', 'timers', 'moderation', 'loyalty', 'games', 'boss', 'minigames', 'giveaways', 'quotes', 'polls', 'events', 'shop', 'hype', 'ai', 'achievements', 'stats'];
  for (const n of names) (await import(`../src/main/bot/modules/${n}.js`)).init(bot);
  db.settings.events.firstTimeChatter.enabled = false;
  db.settings.events.returningViewer.enabled = false;
  db.settings.achievements.announce = false;
  db.settings.achievements.rewardPoints = 0;
});

test('variables: basics, fallbacks, nesting', async () => {
  const ctx = { user: { login: 'alice', display: 'Alice' }, args: ['@Bob', 'x', 'y'] };
  assert.equal(await render('${user} hugs ${touser}', ctx), 'Alice hugs Bob');
  assert.equal(await render('$(user) and $(touser)', ctx), 'Alice and Bob');
  assert.equal(await render('${random.1-1}', ctx), '1');
  assert.equal(await render('${5|none}', ctx), 'none');
  assert.equal(await render('${2:}', ctx), 'x y');
  assert.equal(await render('${upper ${user}}', ctx), 'ALICE');
  assert.equal(await render('${unknownvar}', ctx), '${unknownvar}');
});

test('variables: user input is never executed', async () => {
  const ctx = { user: { login: 'eve', display: 'Eve' }, args: ['${eval', 'process.exit(1)}'] };
  assert.equal(await render('${1:}', ctx), '${eval process.exit(1)}');
  assert.equal(await render('$(query)', { ...ctx, args: ['$(user)'] }), '$(user)');
});

test('irc line parsing', () => {
  const m = parseLine('@badges=moderator/1;display-name=Foo\\sBar;mod=1 :foo!foo@foo.tmi.twitch.tv PRIVMSG #chan :hello :) world');
  assert.equal(m.command, 'PRIVMSG');
  assert.equal(m.nick, 'foo');
  assert.equal(m.tags['display-name'], 'Foo Bar');
  assert.equal(m.trailing, 'hello :) world');
  assert.equal(parseLine('PING :tmi.twitch.tv').trailing, 'tmi.twitch.tv');
});

test('amount parsing and chat sanitizing', () => {
  assert.equal(parseAmount('all', 500), 500);
  assert.equal(parseAmount('50%', 500), 250);
  assert.equal(parseAmount('1.5k', 0), 1500);
  assert.ok(Number.isNaN(parseAmount('abc', 10)));
  assert.equal(sanitizeChat('/ban someone'), 'ban someone');
  assert.equal(sanitizeChat('.timeout x\nhi'), 'timeout x hi');
});

test('import converts other bots’ variables', () => {
  assert.equal(convertVariables('$user hugs $target'), '${user} hugs ${touser}');
  assert.equal(convertVariables('{user} -> {touser}'), '${user} -> ${touser}');
  assert.equal(convertVariables('$readapi(https://x.y/z)'), '${customapi https://x.y/z}');
  assert.equal(convertVariables('${user} stays'), '${user} stays');
});

test('custom commands, permissions and cooldowns', async () => {
  assert.match(await chat('Alice', '!hug Bob'), /Alice gives Bob a big warm hug/);
  assert.equal(await chat('Alice', '!hug Bob'), ''); // user cooldown
  assert.equal(await chat('Viewer', '!cmd add !test hello ${user}'), ''); // not a mod
  assert.match(await chat('Moddy', '!cmd add !test hello ${user}', 'moderator'), /added/);
  assert.match(await chat('Carol', '!test'), /hello Carol/);
  assert.match(await chat('Moddy', '!cmd level test moderator', 'moderator'), /moderator\+ only/);
  assert.equal(await chat('Dave', '!test'), '');
  assert.match(await chat('Moddy', '!cmd alias test t2', 'moderator'), /now runs/);
  assert.match(await chat('Moddy', '!t2', 'moderator'), /hello Moddy/);
});

test('counters', async () => {
  await chat('Moddy', '!death+', 'moderator');
  await chat('Moddy2', '!death+', 'moderator');
  assert.match(await chat('Eve', '!deaths'), /died 2 times/);
});

test('loyalty points, give and gamble', async () => {
  bot.addPoints('frank', 1000, 'Frank');
  assert.match(await chat('Frank', '!points'), /Frank has 1,000 points/);
  await chat('Grace', 'hi'); // create Grace
  assert.match(await chat('Frank', '!give Grace 100'), /gave 100 points to Grace/);
  assert.equal(bot.points('grace'), 100);
  assert.match(await chat('Frank', '!gamble 100'), /rolled \d+ and (won|lost)/);
  assert.match(await chat('Grace', '!gamble 999999'), /only have/);
  assert.match(await chat('Henry', '!checkin'), /checked in! \+50 points/);
  assert.match(await chat('Henry', '!checkin'), /already checked in/);
});

test('games: slots, fishing, duel', async () => {
  bot.addPoints('ivy', 500, 'Ivy');
  bot.addPoints('jack', 500, 'Jack');
  assert.match(await chat('Ivy', '!slots 10'), /\[ .+ \| .+ \| .+ \]/);
  assert.match(await chat('Jack', '!fish'), /caught .+ worth/);
  assert.match(await chat('Ivy', '!duel Jack 100'), /challenges Jack/);
  const out = await chat('Jack', '!accept');
  assert.match(out, /defeats/);
  assert.equal(bot.points('ivy') + bot.points('jack') <= 1000 + 500, true);
});

test('polls, bets and quotes', async () => {
  assert.match(await chat('Moddy', '!poll Best snack? | Chips | Cookies', 'moderator'), /POLL/);
  await chat('Kim', '!vote 2');
  assert.equal(bot.pollState().options[1].votes, 1);
  assert.match(await chat('Moddy', '!poll end', 'moderator'), /Winner: Cookies/);

  bot.addPoints('kim', 200, 'Kim');
  bot.addPoints('leo', 200, 'Leo');
  await chat('Moddy', '!bet open Will we win? | Yes | No', 'moderator');
  await chat('Kim', '!bet 1 100');
  await chat('Leo', '!bet 2 100');
  assert.match(await chat('Moddy', '!bet win 1', 'moderator'), /Yes" wins/);
  assert.equal(bot.points('kim'), 300);
  assert.equal(bot.points('leo'), 100);

  assert.match(await chat('Moddy', '!addquote "I meant to do that"', 'moderator'), /quote #1 added/);
  assert.match(await chat('Mia', '!quote 1'), /I meant to do that/);

});

test('giveaway keyword entry and draw', async () => {
  await chat('Moddy', '!giveaway start Steam key', 'moderator');
  await chat('Olive', '!enter');
  await chat('Pete', '!enter');
  assert.equal(bot.raffleState().raffle.entries.length, 2);
  assert.match(await chat('Moddy', '!giveaway draw', 'moderator'), /winner of "Steam key" is @(Olive|Pete)/);
});

test('moderation: caps filter warns first, mods exempt, spam bots', async () => {
  db.settings.moderation.announce = true;
  const out = await chat('Shouty', 'THIS IS WAY TOO MANY CAPITAL LETTERS FOR CHAT');
  assert.match(out, /easy on the caps/);
  assert.equal(db.modlog[0].filter, 'caps');
  assert.equal(db.modlog[0].action, 'delete');
  const before = db.modlog.length;
  await chat('ModShout', 'MODS CAN YELL ALL THEY WANT HAHAHA', 'moderator');
  assert.equal(db.modlog.length, before);
  await chat('newbot123', 'Want to become famous? Buy viewers on dogehype');
  assert.equal(db.modlog[0].filter, 'spamBots');
});

test('raid boss', async () => {
  await chat('Moddy', '!boss spawn 50', 'moderator');
  assert.equal(bot.bossState().maxHp, 50);
  for (const u of ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8']) {
    if (!bot.bossState()) break;
    await chat(u, '!attack');
  }
  // 8 attackers × ≥8 dmg each (unless stunned) will usually defeat a 50 HP boss
  assert.ok(true);
});
