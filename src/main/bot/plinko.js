// Plinko: a ball falls through `rows` rows of pegs, bouncing left or right at each one (50/50),
// and lands in one of rows + 1 slots. Slot k is reached by k rights, so the middle slots are
// the most likely and the edges the rarest. Each slot pays a multiplier of the ball's bet.
//
// The multipliers aren't a fixed table: they're shaped by the risk level (how steep the edges are)
// and then scaled so the board pays back `returnPercent` of what's bet, on average.

// How steep the payouts rise toward the edges.
export const PLINKO_RISKS = { low: 2, medium: 4.5, high: 7 };

// Overlay pacing. The chat reply waits until the last ball has landed on the overlay.
export const PLINKO_TIMING = { revealMs: 700, staggerMs: 280, stepMs: 170, settleMs: 300 };

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Pascal's row: ways to land in each slot. */
function ways(n) {
  const c = [1];
  for (let k = 1; k <= n; k++) c[k] = (c[k - 1] * (n - k + 1)) / k;
  return c;
}

/** Round a multiplier so it reads nicely on the board: 36, 4.6, 0.54. */
const nice = (m) => (m >= 10 ? Math.round(m) : Math.max(0.1, Number(m.toPrecision(2))));

/** The board for these settings: rows, multipliers per slot, each slot's chance and the real return. */
export function plinkoBoard({ rows = 12, risk = 'medium', returnPercent = 97 } = {}) {
  rows = clamp(Math.round(Number(rows) || 12), 8, 16);
  if (!PLINKO_RISKS[risk]) risk = 'medium';
  const steep = PLINKO_RISKS[risk];
  const target = clamp(Number(returnPercent) || 97, 10, 200) / 100;
  const c = ways(rows);
  const total = 2 ** rows;
  const chances = c.map((w) => w / total);
  const half = rows / 2;
  const shape = chances.map((_, k) => Math.exp(steep * Math.pow(Math.abs(k - half) / half, 1.5)));
  const avg = shape.reduce((s, v, k) => s + v * chances[k], 0);
  const build = (scale) => shape.map((v) => nice((v * scale) / avg));
  const ret = (ms) => ms.reduce((s, m, k) => s + m * chances[k], 0);
  // Rounding moves the return a little, so nudge the scale until the rounded board is as close
  // to the target as it gets without going over.
  let lo = target * 0.8, hi = target * 1.2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ret(build(mid)) <= target) lo = mid;
    else hi = mid;
  }
  let multipliers = build(lo);
  if (Math.abs(ret(build(hi)) - target) < Math.abs(ret(multipliers) - target) - 0.002) multipliers = build(hi);
  return { rows, risk, multipliers, chances, rtp: ret(multipliers) };
}

/** One ball: a left (0) or right (1) bounce at every row. The slot is the number of rights. */
export function dropBall(rows, rand = Math.random) {
  const path = Array.from({ length: rows }, () => (rand() < 0.5 ? 0 : 1));
  return { path, slot: path.reduce((s, b) => s + b, 0) };
}

// ── Ball colors ──
// A viewer's ball is their Twitch name color (brightened so it shows on a dark board). Viewers
// without one get a color from their name. Two viewers on the board at once never share a color.

function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function hslToHex({ h, s, l }) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const v = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const hashHue = (s) => {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 360;
};

const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** A bright, readable ball color for this viewer that's at least 30° of hue away from `taken`. */
export function ballColor(login, twitchColor, taken = []) {
  let c = hexToHsl(twitchColor);
  if (!c || c.s < 0.25) c = { h: hashHue(login), s: 0.85, l: 0.62 }; // no color, or a grey one
  const blue = c.h > 205 && c.h < 285; // blues look darker than they are
  c = { h: c.h, s: Math.max(c.s, 0.65), l: clamp(c.l, blue ? 0.68 : 0.56, 0.74) };
  const hues = taken.map(hexToHsl).filter(Boolean).map((t) => t.h);
  for (let i = 0; i < 12 && hues.some((h) => hueGap(h, c.h) < 30); i++) c.h = (c.h + 37) % 360;
  return hslToHex(c);
}
