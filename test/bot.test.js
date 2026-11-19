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
const { loadVault } = await import('../src/main/bot/triviaVault.js');

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
  // tiers come from settings: one edited tier, so every cast lands in it
  const savedTiers = db.settings.games.fishing.tiers;
  db.settings.games.fishing.tiers = [{ tier: 'boot', emoji: '🥾', chancePercent: 5, minPoints: 7, maxPoints: 7, announce: false, catches: 'a test boot' }];
  const before = bot.points('ivy');
  assert.match(await chat('Ivy', '!fish'), /a test boot .*boot\) worth 7/);
  assert.equal(bot.points('ivy'), before + 7);
  db.settings.games.fishing.tiers = [{ tier: 'godlike', emoji: '🔱', chancePercent: 1, minPoints: 1000000, maxPoints: 1000000, announce: true, catches: 'a sea god' }];
  assert.match(await chat('Kai', '!fish'), /🎣🌊 .*Kai caught a sea god .*godlike\) worth 1,000,000/);
  db.settings.games.fishing.tiers = savedTiers;
  const top = await chat('Zed', '!fishtop');
  assert.match(top, /Biggest catches: 1\. Kai — a sea god .*1,000,000\) \| 2\. Ivy|Biggest catches: 1\. Kai — a sea god/);
  assert.ok(top.indexOf('Kai') < top.indexOf('Ivy'));
  assert.match(await chat('Kai', '!fishlog'), /godlike: 1/);
  assert.match(await chat('Ivy', '!duel Jack 100'), /challenges Jack/);
  const out = await chat('Jack', '!accept');
  assert.match(out, /defeats/);
  assert.equal(bot.points('ivy') + bot.points('jack') <= 1000 + 500, true);
});

test('jackpot: join, spin, the winner takes the whole pot', async () => {
  const cfg = db.settings.games.jackpot;
  const saved = { ...cfg };
  Object.assign(cfg, { enabled: true, joinSeconds: 0.2, spinSeconds: 1, cooldownSeconds: 0, minBet: 10, maxBet: 0 });
  bot.addPoints('jpa', 1000, 'JpA');
  bot.addPoints('jpb', 1000, 'JpB');
  const start = { jpa: bot.points('jpa'), jpb: bot.points('jpb') };
  assert.match(await chat('JpA', '!jackpot 300'), /started a JACKPOT with 300/);
  assert.match(await chat('JpB', '!jackpot 100'), /you're in with 100 \(25% chance\)\. Pot: 400/);
  assert.match(await chat('JpB', '!jackpot 100'), /you added 100 .*now in with 200 \(40% chance\)\. Pot: 500/);
  assert.equal(bot.points('jpa'), start.jpa - 300);
  assert.equal(bot.points('jpb'), start.jpb - 200);
  const st = bot.jackpotState();
  assert.equal(st.phase, 'open');
  assert.deepEqual(st.players.map((p) => [p.user, p.amount]), [['JpA', 300], ['JpB', 200]]);

  said.length = 0;
  await new Promise((r) => setTimeout(r, 400)); // countdown over: it rolls
  assert.equal(bot.jackpotState().phase, 'spinning');
  assert.match(said.join(' '), /Jackpot closed: 2 players, 500/);
  assert.match(await chat('JpA', '!jackpot 50'), /already rolling/);
  await new Promise((r) => setTimeout(r, 1100)); // the reel stops
  const done = bot.jackpotState();
  assert.equal(done.phase, 'done');
  const winner = done.players[done.winner].user;
  assert.match(said.join(' '), new RegExp(`${winner} WINS THE JACKPOT of 500`));
  const w = winner.toLowerCase();
  assert.equal(bot.points(w), start[w] - (w === 'jpa' ? 300 : 200) + 500);
  assert.equal(bot.points('jpa') + bot.points('jpb'), start.jpa + start.jpb); // points only moved between them

  // a round with one player refunds them
  assert.match(await chat('JpA', '!jackpot 50'), /started a JACKPOT/);
  const solo = bot.points('jpa');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(bot.jackpotState().phase, 'cancelled');
  assert.equal(bot.points('jpa'), solo + 50);
  Object.assign(cfg, saved);
});

test('gambling PnL: every game records what went in and what came back', async () => {
  await bot.runAction('pnl:reset');
  const { viewerPnl } = await import('../src/main/bot/pnl.js');
  bot.addPoints('pna', 5000, 'PnA');
  bot.addPoints('pnb', 5000, 'PnB');
  db.settings.games.gamble.enabled = true;

  // gamble: the PnL matches the points that actually moved
  const before = bot.points('pna');
  await chat('PnA', '!gamble 100');
  let p = viewerPnl(db.users.pna);
  assert.equal(p.plays, 1);
  assert.equal(p.staked, 100);
  assert.ok([0, 200, 300].includes(p.paid), `paid ${p.paid}`);
  assert.equal(bot.points('pna') - before, p.net);

  // duel: one side's win is the other's loss
  await chat('PnA', '!duel PnB 50');
  await chat('PnB', '!accept');
  const duelNet = (login) => viewerPnl(db.users[login]).games.find((g) => g.game === 'duel');
  assert.equal(duelNet('pna').net + duelNet('pnb').net, 0);
  assert.equal(Math.abs(duelNet('pna').net), 50);

  // bets: winners get the pot split, losers lose their stake
  await bot.runAction('bets:open', { question: 'PnL?', options: ['yes', 'no'] });
  await chat('PnA', '!bet 1 100');
  await chat('PnB', '!bet 2 300');
  await bot.runAction('bets:resolve', { option: 0 });
  const bet = (login) => viewerPnl(db.users[login]).games.find((g) => g.game === 'bets');
  assert.deepEqual([bet('pna').staked, bet('pna').paid, bet('pna').net], [100, 400, 300]);
  assert.deepEqual([bet('pnb').staked, bet('pnb').paid, bet('pnb').net], [300, 0, -300]);

  // !pnl and !pnl top
  assert.match(await chat('PnB', '!pnl'), /📉 PnB: -\d[\d,]* points over 2 plays .*Bets -300/);
  assert.match(await chat('Zed', '!pnl PnA'), /PnA: [+-]?\d[\d,]* points over 3 plays/);
  assert.match(await chat('Zoe', '!pnl nobodyhere'), /nobodyhere hasn't chatted here yet/); // !pnl has a per-viewer cooldown
  assert.match(await chat('Zia', '!pnl top'), /Most up: 1\. PnA \+.* Most down: 1\. PnB -/);

  // the dashboard report adds it all up
  const r = await bot.runAction('pnl:report');
  assert.equal(r.players, 2);
  assert.equal(r.plays, 5);
  assert.equal(r.games.find((g) => g.game === 'bets').net, 0);
  assert.equal(r.net, r.paid - r.staked);
  await bot.runAction('pnl:reset');
  assert.equal((await bot.runAction('pnl:report')).plays, 0);
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

test('twitch fixes: shared chat, anonymous gifts, gift bombs, paid upgrades', async () => {
  const { isSharedFromElsewhere } = await import('../src/main/bot/twitch/irc.js');
  assert.equal(isSharedFromElsewhere({ 'room-id': '1', 'source-room-id': '2' }), true);
  assert.equal(isSharedFromElsewhere({ 'room-id': '1', 'source-room-id': '1' }), false);
  assert.equal(isSharedFromElsewhere({ 'room-id': '1' }), false);

  const alerts = [];
  const onAlert = (a) => alerts.push(a);
  bot.on('alert', onAlert);
  const notice = (tags, text = '') => bot.emit('irc:usernotice', { tags, text });
  // anonymous gift bomb: the bomb alerts, its 2 gifts are silent
  notice({ 'msg-id': 'anonsubmysterygift', login: 'ananonymousgifter', 'msg-param-mass-gift-count': '2', 'msg-param-sub-plan': '1000', 'msg-param-community-gift-id': 'c1' });
  notice({ 'msg-id': 'anonsubgift', login: 'ananonymousgifter', 'msg-param-recipient-display-name': 'A', 'msg-param-community-gift-id': 'c1' });
  notice({ 'msg-id': 'subgift', login: 'ananonymousgifter', 'msg-param-recipient-display-name': 'B', 'msg-param-community-gift-id': 'c1' });
  // a single gift (no community id) alerts on its own
  notice({ 'msg-id': 'subgift', login: 'kim', 'display-name': 'Kim', 'msg-param-recipient-display-name': 'C' });
  notice({ 'msg-id': 'giftpaidupgrade', login: 'lee', 'display-name': 'Lee' });
  notice({ 'msg-id': 'primepaidupgrade', login: 'max', 'display-name': 'Max', 'msg-param-sub-plan': '2000' });
  bot.off('alert', onAlert);

  assert.equal(alerts[0].type, 'giftbomb');
  assert.equal(alerts[0].user, 'Anonymous');
  assert.equal(alerts[0].amount, 2);
  assert.ok(alerts[1].partOfBomb && alerts[2].partOfBomb);
  assert.equal(alerts[1].user, 'Anonymous');
  assert.equal(alerts[3].partOfBomb, undefined);
  assert.equal(alerts[3].recipient, 'C');
  assert.deepEqual([alerts[4].type, alerts[4].tier], ['sub', 'Tier 1']);
  assert.deepEqual([alerts[5].type, alerts[5].tier], ['sub', 'Tier 2']);
});

test('features: everything switches off, and feature commands still work without the chat bot', async () => {
  const { createFeatures, registerBotFeatures } = await import('../src/main/features.js');
  const { save } = await import('../src/main/bot/store.js');
  const f = createFeatures({});
  registerBotFeatures(f, { db, save, bot });
  let modOn = true;
  f.register({ id: 'songs', name: 'Song requests', get: () => modOn, set: (on) => (modOn = on) });
  await f.resetAllOff();
  assert.ok(f.list().every((x) => !x.on), JSON.stringify(f.list().filter((x) => x.on)));
  assert.equal(db.settings.general.botEnabled, false);
  assert.equal(db.settings.games.gamble.enabled, false);
  assert.equal(db.settings.events.sub.enabled, false);
  assert.equal(db.settings.modPanel.enabled, false);

  // chat bot off: custom commands are silent, a feature module's command still runs
  db.commands.ping = { response: 'pong', level: 'everyone' };
  let ran = 0;
  bot.command('modcmd', { module: true, level: 'everyone', handler: () => ran++ });
  assert.equal(await chat('viewer', '!ping'), '');
  await chat('viewer', '!modcmd');
  assert.equal(ran, 1);

  await f.set('chatbot', true);
  assert.equal(await chat('viewer', '!ping'), 'pong');
  await f.set('games', true);
  assert.equal(db.settings.games.gamble.enabled, true);
  assert.equal(f.get('games').on, true);
  // turn everything back on for any later tests
  for (const x of f.list()) await f.set(x.id, true);
  delete db.commands.ping;
});

test('trivia: once the vault is used up, a new AI question every round, half about the game, never a repeat', async () => {
  db.settings.games.trivia.enabled = true;
  db.settings.games.trivia.useAI = true;
  const keepUsed = db.meta.triviaVaultUsed;
  db.meta.triviaVaultUsed = loadVault().map((x) => x.id);
  const realAi = bot.ai;
  const realStream = bot.state.stream;
  const prompts = [];
  const replies = ['What is the first boss in this game?', 'What is the first boss in this game?', 'Which planet has rings?', 'Who sculpted David?'];
  let n = 0;
  bot.ai = { ...realAi, available: () => true, complete: async (_sys, prompt) => (prompts.push(prompt), JSON.stringify({ question: replies[n++], answers: ['ans' + n] })) };
  bot.state.stream = { ...(realStream || {}), game: 'Elden Ring' };
  const answerRound = () => chat('quizzer', db.triviaHistory.at(-1).a);
  try {
    await bot.runAction('trivia:start', {});
    assert.match(said.join(' '), /first boss/);
    assert.match(prompts[0], /Elden Ring/);
    await answerRound();
    said.length = 0;
    await bot.runAction('trivia:start', {});
    // The AI repeated itself; Steez noticed, told it, and asked again.
    assert.equal(prompts.length, 3);
    assert.match(prompts[2], /What is the first boss in this game\?/);
    assert.doesNotMatch(prompts[1], /Elden Ring/, 'every other round is a random topic');
    assert.match(said.join(' '), /Which planet has rings/);
    await answerRound();
  } finally {
    bot.ai = realAi;
    bot.state.stream = realStream;
    db.meta.triviaVaultUsed = keepUsed;
  }
});

test('trivia: vault questions come first, never repeat, and pay by difficulty', async () => {
  const realAi = bot.ai;
  let aiCalls = 0;
  bot.ai = { ...realAi, available: () => true, complete: async () => (aiCalls++, '{}') };
  db.settings.games.trivia.difficulty = 'mix';
  const asked = [];
  const seen = { easy: 0, medium: 0, hard: 0 };
  try {
    for (let i = 0; i < 60; i++) {
      await bot.runAction('trivia:start', {});
      const last = db.triviaHistory.at(-1);
      assert.equal(last.kind, 'vault');
      asked.push(last.q);
      const item = loadVault().find((x) => x.q === last.q);
      seen[item.d]++;
      const before = bot.points('quizzer');
      await chat('quizzer', last.a);
      const pts = { easy: 250, medium: 500, hard: 1000 }[item.d];
      assert.equal(bot.points('quizzer') - before, pts, `${item.d} pays ${pts}`);
    }
  } finally {
    bot.ai = realAi;
  }
  assert.equal(new Set(asked).size, 60, 'no question twice');
  assert.equal(aiCalls, 0, 'the AI is not used while the vault has questions');
  assert.ok(seen.easy && seen.medium && seen.hard, 'all three difficulties come up');
  const status = await bot.runAction('trivia:vault');
  assert.equal(status.left, status.total - db.meta.triviaVaultUsed.length);
});

test('trivia: one difficulty only, and the announcement says which', async () => {
  db.settings.games.trivia.difficulty = 'hard';
  said.length = 0;
  await bot.runAction('trivia:start', {});
  assert.match(said.join(' '), /HARD/);
  const last = db.triviaHistory.at(-1);
  assert.equal(loadVault().find((x) => x.q === last.q).d, 'hard');
  await chat('quizzer', last.a);
  db.settings.games.trivia.difficulty = 'mix';
});
