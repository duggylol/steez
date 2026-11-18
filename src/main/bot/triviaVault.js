// The trivia vault: ~3,000 checked questions that ship with Steez (trivia-vault.json). Each one is
// asked once per channel; only when every question has been used does trivia go back to the AI.
// No database or network here: the caller keeps the list of used ids.
import fs from 'node:fs';
import crypto from 'node:crypto';

export const DIFFICULTIES = ['easy', 'medium', 'hard'];
// How often each difficulty comes up when the setting is "mix".
export const MIX = { easy: 40, medium: 35, hard: 25 };

let cache = null;
/** The questions: [{ id, q, a: [answers], d: 'easy'|'medium'|'hard', c: category }] */
export function loadVault(file = new URL('./trivia-vault.json', import.meta.url)) {
  if (cache && file instanceof URL) return cache;
  let list = [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    list = (Array.isArray(raw) ? raw : raw.questions || []).filter((x) => x && x.q && Array.isArray(x.a) && x.a.length && DIFFICULTIES.includes(x.d));
  } catch {
    list = [];
  }
  if (file instanceof URL) cache = list;
  return list;
}

/** A question's id: stays the same if the vault is reordered or extended in an update. */
export const vaultId = (q) =>
  crypto
    .createHash('sha1')
    .update(String(q).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
    .digest('hex')
    .slice(0, 10);

/** easy / medium / hard for this round. setting: 'mix' or one difficulty. */
export function pickDifficulty(setting = 'mix', rand = Math.random) {
  if (DIFFICULTIES.includes(setting)) return setting;
  let r = rand() * (MIX.easy + MIX.medium + MIX.hard);
  for (const d of DIFFICULTIES) if ((r -= MIX[d]) < 0) return d;
  return 'medium';
}

const words = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

/**
 * The next vault question, or null when none is left (for that topic).
 * used: Set of ids already asked. recentCategories: categories of the last few rounds (asked less).
 * topic: a !trivia <topic> request; matches the category or words in the question.
 * skip(item): true for a question to pass over (e.g. the channel was already asked it by the AI).
 */
export function pickFromVault({ vault, used, difficulty, topic = '', recentCategories = [], rand = Math.random, skip = () => false }) {
  let pool = vault.filter((x) => !used.has(x.id));
  const tw = words(topic);
  if (tw.length) {
    pool = pool.filter((x) => {
      const hay = new Set([...words(x.c), ...words(x.q)]);
      return tw.every((w) => hay.has(w) || [...hay].some((h) => h.startsWith(w) || w.startsWith(h)));
    });
  }
  if (!pool.length) return null;
  // The wanted difficulty if any are left, else whatever is left.
  const byDiff = pool.filter((x) => x.d === difficulty);
  let choices = byDiff.length ? byDiff : pool;
  // Different subjects round to round.
  const fresh = choices.filter((x) => !recentCategories.includes(x.c));
  if (fresh.length) choices = fresh;
  for (let tries = 0; tries < 40 && choices.length; tries++) {
    const i = Math.floor(rand() * choices.length);
    const item = choices[i];
    if (!skip(item)) return item;
    choices = choices.filter((_, j) => j !== i);
  }
  return null;
}
