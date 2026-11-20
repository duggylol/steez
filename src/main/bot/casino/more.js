// More casino games: Crash, Keno, Tower, Coin Flip, Cases, Scratch, Baccarat and Video Poker.
// Same contract as engine.js: instant games have play(), round games have start/move/view.
import { fail, num, down, pay, nice, fine, scaleTable, weighted, sample, drawCard, deck52, clock } from './kit.js';

// ─── Crash ────────────────────────────────────────────────────────
// The multiplier climbs with time: m(t) = e^(r·t). The crash point is R / (1 − u), so the rocket
// reaches any multiplier x with chance R / x. Cash out before it blows. The clock that counts is
// Steez's: a cash-out that arrives after the crash moment has lost, whatever the screen showed.
export const CRASH_RATE = 0.0001; // per ms: 2× at ~6.9 s, 10× at ~23 s, 100× at ~46 s
export const crashAt = (ms) => Math.max(1, down(Math.exp(CRASH_RATE * Math.max(0, ms)), 2));
export const crashTime = (m) => Math.log(Math.max(1, m)) / CRASH_RATE;
const crash = {
  id: 'crash',
  name: 'Crash',
  blurb: 'Ride the rocket. Cash out before it blows up.',
  round: true,
  expires: true, // a round left alone ends by itself when the rocket blows
  start(bet, p, rng, R) {
    const auto = p.auto ? down(num(p.auto, 1.01, 1000, 'Auto cash-out'), 2) : 0;
    const point = Math.min(10_000, Math.max(1, down(R / (1 - rng.float()), 2)));
    return { bet, point, auto, t0: clock.now() };
  },
  move(s, mv) {
    const e = clock.now() - s.t0;
    // auto cash-out: paid at exactly the target, if the rocket got there
    if (s.auto && s.point >= s.auto && e >= crashTime(s.auto)) {
      s.cashedAt = s.auto;
      return { done: true, payout: pay(s.bet, s.auto), cashed: true };
    }
    if (s.point <= 1 || e >= crashTime(s.point)) {
      s.busted = true;
      return { done: true, payout: 0 };
    }
    if (mv.move === 'status') return { done: false };
    if (mv.move !== 'cashout') fail('Unknown move.');
    const now = crashAt(e);
    const at = Number(mv.at);
    // the screen runs a little behind; pay what it showed, never more than the real climb
    const claim = Number.isFinite(at) && at >= 1 && at <= now ? down(at, 2) : now;
    s.cashedAt = claim;
    return { done: true, payout: pay(s.bet, claim), cashed: true };
  },
  view(s, _R, done) {
    return { elapsed: clock.now() - s.t0, auto: s.auto, ...(done ? { point: s.point, cashedAt: s.cashedAt ?? null } : {}) };
  },
};

// ─── Keno: 40 numbers, pick 1–10, 10 are drawn ────────────────────
const choose = (n, k) => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};
const KENO_RISK = { low: { from: 0.34, pow: 1.8 }, medium: { from: 0.5, pow: 2.6 }, high: { from: 0.6, pow: 3.6 } };
// Tables only change with the settings, so each is built once.
const memo = (fn) => {
  const cache = new Map();
  return (...a) => {
    const k = a.join("|");
    if (!cache.has(k)) cache.set(k, fn(...a));
    return cache.get(k);
  };
};
export const kenoTable = memo(function kenoTable(risk, picks, R) {
  const cfg = KENO_RISK[risk] || KENO_RISK.medium;
  const chances = Array.from({ length: picks + 1 }, (_, k) => (choose(picks, k) * choose(40 - picks, 10 - k)) / choose(40, 10));
  const minHit = Math.max(1, Math.ceil(picks * cfg.from));
  const raw = chances.map((_, k) => (k < minHit ? 0 : (k - minHit + 1) ** cfg.pow));
  return { ...scaleTable(raw, chances, R, fine), chances };
});
const keno = {
  id: 'keno',
  name: 'Keno',
  blurb: 'Pick up to 10 numbers. The more that come up, the bigger the pay.',
  play(bet, p, rng, R) {
    const picks = Array.isArray(p.picks) ? [...new Set(p.picks.map(Number))] : [];
    if (!picks.length || picks.length > 10 || picks.some((n) => !Number.isInteger(n) || n < 1 || n > 40)) fail('Pick 1 to 10 numbers from 1 to 40.');
    const risk = KENO_RISK[p.risk] ? p.risk : 'medium';
    const drawn = sample(40, 10, rng).map((i) => i + 1);
    const hits = picks.filter((n) => drawn.includes(n));
    const mult = kenoTable(risk, picks.length, R).mults[hits.length];
    return { cost: bet, payout: pay(bet, mult), detail: { drawn, hits, picks, risk, mult } };
  },
};

// ─── Tower: climb 8 floors, dodge the traps ───────────────────────
export const TOWER_LEVELS = { easy: { cols: 4, traps: 1 }, medium: { cols: 3, traps: 1 }, hard: { cols: 2, traps: 1 }, expert: { cols: 3, traps: 2 }, master: { cols: 4, traps: 3 } };
export const TOWER_FLOORS = 8;
export const towerMult = (level, floors, R) => {
  const L = TOWER_LEVELS[level];
  return floors ? down(R / ((L.cols - L.traps) / L.cols) ** floors) : 0;
};
const tower = {
  id: 'tower',
  name: 'Tower',
  blurb: 'Climb floor by floor. One wrong tile and you fall.',
  round: true,
  start(bet, p, rng) {
    const level = TOWER_LEVELS[p.level] ? p.level : 'medium';
    const L = TOWER_LEVELS[level];
    return { bet, level, traps: Array.from({ length: TOWER_FLOORS }, () => sample(L.cols, L.traps, rng).sort()), picks: [] };
  },
  move(s, mv, _rng, R) {
    if (mv.move === 'cashout') {
      if (!s.picks.length) fail('Climb at least one floor first.');
      return { done: true, payout: pay(s.bet, towerMult(s.level, s.picks.length, R)), cashed: true };
    }
    if (mv.move !== 'pick') fail('Unknown move.');
    const L = TOWER_LEVELS[s.level];
    const tile = Number(mv.tile);
    if (!Number.isInteger(tile) || tile < 0 || tile >= L.cols) fail('Pick a tile on this floor.');
    const floor = s.picks.length;
    if (s.traps[floor].includes(tile)) {
      s.hit = { floor, tile };
      return { done: true, payout: 0 };
    }
    s.picks.push(tile);
    if (s.picks.length === TOWER_FLOORS) return { done: true, payout: pay(s.bet, towerMult(s.level, TOWER_FLOORS, R)), cashed: true };
    return { done: false };
  },
  view(s, R, done) {
    const L = TOWER_LEVELS[s.level];
    return {
      level: s.level,
      cols: L.cols,
      floors: TOWER_FLOORS,
      picks: s.picks,
      mult: towerMult(s.level, s.picks.length, R),
      next: s.picks.length < TOWER_FLOORS ? towerMult(s.level, s.picks.length + 1, R) : null,
      ...(done ? { traps: s.traps, hit: s.hit ?? null } : {}),
    };
  },
};

// ─── Coin Flip: call it, double it, cash out ──────────────────────
const COIN_MAX = 20;
const coinMult = (streak, R) => (streak ? down(R * 2 ** streak) : 0);
const coinflip = {
  id: 'coinflip',
  name: 'Coin Flip',
  blurb: 'Heads or tails. Every right call doubles it.',
  round: true,
  start(bet) {
    return { bet, streak: 0, flips: [] };
  },
  move(s, mv, rng, R) {
    if (mv.move === 'cashout') {
      if (!s.streak) fail('Win at least one flip first.');
      return { done: true, payout: pay(s.bet, coinMult(s.streak, R)), cashed: true };
    }
    if (mv.move !== 'heads' && mv.move !== 'tails') fail('Call heads or tails.');
    const side = rng.int(2) ? 'heads' : 'tails';
    const win = side === mv.move;
    s.flips.push({ call: mv.move, side, win });
    if (!win) return { done: true, payout: 0 };
    s.streak++;
    if (s.streak >= COIN_MAX) return { done: true, payout: pay(s.bet, coinMult(s.streak, R)), cashed: true };
    return { done: false };
  },
  view(s, R) {
    return { streak: s.streak, mult: coinMult(s.streak, R), next: coinMult(s.streak + 1, R), flips: s.flips.slice(-20), max: COIN_MAX };
  },
};

// ─── Cases: open a chest, win what's inside ───────────────────────
const CASE_SHAPES = {
  bronze: [[30, 0.3], [30, 0.6], [20, 1], [12, 1.6], [5, 3], [2.5, 6], [0.5, 20]],
  silver: [[35, 0.2], [25, 0.5], [18, 1.2], [12, 2], [6, 4], [3, 10], [0.9, 25], [0.1, 100]],
  gold: [[45, 0.1], [25, 0.4], [14, 1.5], [9, 3], [4.5, 8], [2, 20], [0.45, 60], [0.05, 500]],
  diamond: [[60, 0], [20, 0.5], [10, 2], [6, 5], [3, 15], [0.9, 50], [0.09, 250], [0.01, 2500]],
};
export const caseItems = memo(function caseItems(tier, R) {
  const shape = CASE_SHAPES[tier] || CASE_SHAPES.silver;
  const total = shape.reduce((s, [w]) => s + w, 0);
  const chances = shape.map(([w]) => w / total);
  const { mults, rtp } = scaleTable(shape.map(([, m]) => m), chances, R, fine);
  return { items: mults.map((mult, i) => ({ mult, chance: chances[i], rarity: i })), rtp };
});
const cases = {
  id: 'cases',
  name: 'Cases',
  blurb: 'Open a chest. Rarer finds pay more.',
  play(bet, p, rng, R) {
    const tier = CASE_SHAPES[p.tier] ? p.tier : 'silver';
    const { items } = caseItems(tier, R);
    const index = weighted(items.map((x) => x.chance), rng.float());
    return { cost: bet, payout: pay(bet, items[index].mult), detail: { tier, index, mult: items[index].mult } };
  },
};

// ─── Scratch: three matching symbols win ──────────────────────────
const SCRATCH = [['cherry', 0.12, 1], ['lemon', 0.08, 2], ['plum', 0.05, 3], ['bell', 0.03, 5], ['bar', 0.012, 10], ['seven', 0.004, 25], ['gem', 0.0015, 50], ['crown', 0.0002, 250]];
export const scratchTable = memo(function scratchTable(R) {
  const { mults, rtp } = scaleTable(SCRATCH.map(([, , m]) => m), SCRATCH.map(([, p]) => p), R, fine);
  return { prizes: SCRATCH.map(([symbol, chance], i) => ({ symbol, chance, mult: mults[i] })), rtp };
});
const scratch = {
  id: 'scratch',
  name: 'Scratch',
  blurb: 'Scratch nine spots. Three of a kind wins.',
  play(bet, _p, rng, R) {
    const { prizes } = scratchTable(R);
    const noWin = 1 - prizes.reduce((s, x) => s + x.chance, 0);
    const pick = weighted([...prizes.map((x) => x.chance), noWin], rng.float());
    const winner = pick < prizes.length ? prizes[pick] : null;
    // fill the card: the winning symbol three times, everything else at most twice
    const grid = Array(9).fill(null);
    const cells = winner ? sample(9, 3, rng) : [];
    for (const c of cells) grid[c] = winner.symbol;
    const left = prizes.map((x) => x.symbol).filter((s) => s !== winner?.symbol);
    const count = Object.fromEntries(left.map((s) => [s, 0]));
    for (let i = 0; i < 9; i++) {
      if (grid[i]) continue;
      const open = left.filter((s) => count[s] < 2);
      const s = open[rng.int(open.length)];
      count[s]++;
      grid[i] = s;
    }
    const mult = winner ? winner.mult : 0;
    return { cost: bet, payout: pay(bet, mult), detail: { grid, symbol: winner?.symbol || null, cells: cells.sort((a, b) => a - b), mult } };
  },
};

// ─── Baccarat (endless shoe) ──────────────────────────────────────
const bacValue = (c) => (c.rank >= 10 ? 0 : c.rank);
const bacTotal = (cards) => cards.reduce((s, c) => s + bacValue(c), 0) % 10;
export const BACCARAT_PAYS = { player: 2, banker: 1.95, tie: 9 };
export function dealBaccarat(rng) {
  const player = [drawCard(rng), drawCard(rng)];
  const banker = [drawCard(rng), drawCard(rng)];
  const natural = bacTotal(player) >= 8 || bacTotal(banker) >= 8;
  if (!natural) {
    let third = null;
    if (bacTotal(player) <= 5) {
      third = drawCard(rng);
      player.push(third);
    }
    const b = bacTotal(banker);
    const t = third ? bacValue(third) : null;
    const draws = t === null ? b <= 5 : b <= 2 || (b === 3 && t !== 8) || (b === 4 && t >= 2 && t <= 7) || (b === 5 && t >= 4 && t <= 7) || (b === 6 && t >= 6 && t <= 7);
    if (draws) banker.push(drawCard(rng));
  }
  const pt = bacTotal(player), bt = bacTotal(banker);
  return { player, banker, pt, bt, winner: pt > bt ? 'player' : bt > pt ? 'banker' : 'tie' };
}
const baccarat = {
  id: 'baccarat',
  name: 'Baccarat',
  blurb: 'Back the Player, the Banker or a Tie.',
  fixedOdds: true,
  play(_bet, p, rng) {
    const chips = Array.isArray(p.bets) ? p.bets.slice(0, 10) : [];
    const clean = chips
      .map((c) => ({ on: String(c?.on), amount: Math.floor(Number(c?.amount)) }))
      .filter((c) => BACCARAT_PAYS[c.on] && c.amount >= 1);
    if (!clean.length) fail('Put a chip on Player, Banker or Tie.');
    const cost = clean.reduce((s, c) => s + c.amount, 0);
    const hand = dealBaccarat(rng);
    const results = clean.map((c) => ({ ...c, win: c.on === hand.winner ? pay(c.amount, BACCARAT_PAYS[c.on]) : hand.winner === 'tie' && c.on !== 'tie' ? c.amount : 0 }));
    return { cost, payout: results.reduce((s, c) => s + c.win, 0), detail: { ...hand, results } };
  },
};

// ─── Video Poker: Jacks or Better, 9/6 ────────────────────────────
export const POKER_PAYS = [
  ['royal', 'Royal Flush', 800],
  ['straightflush', 'Straight Flush', 50],
  ['four', 'Four of a Kind', 25],
  ['fullhouse', 'Full House', 9],
  ['flush', 'Flush', 6],
  ['straight', 'Straight', 4],
  ['three', 'Three of a Kind', 3],
  ['twopair', 'Two Pair', 2],
  ['jacks', 'Jacks or Better', 1],
];
export function pokerHand(cards) {
  const ranks = cards.map((c) => (c.rank === 1 ? 14 : c.rank)).sort((a, b) => a - b);
  const counts = Object.values(ranks.reduce((m, r) => ((m[r] = (m[r] || 0) + 1), m), {})).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const unique = new Set(ranks).size === 5;
  const wheel = ranks.join() === '2,3,4,5,14';
  const straight = unique && (ranks[4] - ranks[0] === 4 || wheel);
  if (straight && flush) return ranks[0] === 10 ? 'royal' : 'straightflush';
  if (counts[0] === 4) return 'four';
  if (counts[0] === 3 && counts[1] === 2) return 'fullhouse';
  if (flush) return 'flush';
  if (straight) return 'straight';
  if (counts[0] === 3) return 'three';
  if (counts[0] === 2 && counts[1] === 2) return 'twopair';
  if (counts[0] === 2) {
    const pair = ranks.find((r, i) => ranks.indexOf(r) !== i);
    if (pair >= 11) return 'jacks';
  }
  return null;
}
const pokerMult = (hand) => POKER_PAYS.find(([k]) => k === hand)?.[2] || 0;
const videopoker = {
  id: 'videopoker',
  name: 'Video Poker',
  blurb: 'Jacks or Better. Hold your best cards and draw.',
  round: true,
  fixedOdds: true,
  start(bet, _p, rng) {
    const d = deck52(rng);
    return { bet, hand: d.slice(0, 5), deck: d.slice(5, 10) }; // the next five are all a draw can ever need
  },
  move(s, mv) {
    if (mv.move !== 'draw') fail('Unknown move.');
    const hold = Array.isArray(mv.hold) ? mv.hold.slice(0, 5).map(Boolean) : [];
    let next = 0;
    s.hand = s.hand.map((c, i) => (hold[i] ? c : s.deck[next++]));
    s.held = hold;
    s.made = pokerHand(s.hand);
    return { done: true, payout: s.bet * pokerMult(s.made) };
  },
  view(s, _R, done) {
    const made = pokerHand(s.hand);
    return { hand: s.hand, made, label: POKER_PAYS.find(([k]) => k === made)?.[1] || null, ...(done ? { held: s.held || [] } : {}) };
  },
};

export const MORE = { crash, keno, tower, coinflip, cases, scratch, baccarat, videopoker };

/** What the website needs to draw these games. */
export function moreInfo(id, R) {
  if (id === 'crash') return { rate: CRASH_RATE };
  if (id === 'keno') {
    const tables = {};
    for (const risk of Object.keys(KENO_RISK)) for (let n = 1; n <= 10; n++) tables[`${risk}-${n}`] = kenoTable(risk, n, R).mults;
    return { tables };
  }
  if (id === 'tower') return { levels: Object.fromEntries(Object.entries(TOWER_LEVELS).map(([k, L]) => [k, { ...L, mults: Array.from({ length: TOWER_FLOORS }, (_, i) => towerMult(k, i + 1, R)) }])), floors: TOWER_FLOORS };
  if (id === 'coinflip') return { max: COIN_MAX, mults: Array.from({ length: COIN_MAX }, (_, i) => coinMult(i + 1, R)) };
  if (id === 'cases') return { tiers: Object.fromEntries(Object.keys(CASE_SHAPES).map((t) => [t, caseItems(t, R).items])) };
  if (id === 'scratch') return { prizes: scratchTable(R).prizes };
  if (id === 'baccarat') return { pays: BACCARAT_PAYS };
  if (id === 'videopoker') return { pays: POKER_PAYS.map(([key, label, mult]) => ({ key, label, mult })) };
  return {};
}
