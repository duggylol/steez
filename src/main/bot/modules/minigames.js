// Trivia (built-in bank or AI generated) and the secret-word game.
import { db, save, getUser, bumpStat } from '../store.js';
import { pick, normalizeAnswer } from '../util.js';
import { log } from '../logger.js';

const BANK = [
  ['What is the largest planet in our solar system?', ['jupiter']],
  ['How many legs does a spider have?', ['8', 'eight']],
  ['What is the chemical symbol for gold?', ['au']],
  ['Which game features a plumber named Mario? (company)', ['nintendo']],
  ['What year was Twitch launched?', ['2011']],
  ['What is the capital of Japan?', ['tokyo']],
  ['How many sides does a hexagon have?', ['6', 'six']],
  ['What is the fastest land animal?', ['cheetah']],
  ['Which planet is known as the Red Planet?', ['mars']],
  ['What gas do plants absorb from the air?', ['carbon dioxide', 'co2']],
  ['In Minecraft, what material do you need to make a Nether portal?', ['obsidian']],
  ['What is the hardest natural substance?', ['diamond']],
  ['How many players are on a soccer team on the field?', ['11', 'eleven']],
  ['Which ocean is the largest?', ['pacific', 'pacific ocean']],
  ['What is the square root of 144?', ['12', 'twelve']],
  ['What color do you get mixing blue and yellow?', ['green']],
  ['Which animal is known as the "King of the Jungle"?', ['lion']],
  ['What is the name of the princess in The Legend of Zelda?', ['zelda']],
  ['What is the main ingredient in guacamole?', ['avocado']],
  ['How many continents are there?', ['7', 'seven']],
  ['What does "GG" stand for in gaming?', ['good game']],
  ['Which element has the symbol O?', ['oxygen']],
  ['What is the tallest mountain in the world?', ['everest', 'mount everest']],
  ['In Pac-Man, what are the ghosts trying to do?', ['catch pacman', 'eat pacman', 'kill pacman', 'catch pac-man']],
  ['Who painted the Mona Lisa?', ['da vinci', 'leonardo da vinci', 'leonardo']],
  ['What is frozen water called?', ['ice']],
  ['How many minutes are in a full day?', ['1440']],
  ['Which country is home to the kangaroo?', ['australia']],
  ['What is the currency of the United Kingdom?', ['pound', 'pound sterling', 'gbp']],
  ['What is the largest mammal?', ['blue whale']],
];

export function init(bot) {
  const T = () => db.settings.games.trivia;
  let round = null;

  async function start(topic) {
    if (round) return false;
    let q, answers;
    if (T().useAI && bot.ai?.available()) {
      try {
        const r = await bot.ai.trivia(topic || T().aiTopic || bot.state.stream?.game || 'general knowledge');
        if (r) [q, answers] = [r.question, r.answers];
      } catch (e) {
        log.warn('AI trivia failed, using built-in bank:', e.message);
      }
    }
    if (!q) [q, answers] = pick(BANK);
    round = { q, answers: answers.map(normalizeAnswer), display: answers[0], ends: Date.now() + T().answerSeconds * 1000 };
    round.timer = setTimeout(() => {
      bot.say(`⌛ Time's up! The answer was: ${round.display}`);
      round = null;
    }, T().answerSeconds * 1000);
    bot.say(`🧠 TRIVIA (${T().answerSeconds}s, +${bot.fmtPoints(T().reward)}): ${q}`);
    return true;
  }
  bot.trivia = { start };

  bot.on('chat', (ctx) => {
    if (round && round.answers.includes(normalizeAnswer(ctx.text))) {
      clearTimeout(round.timer);
      const ans = round.display;
      round = null;
      bot.addPoints(ctx.user.login, T().reward, ctx.user.display);
      const wins = bumpStat(getUser(ctx.user.login), 'triviaWins');
      if (wins >= 10) bot.emit('achievement:unlock', ctx.user.login, 'trivia_whiz');
      bot.say(`✅ ${ctx.user.display} got it! The answer was "${ans}" (+${bot.fmtPoints(T().reward)}) — ${wins} trivia win${wins > 1 ? 's' : ''} total.`);
    }

    // Secret word
    const sw = db.settings.games.secretWord;
    if (sw.word && normalizeAnswer(ctx.text).includes(normalizeAnswer(sw.word)) && !bot.hasLevel(ctx.user, 'broadcaster')) {
      const word = sw.word;
      sw.word = '';
      save();
      bot.addPoints(ctx.user.login, sw.reward, ctx.user.display);
      bot.say(`🤫 ${ctx.user.display} said the SECRET WORD "${word}" and wins ${bot.fmtPoints(sw.reward)}! 🎉`);
      bot.overlay('effect', { effect: 'confetti', user: ctx.user.display });
    }
  });

  bot.command('trivia', {
    description: 'Start a trivia round',
    usage: '!trivia [topic]',
    level: 'moderator',
    cooldown: 10,
    handler: async (ctx, args) => {
      if (!T().enabled) return false;
      if (!(await start(args.join(' ')))) bot.reply(ctx, 'a trivia round is already running!');
    },
  });

  bot.action('trivia:start', ({ topic }) => start(topic));
  bot.action('secretword:set', ({ word, reward }) => {
    db.settings.games.secretWord = { word: String(word || '').trim(), reward: Number(reward) || db.settings.games.secretWord.reward };
    save();
    return { ok: true };
  });

  // Auto trivia + trivia during ad breaks
  let last = Date.now();
  setInterval(() => {
    const m = T().autoIntervalMinutes;
    if (!T().enabled || !m || !bot.state.live || round) return;
    if (Date.now() - last > m * 60000) {
      last = Date.now();
      start();
    }
  }, 30_000);
  bot.on('eventsub:channel.ad_break.begin', () => {
    if (T().enabled && T().duringAdBreaks) setTimeout(() => start(), 3000);
  });
}
