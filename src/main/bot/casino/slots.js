// Steez Slots: 5 reels × 3 rows, 10 fixed lines, a wild on reels 2–5 and a scatter (star) that
// pays anywhere and starts free spins. The return is worked out exactly from the reel strips
// (every visible spot on a reel is one uniform pick from its strip, and the reels are
// independent), then every pay is scaled by the same factor so the game returns `returnPercent`.

export const SYMBOLS = ['cherry', 'lemon', 'plum', 'bell', 'bar', 'seven', 'gem', 'crown', 'wild', 'star'];
const PAYING = ['cherry', 'lemon', 'plum', 'bell', 'bar', 'seven', 'gem', 'crown'];

// How many of each symbol sit on each of the 5 reels.
const COUNTS = {
  cherry: [7, 7, 7, 7, 7],
  lemon: [6, 6, 6, 6, 6],
  plum: [5, 5, 5, 5, 5],
  bell: [4, 4, 4, 4, 4],
  bar: [3, 3, 3, 3, 3],
  seven: [2, 2, 2, 2, 2],
  gem: [2, 2, 2, 2, 2],
  crown: [1, 1, 1, 1, 1],
  wild: [0, 2, 2, 2, 1],
  star: [1, 1, 1, 1, 1],
};

// Line pays for 3 / 4 / 5 in a row from the left, in line bets (before scaling).
const RAW_LINE = {
  cherry: [2, 5, 15],
  lemon: [2, 6, 20],
  plum: [3, 8, 25],
  bell: [4, 12, 40],
  bar: [6, 18, 60],
  seven: [10, 30, 120],
  gem: [12, 40, 150],
  crown: [20, 80, 400],
};
// Stars anywhere, in total bets (before scaling), and the free spins they start.
const RAW_SCATTER = { 3: 2, 4: 10, 5: 50 };
export const FREE_SPINS = { 3: 8, 4: 12, 5: 20 };
export const FREE_SPIN_MULT = 2;
const MAX_FREE_SPINS = 100;

// Row (0 top, 1 middle, 2 bottom) of each line on each reel.
export const LINES = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [1, 0, 1, 2, 1],
];

/** Spread each reel's symbols around its strip so the same symbol rarely sits next to itself. */
function buildStrips() {
  return [0, 1, 2, 3, 4].map((r) => {
    const items = [];
    for (const s of SYMBOLS) for (let i = 0; i < COUNTS[s][r]; i++) items.push(s);
    // Deal round-robin from the most common symbol down: a fixed, even spread.
    const groups = SYMBOLS.map((s) => items.filter((x) => x === s)).sort((a, b) => b.length - a.length);
    const strip = [];
    while (groups.some((g) => g.length)) for (const g of groups) if (g.length) strip.push(g.pop());
    return strip;
  });
}
export const STRIPS = buildStrips();

/** Exact return of the unscaled game: lines + star pays + free spins (with retriggers). */
function rawReturn() {
  const n = STRIPS.map((s) => s.length);
  const p = (r, s) => COUNTS[s][r] / n[r];
  const w = (r) => p(r, 'wild');
  // One line, in line bets. Run = leading wilds + the first other symbol + matches/wilds after it.
  let line = 0;
  for (let j = 0; j < 5; j++) {
    const lead = Array.from({ length: j }, (_, r) => w(r)).reduce((a, b) => a * b, 1);
    for (const s of PAYING) {
      for (let L = Math.max(3, j + 1); L <= 5; L++) {
        let pr = lead * p(j, s);
        for (let r = j + 1; r < L; r++) pr *= p(r, s) + w(r);
        if (L < 5) pr *= 1 - p(L, s) - w(L);
        line += pr * RAW_LINE[s][L - 3];
      }
    }
  }
  line += [0, 1, 2, 3, 4].reduce((a, r) => a * w(r), 1) * RAW_LINE.crown[2]; // five wilds
  // Stars: a reel shows one when its window covers one of its stars.
  const seen = STRIPS.map((strip) => {
    let hits = 0;
    for (let stop = 0; stop < strip.length; stop++) if ([0, 1, 2].some((k) => strip[(stop + k) % strip.length] === 'star')) hits++;
    return hits / strip.length;
  });
  let dist = [1];
  for (const q of seen) {
    const next = Array(dist.length + 1).fill(0);
    dist.forEach((v, k) => {
      next[k] += v * (1 - q);
      next[k + 1] += v * q;
    });
    dist = next;
  }
  const scatter = [3, 4, 5].reduce((s, k) => s + (dist[k] || 0) * RAW_SCATTER[k], 0);
  const spinsPer = [3, 4, 5].reduce((s, k) => s + (dist[k] || 0) * FREE_SPINS[k], 0);
  const base = line + scatter; // a 10-line spin's line return equals one line's, in total bets
  const free = (spinsPer / (1 - spinsPer)) * FREE_SPIN_MULT * base;
  return { total: base + free, line, scatter, spinsPer, starOdds: dist };
}
const RAW = rawReturn();

/** The pay tables for a target return, in total bets (line pays already divided by 10 lines). */
export function slotsTable(returnPercent = 96) {
  const target = Math.min(1, Math.max(0.5, (Number(returnPercent) || 96) / 100));
  const f = target / RAW.total;
  return {
    factor: f,
    rtp: RAW.total * f,
    line: Object.fromEntries(PAYING.map((s) => [s, RAW_LINE[s].map((v) => (v * f) / LINES.length)])),
    scatter: Object.fromEntries(Object.entries(RAW_SCATTER).map(([k, v]) => [k, v * f])),
    freeSpins: FREE_SPINS,
    freeSpinMult: FREE_SPIN_MULT,
    triggerOdds: 1 / [3, 4, 5].reduce((s, k) => s + (RAW.starOdds[k] || 0), 0),
  };
}

/** Where the reels stop: grid[reel][row]. */
function spinGrid(rng) {
  return STRIPS.map((strip) => {
    const stop = rng.int(strip.length);
    return [0, 1, 2].map((k) => strip[(stop + k) % strip.length]);
  });
}

/** Line and star wins on one grid, in total bets. */
export function evaluate(grid, table) {
  const wins = [];
  LINES.forEach((rows, li) => {
    const syms = rows.map((row, r) => grid[r][row]);
    const first = syms.find((s) => s !== 'wild');
    if (first === 'star') return;
    const sym = first || 'crown'; // five wilds pay like five crowns
    let run = 0;
    while (run < 5 && (syms[run] === sym || syms[run] === 'wild')) run++;
    if (run >= 3) wins.push({ line: li, symbol: sym, count: run, mult: table.line[sym][run - 3] });
  });
  const stars = grid.reduce((s, col) => s + (col.includes('star') ? 1 : 0), 0);
  const scatter = stars >= 3 ? table.scatter[stars] : 0;
  const total = wins.reduce((s, x) => s + x.mult, 0) + scatter;
  return { wins, stars, scatter, freeSpins: stars >= 3 ? FREE_SPINS[stars] : 0, mult: total };
}

/** One paid spin, with any free spins it starts played out. Returns everything to animate. */
export function playSlots(rng, returnPercent) {
  const table = slotsTable(returnPercent);
  const grid0 = spinGrid(rng);
  const first = { grid: grid0, ...evaluate(grid0, table) };
  const spins = [first];
  let left = first.freeSpins;
  let played = 0;
  while (left > 0 && played < MAX_FREE_SPINS) {
    left--;
    played++;
    const grid = spinGrid(rng);
    const e = evaluate(grid, table);
    spins.push({ grid, ...e, free: true, mult: e.mult * FREE_SPIN_MULT });
    left += e.freeSpins;
  }
  const mult = spins.reduce((s, x) => s + x.mult, 0);
  return { spins, mult };
}

export const _raw = RAW;
