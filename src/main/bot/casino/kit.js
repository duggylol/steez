// Small helpers shared by the casino games.

/** A mistake the player can fix (shown to them as is). */
export const fail = (msg) => {
  const e = new Error(msg);
  e.user = true;
  throw e;
};
export const num = (v, lo, hi, what) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) fail(`${what} must be between ${lo} and ${hi}.`);
  return n;
};
/** Round down to `places` decimals (payouts never round up). */
export const down = (n, places = 4) => Math.floor(n * 10 ** places + 1e-9) / 10 ** places;
export const pay = (bet, mult) => Math.floor(bet * mult + 1e-9);
/** Round a multiplier so it reads well: 36, 4.6, 0.54. */
export const nice = (m) => (m >= 10 ? Math.round(m) : m <= 0 ? 0 : Math.max(0.1, Number(m.toPrecision(2))));

/** Finer rounding for tables with few paying outcomes: 16.8, 3.85, 1,250. */
export const fine = (m) => (m >= 100 ? Math.round(m) : m <= 0 ? 0 : Math.max(0.1, Number(m.toPrecision(3))));

/** Scale `raw` multipliers (with their chances) so the nicely rounded table returns as close to R as it can without going over. */
export function scaleTable(raw, chances, R, round = nice) {
  const ret = (f) => raw.reduce((s, m, i) => s + round(m * f) * chances[i], 0);
  let lo = 1e-4, hi = 1e7;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (ret(mid) <= R) lo = mid;
    else hi = mid;
  }
  return { mults: raw.map((m) => round(m * lo)), rtp: ret(lo) };
}

/** Pick an index by weight with one uniform draw. */
export function weighted(weights, u) {
  const total = weights.reduce((s, w) => s + w, 0);
  let x = u * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}

/** k distinct values from 0..n-1 (partial Fisher–Yates). */
export function sample(n, k, rng) {
  const a = [...Array(n).keys()];
  for (let i = 0; i < k; i++) {
    const j = i + rng.int(n - i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

export const SUITS = ['♠', '♥', '♦', '♣'];
/** A card from an endless shoe. */
export const drawCard = (rng) => ({ rank: rng.int(13) + 1, suit: SUITS[rng.int(4)] });
/** A shuffled 52-card deck. */
export function deck52(rng) {
  const d = [];
  for (const suit of SUITS) for (let rank = 1; rank <= 13; rank++) d.push({ rank, suit });
  return sample(52, 52, rng).map((i) => d[i]);
}

/** The clock, swappable in tests. */
export const clock = { now: () => Date.now() };
