// Trivia (built-in bank or AI generated) and the secret-word game.
import { db, save, getUser, bumpStat } from '../store.js';
import { pick, normalizeAnswer, sanitizeChat } from '../util.js';
import { log } from '../logger.js';
import { keep, restore, resumeAt } from '../session.js';
import { planRound, triviaPrompt, TRIVIA_SYSTEM, isRepeat, parseTrivia } from '../trivia.js';

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
  let starting = false;

  // Every question asked is remembered so it's never asked again (AI questions and the built-in bank).
  db.triviaHistory ||= [];
  db.meta ||= {};
  // Trivia used to default to the small built-in bank; it now writes new questions with the AI.
  if (!db.meta.triviaAiV1) {
    T().useAI = true;
    db.meta.triviaAiV1 = Date.now();
    save();
  }
  const remember = (q, a, kind, topic) => {
    db.triviaHistory.push({ q, a, kind, topic, t: Date.now() });
    if (db.triviaHistory.length > 1000) db.triviaHistory.splice(0, db.triviaHistory.length - 1000);
    save();
  };

  async function aiQuestion(topic) {
    const plan = planRound({ topic, game: bot.state.stream?.game, randomTopic: T().aiTopic, state: db.meta.trivia || {} });
    const recent = db.triviaHistory.slice(-80).map((h) => h.q);
    for (let attempt = 0; attempt < 3; attempt++) {
      const difficulty = pick(['easy', 'medium', 'medium', 'tricky']);
      const out = await bot.ai.complete(TRIVIA_SYSTEM, triviaPrompt(plan, recent, difficulty), { maxTokens: 1500 });
      const r = parseTrivia(out);
      if (!r) continue;
      if (isRepeat(r.question, r.answers[0], db.triviaHistory)) {
        recent.push(r.question); // tell it about this one too and try again
        continue;
      }
      db.meta.trivia = plan.state;
      return { question: sanitizeChat(r.question, 300), answers: r.answers, kind: plan.kind, topic: plan.topic };
    }
    return null;
  }

  /** Built-in questions, each used once before any comes back (only when the AI can't be used). */
  function bankQuestion() {
    const asked = new Set(db.triviaHistory.map((h) => h.q));
    let fresh = BANK.filter(([q]) => !asked.has(q));
    if (!fresh.length) {
      // Every built-in question has been asked: start the bank over, oldest first.
      const order = new Map(db.triviaHistory.map((h, i) => [h.q, i]));
      fresh = [...BANK].sort((x, y) => (order.get(x[0]) ?? -1) - (order.get(y[0]) ?? -1)).slice(0, Math.ceil(BANK.length / 2));
    }
    const [question, answers] = pick(fresh);
    return { question, answers, kind: 'bank', topic: '' };
  }

  async function start(topic) {
    if (round || starting) return false;
    starting = true;
    try {
      let r = null;
      if (T().useAI !== false && bot.ai?.available()) {
        try {
          r = await aiQuestion(topic);
        } catch (e) {
          log.warn('AI trivia failed, using a built-in question:', e.message);
        }
      }
      if (!r) r = bankQuestion();
      if (round) return false;
      remember(r.question, r.answers[0], r.kind, r.topic);
      begin({ q: r.question, answers: r.answers.map(normalizeAnswer), display: r.answers[0], ends: Date.now() + T().answerSeconds * 1000 });
      bot.say(`🧠 TRIVIA${r.kind === 'game' ? ` (${r.topic})` : ''} (${T().answerSeconds}s, +${bot.fmtPoints(T().reward)}): ${r.question}`);
      return true;
    } finally {
      starting = false;
    }
  }

  function begin(r) {
    round = r;
    keep('trivia', { q: r.q, answers: r.answers, display: r.display, ends: r.ends });
    round.timer = setTimeout(() => {
      bot.say(`⌛ Time's up! The answer was: ${round.display}`);
      end();
    }, Math.max(5000, r.ends - Date.now()));
  }
  function end() {
    if (round) clearTimeout(round.timer);
    round = null;
    keep('trivia', null);
  }
  {
    // A round that was running when Steez closed keeps its remaining time.
    const saved = restore('trivia');
    if (saved?.q) begin({ ...saved, ends: resumeAt(saved.ends) });
  }
  bot.trivia = { start };

  bot.on('chat', (ctx) => {
    if (round && round.answers.includes(normalizeAnswer(ctx.text))) {
      const ans = round.display;
      end();
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
