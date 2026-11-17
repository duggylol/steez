// Forgiving search over everything in Steez: pages, feature switches, settings, overlays, chat
// commands and quick actions. Typos, partial words, squashed words ("songrequest"), plurals and
// common other names ("raffle" → giveaway, "obs" → overlays) all still find the right thing.
// Pure functions only (tested in test/search.test.js); the palette UI lives in Search.jsx.

/** Other names people use for things. A query word also searches for each of these. */
export const ALIASES = {
  raffle: ['giveaway'], lottery: ['giveaway'], draw: ['giveaway'],
  prediction: ['bets'], predictions: ['bets'], wager: ['bets'],
  obs: ['overlay'], source: ['overlay'], widget: ['overlay'], widgets: ['overlay'],
  sr: ['song', 'request'], music: ['song'], spotify: ['song'], youtube: ['song'], playlist: ['song'],
  cmd: ['command'], cmds: ['command'], '!': ['command'],
  quiz: ['trivia'], question: ['trivia'],
  config: ['settings'], options: ['settings'], preferences: ['settings'], setup: ['settings'],
  tts: ['text', 'speech'], voice: ['tts'],
  currency: ['points'], coins: ['points'], economy: ['points'], balance: ['points'], loyalty: ['points'],
  ban: ['moderation'], timeout: ['moderation'], spam: ['moderation'], filter: ['moderation'], automod: ['moderation'],
  repeat: ['timer'], interval: ['timer'], scheduled: ['timer'],
  countdown: ['subathon'], clock: ['subathon'],
  notification: ['alert'], notifications: ['alerts'],
  streamlabs: ['import'], streamelements: ['import'], migrate: ['import'],
  so: ['shoutout'], claude: ['ai'], gpt: ['ai'], chatgpt: ['ai'],
  line: ['queue'], party: ['queue'],
  tt: ['tiktok'], 'tik': ['tiktok'],
  update: ['updates'], version: ['updates'],
};

const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'for', 'my', 'how', 'do', 'i', 'in', 'on', 'and', 'where', 'is', 'can', 'change', 'set', 'turn', 'find']);

export const norm = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9!]+/g, ' ')
    .trim();

const singular = (w) => (w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
export const words = (s) => norm(s).split(' ').filter(Boolean).map(singular);

/** Optimal-string-alignment edit distance (a swap of two letters counts as one typo), capped. */
export function editDistance(a, b, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
    if (rowMin > max) return max + 1;
  }
  return prev[b.length];
}

const allowedTypos = (len) => (len <= 3 ? 0 : len <= 5 ? 1 : len <= 9 ? 2 : 3);

/** How well one query word matches one word of the entry (0 = not at all, 1 = exactly). */
export function wordScore(q, w) {
  if (!q || !w) return 0;
  if (q === w) return 1;
  if (w.startsWith(q)) return q.length >= 2 ? 0.92 - Math.min(0.2, (w.length - q.length) * 0.02) : 0.5;
  if (q.length >= 4 && q.startsWith(w) && w.length >= 3) return 0.72;
  if (q.length >= 3 && w.includes(q)) return 0.7;
  // Short typos ("wrds") are judged by the word they're close to, not only by their own length.
  const typos = q.length >= 3 ? allowedTypos(Math.max(q.length, Math.min(w.length, q.length + 1))) : 0;
  if (typos) {
    // compare against the start of longer words too, so "giveaw" ≈ "giveaway" and "gievaway" ≈ "giveaway"
    const d = Math.min(editDistance(q, w, typos), w.length > q.length ? editDistance(q, w.slice(0, q.length), typos) + 0.5 : 99);
    if (d <= typos) return 0.82 - d * 0.14;
  }
  return 0;
}

/**
 * Score an entry for a query. entry: { title, keywords?, description?, section? }
 * Every query word should match something; words that don't lower the score a lot.
 */
export function scoreEntry(query, entry) {
  const qs = words(query).filter((w) => !STOP.has(w) || words(query).length === 1);
  if (!qs.length) return 0;
  const fields = [
    [words(entry.title), 3],
    [words((entry.keywords || []).join(' ')), 2],
    [words(entry.section || ''), 1.2],
    [words(entry.description || ''), 1],
  ];
  let total = 0;
  let matched = 0;
  for (const q of qs) {
    const variants = [[q, 1], ...(ALIASES[q] || []).map((a) => [singular(a), 0.95])];
    let best = 0;
    for (const [v, vw] of variants) {
      for (const [ws, weight] of fields) {
        for (const w of ws) {
          const s = wordScore(v, w) * weight * vw;
          if (s > best) best = s;
        }
      }
    }
    if (best > 0) matched++;
    total += best;
  }
  if (!matched) {
    // Squashed words: "songrequest" vs "Song Requests"
    const flatQ = norm(query).replace(/ /g, '');
    const flatT = norm(entry.title).replace(/ /g, '');
    if (flatQ.length >= 5 && (flatT.includes(flatQ) || editDistance(flatQ, flatT.slice(0, flatQ.length), 2) <= 2)) return 2.2;
    return 0;
  }
  let score = total / qs.length;
  if (matched < qs.length) score *= 0.45 * (matched / qs.length);
  const nq = norm(query);
  const nt = norm(entry.title);
  if (nt === nq) score += 1.5;
  else if (nt.startsWith(nq)) score += 0.8;
  return score + (entry.boost || 0);
}

/** Search a list of entries. Returns the best matches, highest first. */
export function search(query, entries, limit = 40) {
  if (!norm(query)) return [];
  const out = [];
  for (const e of entries) {
    const s = scoreEntry(query, e);
    if (s >= 0.9) out.push({ ...e, score: s });
  }
  out.sort((a, b) => b.score - a.score || a.title.length - b.title.length);
  return out.slice(0, limit);
}

/** Which characters of `text` to highlight for the query (whole matched words). */
export function highlight(text, query) {
  const qs = words(query);
  const parts = [];
  for (const piece of String(text).split(/(\s+)/)) {
    const w = words(piece)[0];
    const hit = w && qs.some((q) => wordScore(q, w) >= 0.68 || (ALIASES[q] || []).some((a) => wordScore(singular(a), w) >= 0.68));
    parts.push({ text: piece, hit: !!hit });
  }
  return parts;
}

// ─── Building the index ─────────────────────────────────────────────

/** "games.trivia.useAI" → "Use AI" */
export const labelOf = (key) =>
  String(key)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\bAi\b/g, 'AI')
    .replace(/\bTts\b/g, 'TTS')
    .replace(/\bObs\b/g, 'OBS')
    .replace(/\bVip\b/g, 'VIP')
    .replace(/\bUrl\b/g, 'URL');

/**
 * Every leaf setting of the chat bot as a search entry.
 * sections: { [settingsSection]: { route, tab?, name } } — where each section is shown.
 */
export function settingEntries(settings, sections, help = {}) {
  const out = [];
  const walk = (obj, path, crumbs, place) => {
    for (const [k, v] of Object.entries(obj || {})) {
      const p = `${path}.${k}`;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        walk(v, p, [...crumbs, labelOf(k)], place);
        continue;
      }
      out.push({
        kind: 'setting',
        id: `setting:${p}`,
        title: labelOf(k),
        section: [place.name, ...crumbs].join(' › '),
        description: help[p] || '',
        keywords: [...crumbs, ...(place.keywords || [])],
        target: { route: place.route, tab: place.tab, path: p },
      });
    }
  };
  for (const [section, place] of Object.entries(sections)) {
    if (settings?.[section] && typeof settings[section] === 'object' && !Array.isArray(settings[section])) walk(settings[section], section, [], place);
  }
  return out;
}
