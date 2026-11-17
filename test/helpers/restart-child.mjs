// Runs the chat bot in its own process so test/restart.test.js can "close Steez" and open it again.
// usage: node restart-child.mjs <dataDir> <phase>
const [dir, phase] = process.argv.slice(2);
process.env.STEEZ_BOT_DATA = dir;
process.env.ANTHROPIC_API_KEY = '';
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...a) => realSetInterval(...a).unref();

const { bot } = await import('../../src/main/bot/core/bot.js');
const { db, flush } = await import('../../src/main/bot/store.js');
const session = await import('../../src/main/bot/session.js');
await bot.init();
for (const n of ['loyalty', 'games', 'boss', 'minigames', 'giveaways', 'polls']) (await import(`../../src/main/bot/modules/${n}.js`)).init(bot);
const chat = (user, text, level = 'everyone') => bot.runAction('chat:simulate', { user, text, level });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (phase === 'before') {
  db.settings.general.botEnabled = true;
  for (const u of ['ann', 'ben', 'cat']) {
    await chat(u, 'hi');
    db.users[u].points = 1000;
  }
  await bot.runAction('raffle:start', { title: 'Big prize', keyword: '!enter' });
  await chat('ann', '!enter');
  await chat('ben', '!enter');
  await bot.runAction('poll:start', { question: 'Best?', options: ['A', 'B'], seconds: 120 });
  await chat('cat', '!vote 2');
  await bot.runAction('bets:open', { question: 'Win?', options: ['yes', 'no'] });
  await chat('ann', '!bet 1 300');
  db.settings.games.heist.joinSeconds = 120;
  await chat('ben', '!heist 200');
  await bot.runAction('trivia:start', {});
  await wait(50);
  session.touch();
  flush();
  console.log(JSON.stringify({ points: { ann: db.users.ann.points, ben: db.users.ben.points } }));
  process.exit(0);
} else {
  await wait(50);
  console.log(
    JSON.stringify({
      downtime: session.downtime(),
      raffle: bot.raffleState().raffle,
      poll: bot.pollState(),
      bets: bot.betState(),
      session: Object.keys(db.session).sort(),
      trivia: db.session.trivia,
      heist: db.session.heist,
    }),
  );
  process.exit(0);
}
