// Trivia question planning: which topic comes next (half about the game being played, half random),
// what to tell the AI so it writes something new, and spotting repeats. No database or network here.

export const RANDOM_CATEGORIES = [
  'science', 'space and astronomy', 'world geography', 'world history', 'animals', 'food and drink', 'movies', 'TV shows',
  'music', 'sports', 'technology and the internet', 'video game history', 'mythology', 'art and artists', 'words and language',
  'the human body', 'inventions', 'famous landmarks', 'oceans and sea life', 'quick math', 'pop culture', 'cars',
  'dinosaurs', 'board and card games', 'weather and nature', 'books and authors', 'flags and countries', 'money',
  'holidays and traditions', 'cartoons and anime', 'plants', 'chemistry', 'famous firsts', 'records and extremes',
];

export const GAME_ANGLES = [
  'characters', 'items, weapons or gear', 'locations and maps', 'story and lore', 'game mechanics', 'the developer and release history',
  'bosses and enemies', 'records, speedruns or esports', 'music, sound or voice actors', 'updates, seasons or DLC', 'easter eggs and secrets',
  'numbers and stats', 'sequels and spin-offs',
];

// Twitch categories that aren't a game: those rounds are random instead.
const NOT_GAMES = new Set(
  [
    'just chatting', 'irl', 'music', 'art', 'talk shows & podcasts', 'asmr', 'pools, hot tubs, and beaches', 'software and game development',
    'science & technology', 'makers & crafting', 'food & drink', 'special events', 'travel & outdoors', 'fitness & health', 'beauty & body art',
    'politics', 'animals, aquariums, and zoos', 'co-working & studying', 'games + demos', 'sports', 'unknown', '',
  ].map((s) => s.toLowerCase()),
);
export const isGame = (category) => !NOT_GAMES.has(String(category || '').trim().toLowerCase());

const pickFrom = (list, rand = Math.random) => list[Math.floor(rand() * list.length)];

/**
 * Decide the next round. state: { next: 'game'|'random', recentCategories: string[] } (kept in the database).
 * Returns { kind, topic, angle, state } — the caller saves `state`.
 */
export function planRound({ topic, game, randomTopic, state = {}, rand = Math.random }) {
  const next = state.next === 'random' ? 'random' : 'game';
  const recent = Array.isArray(state.recentCategories) ? state.recentCategories : [];
  if (topic && String(topic).trim()) return { kind: 'custom', topic: String(topic).trim(), angle: null, state };
  if (next === 'game' && isGame(game)) {
    return { kind: 'game', topic: String(game).trim(), angle: pickFrom(GAME_ANGLES, rand), state: { next: 'random', recentCategories: recent } };
  }
  // A random round. If it was the game's turn but nothing is being played, the game round waits for the next one.
  const fresh = RANDOM_CATEGORIES.filter((c) => !recent.includes(c));
  const custom = String(randomTopic || '').trim();
  const category = custom || pickFrom(fresh.length ? fresh : RANDOM_CATEGORIES, rand);
  return {
    kind: 'random',
    topic: category,
    angle: null,
    // After a random round the game is up next (and if the game's turn was skipped, it still is).
    state: { next: 'game', recentCategories: [...recent, category].slice(-12) },
  };
}

export const TRIVIA_SYSTEM =
  'You write fun, fair trivia questions for a Twitch chat. Every question must be brand new: never reuse or reword a question you are told was already asked, and never ask about the same fact again. ' +
  'Respond with ONLY a JSON object: {"question": string, "answers": [string]} where answers lists the correct answer first, then common acceptable variants (short, 1-3 words each). ' +
  'The answer must be short, unambiguous and something chat can type. Keep the question under 150 characters. No multiple choice.';

export function triviaPrompt(plan, recentQuestions = [], difficulty = 'medium') {
  const about =
    plan.kind === 'game'
      ? `the video game "${plan.topic}" (the streamer is playing it right now) — focus on ${plan.angle}. Only ask about things that are true in the real game.`
      : plan.kind === 'custom'
        ? `${plan.topic}`
        : `${plan.topic} (general knowledge, not about the stream)`;
  const avoid = recentQuestions.length
    ? `\n\nAlready asked in this channel — do NOT repeat any of these or ask about the same facts:\n${recentQuestions.map((q) => `- ${q}`).join('\n')}`
    : '';
  return `Write one ${difficulty} trivia question about ${about}${avoid}`;
}

// Words that say nothing about which fact a question asks ("What does GTA stand for?" and "What does
// RPG stand for?" are different questions; only "gta" and "rpg" tell them apart).
const STOP = new Set(
  ('what which who whom whose when where why how does did was were are the and for from with that this these those has have had ' +
    'its his her their our your you can could would should will into onto than then them they there name named called call ' +
    'stand stands known famous many much also often usually typically traditionally commonly ' +
    'is in of a an to by on at as or be it s t')
    .split(/\s+/),
);
export const contentWords = (s) => [
  ...new Set(
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !STOP.has(w)),
  ),
];
const sameAnswer = (a, b) => {
  const n = (s) => String(s || '').toLowerCase().replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]/g, '');
  return !!n(a) && n(a) === n(b);
};

/**
 * Is this question one that was already asked? history: [{ q, a }]
 * A repeat is the same fact (same answer, mostly the same words) or the same question barely reworded.
 * "How many points is a touchdown worth?" and "...a field goal worth?" are different questions.
 */
export function isRepeat(question, answer, history = []) {
  const qw = contentWords(question);
  for (const h of history) {
    const hw = contentWords(h.q);
    const set = new Set(hw);
    const shared = qw.filter((w) => set.has(w)).length;
    if (shared === qw.length && shared === hw.length) return true; // the same words
    const overlap = shared / Math.max(1, Math.min(qw.length, hw.length));
    const jaccard = shared / Math.max(1, new Set([...qw, ...hw]).size);
    if (sameAnswer(answer, h.a) && overlap >= 0.6) return true; // the same fact, asked differently
    if (jaccard >= 0.85) return true; // the same question with a word or two changed
  }
  return false;
}

/** Parse the AI's reply into { question, answers } or null. */
export function parseTrivia(text) {
  const json = String(text || '').match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const r = JSON.parse(json);
    const answers = (Array.isArray(r.answers) ? r.answers : [r.answer]).map((a) => String(a ?? '').trim()).filter(Boolean);
    if (!r.question || !answers.length) return null;
    return { question: String(r.question).trim(), answers };
  } catch {
    return null;
  }
}
