// The web casino: game maths (each game pays back what it promises) and the Steez side that
// moves the points (limits, rounds that survive between requests, profit & loss, big wins).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.STEEZ_BOT_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tbcasino-'));
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...a) => realSetInterval(...a).unref();

const { bot } = await import('../src/main/bot/core/bot.js');
const { db } = await import('../src/main/bot/store.js');
const { GAMES, gameInfo, minesMult, wheelSegments, handTotal, cryptoRng } = await import('../src/main/bot/casino/engine.js');
const { slotsTable, playSlots, _raw } = await import('../src/main/bot/casino/slots.js');
const { casinoCall, _setRng } = await import('../src/main/bot/casino/service.js');
const more = await import('../src/main/bot/casino/more.js');
const { clock } = await import('../src/main/bot/casino/kit.js');
const { viewerPnl } = await import('../src/main/bot/pnl.js');

const mathRng = { int: (n) => Math.floor(Math.random() * n), float: Math.random };
/** A random source that plays back fixed numbers (ints and floats share the queue). */
const scripted = (list) => {
  const q = [...list];
  return { int: (n) => (q.length ? q.shift() % n : 0), float: () => (q.length ? q.shift() : 0.5) };
};
const said = [];

before(async () => {
  await bot.init();
  bot.say = async (t) => said.push(t);
  db.settings.casino.enabled = true;
});

test('crypto random source stays in range', () => {
  for (let i = 0; i < 2000; i++) {
    const f = cryptoRng.float();
    assert.ok(f >= 0 && f < 1);
    const n = cryptoRng.int(7);
    assert.ok(Number.isInteger(n) && n >= 0 && n < 7);
  }
});

test('dice, keno, cases and scratch pay back the house return', () => {
  const R = 0.97;
  for (const [game, params] of [['dice', { chance: 20, over: true }], ['dice', { chance: 66 }], ['keno', { picks: [1, 2, 3, 4, 5], risk: 'low' }], ['cases', { tier: 'bronze' }], ['scratch', {}]]) {
    let staked = 0, paid = 0;
    for (let i = 0; i < 200_000; i++) {
      const r = GAMES[game].play(1000, params, mathRng, R);
      staked += r.cost;
      paid += r.payout;
    }
    assert.ok(Math.abs(paid / staked - R) < 0.025, `${game} ${JSON.stringify(params)}: ${paid / staked}`);
  }
  assert.throws(() => GAMES.dice.play(10, { chance: 99 }, mathRng, 0.97), /between 1 and 95/);
  assert.throws(() => GAMES.keno.play(10, { picks: [0, 41] }, mathRng, 0.97), /Pick 1 to 10/);
  // every keno, case and scratch table is built to the return (rounding keeps them a little under)
  for (const risk of ['low', 'medium', 'high']) for (let n = 1; n <= 10; n++) assert.ok(Math.abs(more.kenoTable(risk, n, R).rtp - R) < 0.01, `keno ${risk} ${n}`);
  for (const t of ['bronze', 'silver', 'gold', 'diamond']) assert.ok(Math.abs(more.caseItems(t, R).rtp - R) < 0.02, `case ${t}`);
  assert.ok(Math.abs(more.scratchTable(R).rtp - R) < 0.02);
});

test('scratch cards: three of the winning symbol, never three of anything else', () => {
  for (let i = 0; i < 3000; i++) {
    const r = GAMES.scratch.play(10, {}, mathRng, 0.97);
    const counts = {};
    r.detail.grid.forEach((s) => (counts[s] = (counts[s] || 0) + 1));
    for (const [sym, n] of Object.entries(counts)) assert.ok(sym === r.detail.symbol ? n === 3 : n <= 2, JSON.stringify(r.detail));
    if (r.detail.symbol) assert.deepEqual(r.detail.cells.map((c) => r.detail.grid[c]), [r.detail.symbol, r.detail.symbol, r.detail.symbol]);
  }
});

test('tower and coin flip: cashing out at any point is worth exactly the return', () => {
  const R = 0.97;
  for (const [level, L] of Object.entries(more.TOWER_LEVELS))
    for (let k = 1; k <= 8; k++) assert.ok(Math.abs(((L.cols - L.traps) / L.cols) ** k * more.towerMult(level, k, R) - R) < 1e-3, `${level} ${k}`);
  const s = GAMES.coinflip.start(100);
  assert.equal(GAMES.coinflip.move(s, { move: 'heads' }, scripted([1]), R).done, false);
  const out = GAMES.coinflip.move(s, { move: 'cashout' }, scripted([]), R);
  assert.equal(out.payout, 194);
  const t = GAMES.tower.start(100, { level: 'hard' }, scripted([0, 0, 0, 0, 0, 0, 0, 0]));
  assert.equal(GAMES.tower.move(t, { move: 'pick', tile: 1 }, null, R).done, false);
  assert.equal(GAMES.tower.move(t, { move: 'pick', tile: 0 }, null, R).payout, 0);
});

test('crash: the clock decides, auto cash-out pays exactly its target', () => {
  const R = 0.97;
  let now = 1_000_000;
  const real = clock.now;
  clock.now = () => now;
  try {
    const s = GAMES.crash.start(100, {}, scripted([0.5]), R); // point 1.94
    assert.equal(s.point, 1.94);
    now += 2000; // ~1.22x
    assert.equal(GAMES.crash.move(s, { move: 'status' }).done, false);
    const out = GAMES.crash.move(s, { move: 'cashout', at: 1.2 });
    assert.deepEqual([out.done, out.payout], [true, 120]);
    // claiming more than the rocket has climbed pays what it has climbed
    const s2 = GAMES.crash.start(100, {}, scripted([0.5]), R);
    now += 1000;
    assert.equal(GAMES.crash.move(s2, { move: 'cashout', at: 1.9 }).payout, Math.floor(100 * more.crashAt(1000)));
    // too late: after the crash moment the round is lost whatever the screen showed
    const s3 = GAMES.crash.start(100, {}, scripted([0.5]), R);
    now += more.crashTime(1.94) + 10;
    assert.equal(GAMES.crash.move(s3, { move: 'cashout', at: 1.5 }).payout, 0);
    const s4 = GAMES.crash.start(100, { auto: 1.5 }, scripted([0.5]), R);
    now += more.crashTime(1.6);
    assert.equal(GAMES.crash.move(s4, { move: 'status' }).payout, 150);
  } finally {
    clock.now = real;
  }
});

test('baccarat follows the drawing rules and pays the table', () => {
  // player 2+3 = 5 draws a 4 (total 9); banker 10+5 = 5, player's third is 4 → banker draws a 2 (total 7)
  const deal = () => scripted([1, 0, 2, 0, 9, 0, 4, 0, 3, 0, 1, 0]);
  const hand = more.dealBaccarat(deal());
  assert.deepEqual([hand.pt, hand.bt, hand.winner], [9, 7, 'player']);
  const r = GAMES.baccarat.play(0, { bets: [{ on: 'player', amount: 10 }, { on: 'tie', amount: 5 }] }, deal());
  assert.deepEqual([r.cost, r.payout], [15, 20]);
  assert.throws(() => GAMES.baccarat.play(0, { bets: [] }, mathRng), /chip/);
});

test('video poker ranks hands and pays the 9/6 table', () => {
  const c = (s) => s.split(' ').map((x) => ({ rank: { A: 1, K: 13, Q: 12, J: 11, T: 10 }[x[0]] || Number(x[0]), suit: x[1] }));
  assert.equal(more.pokerHand(c('A♠ K♠ Q♠ J♠ T♠')), 'royal');
  assert.equal(more.pokerHand(c('A♠ 2♥ 3♦ 4♣ 5♠')), 'straight');
  assert.equal(more.pokerHand(c('J♠ J♥ 3♦ 4♣ 9♠')), 'jacks');
  assert.equal(more.pokerHand(c('T♠ T♥ 3♦ 4♣ 9♠')), null);
  assert.equal(more.pokerHand(c('9♠ 9♥ 9♦ 4♣ 4♠')), 'fullhouse');
  const s = GAMES.videopoker.start(10, {}, mathRng);
  const held = s.hand.slice(0, 2);
  const out = GAMES.videopoker.move(s, { move: 'draw', hold: [true, true, false, false, false] });
  assert.equal(out.done, true);
  assert.deepEqual(s.hand.slice(0, 2), held);
  assert.equal(new Set(s.hand.map((x) => x.rank + x.suit)).size, 5); // one real deck, no repeats
});

test('mines: cashing out after any number of gems is worth exactly the return', () => {
  const R = 0.97;
  for (const mines of [1, 3, 10, 24]) {
    for (let k = 1; k <= 25 - mines; k++) {
      let survive = 1;
      for (let i = 0; i < k; i++) survive *= (25 - mines - i) / (25 - i);
      assert.ok(Math.abs(survive * minesMult(mines, k, R) - R) < 1e-3, `${mines} mines, ${k} gems`);
    }
  }
});

test('wheel, plinko and slots boards hit their return', () => {
  for (const risk of ['low', 'medium', 'high']) {
    const w = wheelSegments(risk, 0.97);
    assert.equal(w.segments.length, 30);
    assert.ok(Math.abs(w.rtp - 0.97) < 0.025, `wheel ${risk}: ${w.rtp}`);
  }
  assert.equal(slotsTable(96).rtp.toFixed(6), '0.960000');
  assert.ok(_raw.spinsPer > 0 && _raw.spinsPer < 0.2);
  let paid = 0;
  const N = 150_000;
  for (let i = 0; i < N; i++) paid += playSlots(mathRng, 96).mult;
  assert.ok(Math.abs(paid / N - 0.96) < 0.04, `slots simulated ${paid / N}`);
  const info = gameInfo('plinko', 0.97);
  assert.equal(Object.keys(info.boards).length, 27);
});

test('roulette pays table odds', () => {
  const g = GAMES.roulette;
  const r = g.play(0, { bets: [{ type: 'straight', value: 17, amount: 10 }, { type: 'red', amount: 10 }, { type: 'column', value: 2, amount: 5 }] }, scripted([17]));
  assert.equal(r.cost, 25);
  assert.equal(r.detail.number, 17);
  assert.equal(r.payout, 360 + 0 + 15); // 17 is black, in column 2
  const zero = g.play(0, { bets: [{ type: 'even', amount: 10 }, { type: 'low', amount: 10 }] }, scripted([0]));
  assert.equal(zero.payout, 0);
  assert.throws(() => g.play(0, { bets: [{ type: 'straight', value: 37, amount: 1 }] }, mathRng), /isn’t on the table/);
  assert.throws(() => g.play(0, { bets: [] }, mathRng), /chip/);
});

test('blackjack: naturals, dealer drawing to 17, doubles and splits', () => {
  const bj = GAMES.blackjack;
  // ranks: player A,K → blackjack against dealer 9,7
  let s = bj.start(100, {}, scripted([0, 0, 12, 0, 8, 0, 6, 0]));
  assert.equal(s.instant.payout, 250);
  // player 10,6 vs dealer 10,7: stand → dealer has 17 → lose
  s = bj.start(100, {}, scripted([9, 0, 5, 0, 9, 0, 6, 0]));
  assert.equal(s.instant, undefined);
  let out = bj.move(s, { move: 'stand' }, scripted([]));
  assert.deepEqual([out.done, out.payout], [true, 0]);
  // player 5,6 vs dealer 10,6: double draws a 10 → 21; dealer draws 5 → 21 → push on a doubled bet
  s = bj.start(100, {}, scripted([4, 0, 5, 0, 9, 0, 5, 0]));
  assert.equal(bj.cost(s, { move: 'double' }), 100);
  out = bj.move(s, { move: 'double' }, scripted([9, 0, 4, 0]));
  assert.equal(s.hands[0].bet, 200);
  assert.equal(handTotal(s.hands[0].cards).total, 21);
  assert.equal(out.payout, 200);
  // a pair of 8s splits into two hands, played one after the other
  s = bj.start(100, {}, scripted([7, 0, 7, 1, 9, 0, 6, 0]));
  out = bj.move(s, { move: 'split' }, scripted([2, 0, 3, 0]));
  assert.equal(s.hands.length, 2);
  assert.equal(out.done, false);
  out = bj.move(s, { move: 'stand' }, scripted([]));
  out = bj.move(s, { move: 'stand' }, scripted([]));
  assert.equal(out.done, true);
  assert.throws(() => bj.move(s, { move: 'hit' }, scripted([])), /over/);
  assert.equal(handTotal([{ rank: 1 }, { rank: 6 }]).soft, true);
});

test('casino service: bets move points, record PnL and respect limits', () => {
  db.users.alice = { login: 'alice', display: 'Alice', points: 1000, stats: {}, achievements: {} };
  const who = { login: 'alice', display: 'Alice' };
  const info = casinoCall('info', {}, who);
  assert.equal(info.me.balance, 1000);
  assert.equal(info.games.length, 16);

  _setRng(scripted([0])); // roll 0.00 → under 50 wins
  const r = casinoCall('bet', { game: 'dice', bet: 100, params: { chance: 50 } }, who);
  assert.equal(r.result.win, true);
  assert.equal(r.payout, 194);
  assert.equal(db.users.alice.points, 1094);
  assert.equal(viewerPnl(db.users.alice).games[0].label, 'Casino Dice');

  assert.throws(() => casinoCall('bet', { game: 'dice', bet: 5, params: { chance: 50 } }, who), /minimum bet/);
  db.settings.casino.maxBet = 500;
  assert.throws(() => casinoCall('bet', { game: 'dice', bet: 600, params: { chance: 50 } }, who), /maximum bet/);
  db.settings.casino.maxBet = 0;
  assert.throws(() => casinoCall('bet', { game: 'dice', bet: 5000, params: { chance: 50 } }, who), /you have/);
  db.settings.casino.games.dice = false;
  assert.throws(() => casinoCall('bet', { game: 'dice', bet: 100, params: { chance: 50 } }, who), /closed/);
  db.settings.casino.games.dice = true;
  assert.throws(() => casinoCall('bet', {}, { login: '' }), /Log in/);
  db.settings.casino.enabled = false;
  assert.throws(() => casinoCall('info', {}, who), /closed/);
  db.settings.casino.enabled = true;
  _setRng(null);
});

test('rounds survive between requests and pay on cash out', () => {
  db.users.bob = { login: 'bob', display: 'Bob', points: 1000, stats: {}, achievements: {} };
  const who = { login: 'bob', display: 'Bob' };
  // mines at tiles 0,1,2 (the shuffle keeps the first three when every pick is 0)
  _setRng(scripted([0, 0, 0]));
  const start = casinoCall('bet', { game: 'mines', bet: 100, params: { mines: 3 } }, who);
  assert.equal(start.done, false);
  assert.equal(start.view.bombs, undefined); // never shown while playing
  assert.equal(db.users.bob.points, 900);
  assert.throws(() => casinoCall('bet', { game: 'mines', bet: 100, params: { mines: 3 } }, who), /already/);
  assert.ok(casinoCall('info', {}, who).rounds.mines);
  const step = casinoCall('move', { game: 'mines', move: 'reveal', tile: 10 }, who);
  assert.equal(step.done, false);
  const end = casinoCall('move', { game: 'mines', move: 'cashout' }, who);
  assert.equal(end.done, true);
  assert.equal(end.payout, Math.floor(100 * minesMult(3, 1, 0.97)));
  assert.deepEqual(end.view.bombs, [0, 1, 2]);
  assert.equal(db.users.bob.points, 900 + end.payout);
  assert.throws(() => casinoCall('move', { game: 'mines', move: 'cashout' }, who), /over/);

  // a blackjack double takes the extra stake, and gives it back if the move is refused
  _setRng(scripted([4, 0, 5, 0, 9, 0, 5, 0]));
  const before = db.users.bob.points;
  casinoCall('bet', { game: 'blackjack', bet: 100 }, who);
  db.users.bob.points = 50; // can't afford to double
  assert.throws(() => casinoCall('move', { game: 'blackjack', move: 'double' }, who), /more/);
  assert.equal(db.users.bob.points, 50);
  db.users.bob.points = before - 100;
  _setRng(scripted([9, 0, 4, 0]));
  const d = casinoCall('move', { game: 'blackjack', move: 'double' }, who);
  assert.equal(d.staked, 200);
  assert.equal(d.payout, 200); // 21 vs 21 push
  assert.equal(db.users.bob.points, before);
  _setRng(null);
});

test('big wins go on the list and the biggest are announced in chat', () => {
  db.users.cara = { login: 'cara', display: 'Cara', points: 1000, stats: {}, achievements: {} };
  db.settings.casino.announceFrom = 50;
  _setRng(scripted([0])); // roll 0.00 under a 1% line pays 97×
  const r = casinoCall('bet', { game: 'dice', bet: 10, params: { chance: 1 } }, { login: 'cara', display: 'Cara' });
  assert.equal(r.payout, 970);
  const info = casinoCall('info', {}, { login: 'cara' });
  assert.equal(info.feed[0].user, 'Cara');
  assert.equal(info.feed[0].mult, 97);
  assert.equal(info.recent[0].user, 'Cara');
  assert.match(said.at(-1), /Cara hit 97× on Dice/);
  _setRng(null);
});

test('resetting PnL (one viewer or everyone) clears the casino leaderboard right away', async () => {
  const { resetViewerPnl, resetPnl } = await import('../src/main/bot/pnl.js');
  resetPnl(); // start clean (this also drops the leaderboard's 30-second cache)
  db.users.dana = { login: 'dana', display: 'Dana', points: 1000, stats: {}, achievements: {} };
  _setRng(scripted([0, 0]));
  casinoCall('bet', { game: 'dice', bet: 10, params: { chance: 50 } }, { login: 'dana', display: 'Dana' });
  casinoCall('bet', { game: 'dice', bet: 10, params: { chance: 50 } }, { login: 'alice', display: 'Alice' });
  _setRng(null);
  assert.ok(casinoCall('info', {}, { login: 'dana' }).top.some((t) => t.user === 'Dana'));
  assert.equal(resetViewerPnl('@Dana'), true);
  assert.equal(db.users.dana.pnl, undefined);
  assert.equal(resetViewerPnl('dana'), false); // nothing left to reset
  assert.ok(!casinoCall('info', {}, { login: 'dana' }).top.some((t) => t.user === 'Dana'));
  assert.ok(db.users.alice.pnl);
  resetPnl();
  assert.equal(db.users.alice.pnl, undefined);
  assert.deepEqual(casinoCall('info', {}, { login: 'dana' }).top, []);
});
