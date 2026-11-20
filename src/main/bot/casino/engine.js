// The web casino's games. Pure rules: no points, no storage. Every game gets a random source
// (`rng.int(n)` → 0..n-1, `rng.float()` → [0, 1)) and the house return (0.8–1) and says what a
// bet pays back as a multiple of what was staked. The casino service moves the points.
//
// Instant games: play(bet, params, rng, R) → { cost, payout, detail }.
// Round games (mines, hi-lo, blackjack): start() opens a round, move() plays it, view() is what
// the player may see (never the mine spots or the dealer's hidden card while it's running).
import { randomInt, randomBytes } from 'node:crypto';
import { plinkoBoard, dropBall } from '../plinko.js';
import { playSlots, slotsTable, LINES, SYMBOLS } from './slots.js';
import { fail, num, down, pay, nice, SUITS, drawCard as draw } from './kit.js';
import { MORE, moreInfo } from './more.js';

export const cryptoRng = {
  int: (n) => randomInt(n),
  float: () => randomBytes(6).readUIntBE(0, 6) / 2 ** 48,
};

// ─── Dice: roll 0.00–99.99, win under/over your line ───────────
const dice = {
  id: 'dice',
  name: 'Dice',
  blurb: 'Pick your odds, roll under or over.',
  play(bet, p, rng, R) {
    const chance = down(num(p.chance, 1, 95, 'Win chance'), 2);
    const over = !!p.over;
    const roll = rng.int(10000) / 100;
    const win = over ? roll >= 100 - chance : roll < chance;
    const mult = down((R * 100) / chance);
    return { cost: bet, payout: win ? pay(bet, mult) : 0, detail: { roll, chance, over, mult, win } };
  },
};

// ─── Rocket: pick a target, the rocket flies to a random height ─
// The height is R / (1 − u), so it reaches any target t with chance R / t.
const rocket = {
  id: 'rocket',
  name: 'Rocket',
  blurb: 'Set a target. If the rocket flies past it, you win it.',
  play(bet, p, rng, R) {
    const target = down(num(p.target, 1.01, 1000, 'Target'), 2);
    const raw = R / (1 - rng.float());
    const point = Math.min(1_000_000, Math.max(1, down(raw, 2)));
    const win = raw >= target;
    return { cost: bet, payout: win ? pay(bet, target) : 0, detail: { point, target, win, mult: target } };
  },
};

// ─── Roulette: one green zero ───────────────────────────────────
export const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const ROULETTE = {
  straight: { pays: 36, ok: (v) => Number.isInteger(v) && v >= 0 && v <= 36, hit: (n, v) => n === v },
  red: { pays: 2, hit: (n) => RED.includes(n) },
  black: { pays: 2, hit: (n) => n > 0 && !RED.includes(n) },
  odd: { pays: 2, hit: (n) => n > 0 && n % 2 === 1 },
  even: { pays: 2, hit: (n) => n > 0 && n % 2 === 0 },
  low: { pays: 2, hit: (n) => n >= 1 && n <= 18 },
  high: { pays: 2, hit: (n) => n >= 19 },
  dozen: { pays: 3, ok: (v) => [1, 2, 3].includes(v), hit: (n, v) => n > 0 && Math.ceil(n / 12) === v },
  column: { pays: 3, ok: (v) => [1, 2, 3].includes(v), hit: (n, v) => n > 0 && ((n - 1) % 3) + 1 === v },
};
const roulette = {
  id: 'roulette',
  name: 'Roulette',
  blurb: 'One zero, chips on as many spots as you like.',
  fixedOdds: true,
  // `bet` is ignored: the chips on the table are the bet.
  play(_bet, p, rng) {
    const chips = Array.isArray(p.bets) ? p.bets.slice(0, 60) : [];
    if (!chips.length) fail('Put a chip on the table first.');
    const clean = chips.map((c) => {
      const t = ROULETTE[c?.type];
      if (!t) fail('Unknown roulette bet.');
      const value = c.value == null ? null : Number(c.value);
      if (t.ok && !t.ok(value)) fail('That roulette bet isn’t on the table.');
      const amount = Math.floor(Number(c.amount));
      if (!(amount >= 1)) fail('Every chip needs an amount.');
      return { type: c.type, value, amount };
    });
    const cost = clean.reduce((s, c) => s + c.amount, 0);
    const n = rng.int(37);
    const results = clean.map((c) => ({ ...c, win: ROULETTE[c.type].hit(n, c.value) ? c.amount * ROULETTE[c.type].pays : 0 }));
    const payout = results.reduce((s, c) => s + c.win, 0);
    return { cost, payout, detail: { number: n, color: n === 0 ? 'green' : RED.includes(n) ? 'red' : 'black', results } };
  },
};

// ─── Wheel: 30 segments, three risk levels ───────────────────────
const WHEEL_SHAPES = {
  low: [[9, 0], [13, 1.2], [6, 1.5], [1, 2], [1, 3]],
  medium: [[15, 0], [7, 1.5], [4, 2], [2, 3], [1, 4], [1, 10]],
  high: [[26, 0], [2, 4], [1, 10], [1, 30]],
};
const wheelCache = new Map();
export function wheelSegments(risk, R) {
  const key = risk + "|" + R;
  if (!wheelCache.has(key)) wheelCache.set(key, buildWheel(risk, R));
  return wheelCache.get(key);
}
function buildWheel(risk, R) {
  const shape = WHEEL_SHAPES[risk] || WHEEL_SHAPES.medium;
  const total = shape.reduce((s, [c]) => s + c, 0);
  const ret = (f) => shape.reduce((s, [c, m]) => s + c * nice(m * f), 0) / total;
  let lo = 0.5, hi = 1.5;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ret(mid) <= R) lo = mid;
    else hi = mid;
  }
  const values = shape.flatMap(([c, m]) => Array(c).fill(nice(m * lo))).sort((a, b) => b - a);
  // Lay them out spread around the wheel (7 and 30 share no factor, so every slot gets one).
  const segs = Array(total);
  values.forEach((v, i) => (segs[(i * 7) % total] = v));
  return { segments: segs, rtp: ret(lo) };
}
const wheel = {
  id: 'wheel',
  name: 'Wheel',
  blurb: 'Spin for a multiplier. Riskier wheels pay bigger.',
  play(bet, p, rng, R) {
    const risk = WHEEL_SHAPES[p.risk] ? p.risk : 'medium';
    const { segments } = wheelSegments(risk, R);
    const index = rng.int(segments.length);
    const mult = segments[index];
    return { cost: bet, payout: pay(bet, mult), detail: { risk, index, mult } };
  },
};

// ─── Plinko (same board as the chat game) ───────────────────────
const plinko = {
  id: 'plinko',
  name: 'Plinko',
  blurb: 'Drop balls through the pegs. The edges pay the most.',
  play(bet, p, rng, R) {
    const balls = Math.floor(num(p.balls ?? 1, 1, 10, 'Balls'));
    const board = plinkoBoard({ rows: p.rows, risk: p.risk, returnPercent: R * 100 });
    const drops = Array.from({ length: balls }, () => {
      const { path, slot } = dropBall(board.rows, rng.float);
      const mult = board.multipliers[slot];
      return { path, slot, mult, win: pay(bet, mult) };
    });
    return { cost: bet * balls, payout: drops.reduce((s, d) => s + d.win, 0), detail: { rows: board.rows, risk: board.risk, per: bet, drops } };
  },
};

// ─── Slots ───────────────────────────────────────────────────────
const slots = {
  id: 'slots',
  name: 'Steez Slots',
  blurb: '5 reels, 10 lines, wilds and free spins.',
  play(bet, _p, rng, R) {
    const { spins, mult } = playSlots(rng, R * 100);
    return {
      cost: bet,
      payout: pay(bet, mult),
      detail: { mult: down(mult, 2), spins: spins.map((s) => ({ grid: s.grid, wins: s.wins.map((w) => ({ ...w, win: pay(bet, s.free ? w.mult * 2 : w.mult) })), stars: s.stars, scatter: pay(bet, s.free ? s.scatter * 2 : s.scatter), freeSpins: s.freeSpins, free: !!s.free, win: pay(bet, s.mult) })) },
    };
  },
};

// ─── Mines: 25 tiles, pick safe ones, cash out any time ──────────
export const minesMult = (mines, picks, R) => {
  let m = R;
  for (let i = 0; i < picks; i++) m *= (25 - i) / (25 - mines - i);
  return down(m, 4);
};
const mines = {
  id: 'mines',
  name: 'Mines',
  blurb: 'Find gems, dodge mines, cash out before it blows.',
  round: true,
  start(bet, p, rng) {
    const count = Math.floor(num(p.mines ?? 3, 1, 24, 'Mines'));
    const tiles = [...Array(25).keys()];
    for (let i = 0; i < count; i++) {
      const j = i + rng.int(25 - i);
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }
    return { bet, mines: count, bombs: tiles.slice(0, count).sort((a, b) => a - b), picks: [] };
  },
  move(s, mv, _rng, R) {
    if (mv.move === 'cashout') {
      if (!s.picks.length) fail('Pick at least one tile first.');
      return { done: true, payout: pay(s.bet, minesMult(s.mines, s.picks.length, R)), cashed: true };
    }
    if (mv.move !== 'reveal') fail('Unknown move.');
    const tile = Number(mv.tile);
    if (!Number.isInteger(tile) || tile < 0 || tile > 24) fail('Pick a tile on the board.');
    if (s.picks.includes(tile)) fail('You already opened that tile.');
    if (s.bombs.includes(tile)) {
      s.hit = tile;
      return { done: true, payout: 0 };
    }
    s.picks.push(tile);
    if (s.picks.length === 25 - s.mines) return { done: true, payout: pay(s.bet, minesMult(s.mines, s.picks.length, R)), cashed: true };
    return { done: false };
  },
  view(s, R, done) {
    return {
      mines: s.mines,
      picks: s.picks,
      mult: s.picks.length ? minesMult(s.mines, s.picks.length, R) : 0,
      next: s.picks.length < 25 - s.mines ? minesMult(s.mines, s.picks.length + 1, R) : null,
      ...(done ? { bombs: s.bombs, hit: s.hit ?? null } : {}),
    };
  },
};

// ─── Cards (infinite deck: every card is a fresh draw) ──────────

// ─── Hi-Lo: guess if the next card is higher or lower ────────────
const hiloChance = (rank, dir) => (dir === 'hi' ? (14 - rank) / 13 : rank / 13);
const hilo = {
  id: 'hilo',
  name: 'Hi-Lo',
  blurb: 'Higher or lower? Every right guess grows the multiplier.',
  round: true,
  start(bet, _p, rng) {
    return { bet, card: draw(rng), product: 1, steps: 0, history: [] };
  },
  move(s, mv, rng, R) {
    if (mv.move === 'cashout') {
      if (!s.steps) fail('Make at least one guess first.');
      return { done: true, payout: pay(s.bet, down(R * s.product)), cashed: true };
    }
    if (mv.move === 'skip') {
      if (s.history.filter((h) => h.skip).length >= 50) fail('That’s enough skipping for one round.');
      const next = draw(rng);
      s.history.push({ from: s.card, card: next, skip: true });
      s.card = next;
      return { done: false };
    }
    if (mv.move !== 'hi' && mv.move !== 'lo') fail('Unknown move.');
    const chance = hiloChance(s.card.rank, mv.move);
    if (chance >= 1) fail('That one can’t lose. Pick the other way or skip the card.');
    const next = draw(rng);
    const win = mv.move === 'hi' ? next.rank >= s.card.rank : next.rank <= s.card.rank;
    s.history.push({ from: s.card, card: next, guess: mv.move, win });
    s.card = next;
    if (!win) return { done: true, payout: 0 };
    s.product *= 1 / chance;
    s.steps++;
    if (R * s.product >= 10_000) return { done: true, payout: pay(s.bet, down(R * s.product)), cashed: true };
    return { done: false };
  },
  view(s, R) {
    const r = s.card.rank;
    return {
      card: s.card,
      steps: s.steps,
      mult: s.steps ? down(R * s.product) : 0,
      hi: { chance: hiloChance(r, 'hi'), mult: down(R * s.product / hiloChance(r, 'hi')) },
      lo: { chance: hiloChance(r, 'lo'), mult: down(R * s.product / hiloChance(r, 'lo')) },
      history: s.history.slice(-12),
    };
  },
};

// ─── Blackjack: dealer stands on all 17s, blackjack pays 3:2, one split ─
const cardValue = (c) => (c.rank === 1 ? 1 : Math.min(10, c.rank));
export function handTotal(cards) {
  let t = cards.reduce((s, c) => s + cardValue(c), 0);
  const soft = cards.some((c) => c.rank === 1) && t + 10 <= 21;
  if (soft) t += 10;
  return { total: t, soft };
}
const isBlackjack = (cards) => cards.length === 2 && handTotal(cards).total === 21;
function settleBlackjack(s, rng) {
  const live = s.hands.filter((h) => handTotal(h.cards).total <= 21);
  if (live.length) while (handTotal(s.dealer).total < 17) s.dealer.push(draw(rng));
  const d = handTotal(s.dealer).total;
  let payout = 0;
  for (const h of s.hands) {
    const t = handTotal(h.cards).total;
    h.result = t > 21 ? 'bust' : d > 21 || t > d ? 'win' : t === d ? 'push' : 'lose';
    h.win = h.result === 'win' ? h.bet * 2 : h.result === 'push' ? h.bet : 0;
    payout += h.win;
  }
  return payout;
}
function nextHand(s) {
  while (s.i < s.hands.length && s.hands[s.i].done) s.i++;
  return s.i < s.hands.length;
}
const blackjack = {
  id: 'blackjack',
  name: 'Blackjack',
  blurb: 'Beat the dealer to 21. Blackjack pays 3 to 2.',
  round: true,
  fixedOdds: true,
  start(bet, _p, rng) {
    const s = { bet, hands: [{ cards: [draw(rng), draw(rng)], bet, done: false }], dealer: [draw(rng), draw(rng)], i: 0, split: false };
    const p = isBlackjack(s.hands[0].cards);
    const d = isBlackjack(s.dealer);
    if (p || d) {
      const h = s.hands[0];
      h.done = true;
      h.result = p && d ? 'push' : p ? 'blackjack' : 'lose';
      h.win = p && d ? bet : p ? Math.floor(bet * 2.5) : 0;
      s.instant = { payout: h.win };
    }
    return s;
  },
  // Extra points a move needs before it can be played.
  cost(s, mv) {
    return mv.move === 'double' || mv.move === 'split' ? s.hands[s.i]?.bet || 0 : 0;
  },
  move(s, mv, rng) {
    const h = s.hands[s.i];
    if (!h) fail('This hand is over.');
    const finish = () => {
      h.done = true;
      if (nextHand(s)) return { done: false };
      return { done: true, payout: settleBlackjack(s, rng) };
    };
    const t = () => handTotal(h.cards).total;
    switch (mv.move) {
      case 'hit':
        if (h.splitAces) fail('Split aces get one card each.');
        h.cards.push(draw(rng));
        return t() >= 21 ? finish() : { done: false };
      case 'stand':
        return finish();
      case 'double':
        if (h.cards.length !== 2 || h.splitAces) fail('You can only double on your first two cards.');
        h.bet *= 2;
        h.doubled = true;
        h.cards.push(draw(rng));
        return finish();
      case 'split': {
        if (s.split || h.cards.length !== 2 || cardValue(h.cards[0]) !== cardValue(h.cards[1])) fail('You can split a pair once.');
        s.split = true;
        const aces = h.cards[0].rank === 1;
        const second = { cards: [h.cards[1], draw(rng)], bet: h.bet, done: aces, splitAces: aces };
        h.cards = [h.cards[0], draw(rng)];
        h.splitAces = aces;
        s.hands.splice(s.i + 1, 0, second);
        if (aces) {
          h.done = true;
          s.i = s.hands.length;
          return { done: true, payout: settleBlackjack(s, rng) };
        }
        return t() >= 21 ? finish() : { done: false };
      }
      default:
        fail('Unknown move.');
    }
  },
  view(s, _R, done) {
    const h = s.hands[s.i];
    const pair = h && h.cards.length === 2 && cardValue(h.cards[0]) === cardValue(h.cards[1]);
    return {
      hands: s.hands.map((x, i) => ({ cards: x.cards, bet: x.bet, total: handTotal(x.cards), done: x.done, doubled: !!x.doubled, result: x.result || null, win: x.win ?? null, active: !done && i === s.i })),
      dealer: done ? { cards: s.dealer, total: handTotal(s.dealer) } : { cards: [s.dealer[0], null], total: handTotal([s.dealer[0]]) },
      can: done || !h ? [] : ['hit', 'stand', ...(h.cards.length === 2 && !h.splitAces ? ['double'] : []), ...(pair && !s.split ? ['split'] : [])].filter((m) => !(h.splitAces && m === 'hit')),
    };
  },
};

// Lobby order. (The old target-only Rocket became Crash, in more.js.)
export const GAMES = { slots, crash: MORE.crash, plinko, mines, dice, wheel, keno: MORE.keno, tower: MORE.tower, coinflip: MORE.coinflip, hilo, cases: MORE.cases, scratch: MORE.scratch, blackjack, roulette, baccarat: MORE.baccarat, videopoker: MORE.videopoker };
export { rocket };

/** What the website needs to draw each game (boards, pay tables), for this return. */
export function gameInfo(id, R) {
  const g = GAMES[id];
  const base = { id, name: g.name, blurb: g.blurb, round: !!g.round, fixedOdds: !!g.fixedOdds };
  if (id === 'wheel') return { ...base, wheels: Object.fromEntries(Object.keys(WHEEL_SHAPES).map((r) => [r, wheelSegments(r, R).segments])) };
  if (id === 'plinko') {
    const boards = {};
    for (const risk of ['low', 'medium', 'high']) for (let rows = 8; rows <= 16; rows++) boards[`${risk}-${rows}`] = plinkoBoard({ rows, risk, returnPercent: R * 100 }).multipliers;
    return { ...base, boards };
  }
  if (id === 'slots') {
    const t = slotsTable(R * 100);
    const r2 = (x) => Math.round(x * 100) / 100;
    const r4 = (x) => Math.round(x * 10000) / 10000;
    return { ...base, symbols: SYMBOLS, lines: LINES, pays: Object.fromEntries(Object.entries(t.line).map(([k, v]) => [k, v.map(r4)])), scatter: Object.fromEntries(Object.entries(t.scatter).map(([k, v]) => [k, r2(v)])), freeSpins: t.freeSpins, freeSpinMult: t.freeSpinMult };
  }
  return { ...base, ...moreInfo(id, R) };
}
