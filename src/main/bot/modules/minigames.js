// Trivia (the built-in vault of ~3,000 questions, then AI generated) and the secret-word game.
import { db, save, getUser, bumpStat } from '../store.js';
import { normalizeAnswer, sanitizeChat } from '../util.js';
import { log } from '../logger.js';
import { keep, restore, resumeAt } from '../session.js';
import { planRound, triviaPrompt, TRIVIA_SYSTEM, isRepeat, parseTrivia } from '../trivia.js';
import { loadVault, pickFromVault, pickDifficulty } from '../triviaVault.js';

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
  // Points by difficulty. The old single "reward" setting is replaced by these.
  if (!db.meta.triviaVaultV1) {
    delete T().reward;
    db.meta.triviaVaultV1 = Date.now();
    save();
  }
  const POINTS_KEY = { easy: 'pointsEasy', medium: 'pointsMedium', hard: 'pointsHard' };
  const pointsFor = (d) => Math.max(0, Number(T()[POINTS_KEY[d] || 'pointsMedium']) || 0);

  // Vault questions already asked in this channel, oldest first (ids, so updates to the vault keep it).
  db.meta.triviaVaultUsed ||= [];
  const usedIds = () => new Set(db.meta.triviaVaultUsed);
  const markUsed = (id) => {
    const list = db.meta.triviaVaultUsed;
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    list.push(id);
  };
  const vaultStatus = () => {
    const vault = loadVault();
    const used = usedIds();
    const left = { easy: 0, medium: 0, hard: 0 };
    for (const x of vault) if (!used.has(x.id)) left[x.d]++;
    return { total: vault.length, left: left.easy + left.medium + left.hard, byDifficulty: left };
  };

  const remember = (q, a, kind, topic) => {
    db.triviaHistory.push({ q, a, kind, topic, t: Date.now() });
    if (db.triviaHistory.length > 1000) db.triviaHistory.splice(0, db.triviaHistory.length - 1000);
    save();
  };

  async function aiQuestion(topic, difficulty) {
    const plan = planRound({ topic, game: bot.state.stream?.game, randomTopic: T().aiTopic, state: db.meta.trivia || {} });
    const recent = db.triviaHistory.slice(-80).map((h) => h.q);
    for (let attempt = 0; attempt < 3; attempt++) {
      const out = await bot.ai.complete(TRIVIA_SYSTEM, triviaPrompt(plan, recent, difficulty), { maxTokens: 1500 });
      const r = parseTrivia(out);
      if (!r) continue;
      if (isRepeat(r.question, r.answers[0], db.triviaHistory)) {
        recent.push(r.question); // tell it about this one too and try again
        continue;
      }
      db.meta.trivia = plan.state;
      return { question: sanitizeChat(r.question, 300), answers: r.answers, kind: plan.kind, topic: plan.topic, difficulty };
    }
    return null;
  }

  /** The next unused vault question (null when the vault is used up, or nothing matches the topic). */
  function vaultQuestion(topic, difficulty) {
    const recentCategories = db.triviaHistory.slice(-6).map((h) => h.topic).filter(Boolean);
    const item = pickFromVault({
      vault: loadVault(),
      used: usedIds(),
      difficulty,
      topic,
      recentCategories,
      // Already asked here some other way (an AI round before the vault existed): count it as used.
      skip: (x) => isRepeat(x.q, x.a[0], db.triviaHistory) && (markUsed(x.id), true),
    });
    if (!item) return null;
    markUsed(item.id);
    return { question: item.q, answers: item.a, kind: 'vault', topic: item.c, difficulty: item.d };
  }

  /** Vault used up and no AI: the questions asked longest ago come back first. */
  function recycledQuestion(difficulty) {
    const vault = new Map(loadVault().map((x) => [x.id, x]));
    const used = db.meta.triviaVaultUsed;
    const oldest = used.slice(0, Math.max(1, Math.ceil(used.length / 4))).map((id) => vault.get(id)).filter(Boolean);
    if (!oldest.length) return null;
    const item = oldest.find((x) => x.d === difficulty) || oldest[0];
    markUsed(item.id);
    return { question: item.q, answers: item.a, kind: 'vault', topic: item.c, difficulty: item.d };
  }

  async function start(topic) {
    if (round || starting) return false;
    starting = true;
    try {
      const difficulty = pickDifficulty(T().difficulty);
      const aiOn = T().useAI !== false && bot.ai?.available();
      const ai = async () => {
        try {
          return await aiQuestion(topic, difficulty);
        } catch (e) {
          log.warn('AI trivia failed:', e.message);
          return null;
        }
      };
      // The vault first. The AI only writes questions once the vault is used up (or for a
      // !trivia <topic> the vault has nothing left on).
      let r = vaultQuestion(topic, difficulty);
      if (!r && aiOn) r = await ai();
      if (!r && topic) r = vaultQuestion('', difficulty);
      if (!r) r = recycledQuestion(difficulty);
      if (!r) return false;
      save();
      if (round) return false;
      const points = pointsFor(r.difficulty);
      remember(r.question, r.answers[0], r.kind, r.topic);
      begin({ q: r.question, answers: r.answers.map(normalizeAnswer), display: r.answers[0], difficulty: r.difficulty, points, ends: Date.now() + T().answerSeconds * 1000 });
      const level = { easy: '🟢 EASY', medium: '🟡 MEDIUM', hard: '🔴 HARD' }[r.difficulty] || '';
      bot.say(`🧠 TRIVIA${r.kind === 'game' ? ` (${r.topic})` : ''} · ${level} · +${bot.fmtPoints(points)} · ${T().answerSeconds}s: ${r.question}`);
      return true;
    } finally {
      starting = false;
    }
  }

  function begin(r) {
    round = r;
    keep('trivia', { q: r.q, answers: r.answers, display: r.display, difficulty: r.difficulty, points: r.points, ends: r.ends });
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
  bot.trivia = { start, vaultStatus };

  bot.on('chat', (ctx) => {
    if (round && round.answers.includes(normalizeAnswer(ctx.text))) {
      const ans = round.display;
      const points = round.points ?? pointsFor(round.difficulty);
      end();
      bot.addPoints(ctx.user.login, points, ctx.user.display);
      const wins = bumpStat(getUser(ctx.user.login), 'triviaWins');
      if (wins >= 10) bot.emit('achievement:unlock', ctx.user.login, 'trivia_whiz');
      bot.say(`✅ ${ctx.user.display} got it! The answer was "${ans}" (+${bot.fmtPoints(points)}) — ${wins} trivia win${wins > 1 ? 's' : ''} total.`);
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
  bot.action('trivia:vault', () => vaultStatus());
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
