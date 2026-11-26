// The web casino, Steez side. The casino website sends each viewer's bet through the Steez relay
// to this app (the streamer's PC), because the points live here. Every outcome is decided here
// with a crypto-grade random source; the website only shows what happened.
import { bot } from '../core/bot.js';
import { db, save, findUser } from '../store.js';
import { recordPlay, onPnlReset } from '../pnl.js';
import { normLogin } from '../util.js';
import { GAMES, gameInfo, cryptoRng } from './engine.js';

const C = () => db.settings.casino;
const R = () => Math.min(100, Math.max(80, Number(C().returnPercent) || 97)) / 100;
const store = () => {
  db.casino ||= {};
  db.casino.rounds ||= {};
  db.casino.feed ||= [];
  return db.casino;
};
let rng = cryptoRng;
// Every settled play, newest first, for the site's live bets table (kept in memory only).
const recent = [];
/** Test hook: a predictable random source. */
export const _setRng = (r) => (rng = r || cryptoRng);

export const pnlKey = (id) => `casino_${id}`;
export const gameOn = (id) => !!GAMES[id] && C().games?.[id] !== false;

const fail = (msg) => {
  const e = new Error(msg);
  e.user = true;
  throw e;
};

let infoCache = { key: '', games: [] };
function games() {
  const ids = Object.keys(GAMES).filter(gameOn);
  const key = `${R()}|${ids}`;
  if (infoCache.key !== key) infoCache = { key, games: ids.map((id) => gameInfo(id, R())) };
  return infoCache.games;
}

let topCache = { t: 0, list: [] };
onPnlReset(() => (topCache = { t: 0, list: [] }));
function top() {
  if (Date.now() - topCache.t < 30_000) return topCache.list;
  const list = [];
  for (const u of Object.values(db.users)) {
    if (!u.pnl) continue;
    let net = 0, plays = 0;
    for (const [k, g] of Object.entries(u.pnl)) if (k.startsWith('casino_')) (net += g.paid - g.staked), (plays += g.plays);
    if (plays) list.push({ user: u.display, net, plays });
  }
  topCache = { t: Date.now(), list: list.sort((a, b) => b.net - a.net).slice(0, 10) };
  return topCache.list;
}

const balance = (login) => findUser(login)?.points || 0;
/** A viewer's profit or loss across the casino games. */
const casinoNet = (u) => Object.entries(u?.pnl || {}).reduce((s, [k, g]) => (k.startsWith('casino_') ? s + g.paid - g.staked : s), 0);
const fmtMult = (m) => `${m >= 100 ? Math.round(m) : Math.round(m * 100) / 100}×`;

/** Settle: points change, profit & loss, the big-wins list and (for huge ones) a line in chat. */
function settle(login, display, id, staked, payout, alreadyTaken) {
  bot.addPoints(login, payout - (alreadyTaken ? 0 : staked), display);
  recordPlay(login, display, pnlKey(id), staked, payout);
  const mult = staked ? payout / staked : 0;
  const c = C();
  recent.unshift({ t: Date.now(), user: display, game: id, name: GAMES[id].name, staked, payout, mult: Math.round(mult * 100) / 100 });
  recent.length = Math.min(recent.length, 50);
  if (payout > staked && mult >= (Number(c.feedFrom) || 5)) {
    const feed = store().feed;
    feed.unshift({ t: Date.now(), user: display, game: GAMES[id].name, staked, payout, mult: Math.round(mult * 100) / 100 });
    feed.length = Math.min(feed.length, 30);
    save();
  }
  if (c.announceFrom > 0 && payout > staked && mult >= c.announceFrom) {
    Promise.resolve(bot.say(`🎰 ${display} hit ${fmtMult(mult)} on ${GAMES[id].name} at the casino: +${bot.fmtPoints(payout - staked)}!`)).catch(() => {});
  }
}

function checkBet(amount) {
  const c = C();
  if (!Number.isFinite(amount) || amount < 1) fail('Enter a bet.');
  if (amount < (c.minBet || 1)) fail(`The minimum bet is ${bot.fmtPoints(c.minBet || 1)}.`);
  if (c.maxBet > 0 && amount > c.maxBet) fail(`The maximum bet is ${bot.fmtPoints(c.maxBet)}.`);
}

function info(login, display) {
  const c = C();
  const rounds = store().rounds[login] || {};
  return {
    title: String(c.title || ''),
    currency: bot.currency,
    minBet: c.minBet || 1,
    maxBet: c.maxBet || 0,
    returnPercent: Math.round(R() * 1000) / 10,
    games: games(),
    me: { login, display, balance: balance(login), known: !!findUser(login), net: casinoNet(findUser(login)) },
    rounds: Object.fromEntries(Object.entries(rounds).filter(([id]) => GAMES[id]).map(([id, r]) => [id, { view: GAMES[id].view(r.s, R(), false), staked: r.staked }])),
    feed: store().feed.slice(0, 20),
    recent: recent.slice(0, 30),
    top: top(),
  };
}

function bet(login, display, a) {
  const id = String(a.game || '');
  const g = GAMES[id];
  if (!g || !gameOn(id)) fail('That game is closed.');
  const amount = Math.floor(Number(a.bet));
  const params = a.params && typeof a.params === 'object' ? a.params : {};
  // chip games (roulette, baccarat): the chips on the table are the bet
  const chips = id === 'roulette' || id === 'baccarat';
  if (!chips) checkBet(amount);
  const have = balance(login);

  if (!g.round) {
    const out = g.play(amount, params, rng, R());
    if (chips) checkBet(out.cost);
    if (out.cost > have) fail(`That costs ${bot.fmtPoints(out.cost)} — you have ${bot.fmtPoints(have)}.`);
    settle(login, display, id, out.cost, out.payout);
    return { done: true, result: out.detail, cost: out.cost, payout: out.payout, balance: balance(login) };
  }

  const rounds = (store().rounds[login] ||= {});
  // a crash round that has already blown (or hit its auto cash-out) settles itself first
  if (rounds[id] && g.expires) {
    const old = rounds[id];
    const out = g.move(old.s, { move: 'status' }, rng, R());
    if (out.done) {
      delete rounds[id];
      settle(login, display, id, old.staked, out.payout, true);
    }
  }
  if (rounds[id]) fail('Finish the round you already have going first.');
  if (amount > have) fail(`You only have ${bot.fmtPoints(have)}.`);
  const s = g.start(amount, params, rng, R());
  bot.addPoints(login, -amount, display);
  if (s.instant) {
    settle(login, display, id, amount, s.instant.payout, true);
    return { done: true, view: g.view(s, R(), true), staked: amount, payout: s.instant.payout, balance: balance(login) };
  }
  rounds[id] = { s, staked: amount, t: Date.now() };
  save();
  return { done: false, view: g.view(s, R(), false), staked: amount, balance: balance(login) };
}

function move(login, display, a) {
  const id = String(a.game || '');
  const g = GAMES[id];
  if (!g?.round) fail('That game has no moves.');
  const rounds = store().rounds[login] || {};
  const r = rounds[id];
  if (!r) fail('That round is over. Place a new bet.');
  const mv = { move: String(a.move || ''), tile: a.tile, at: a.at, hold: a.hold };
  const extra = g.cost?.(r.s, mv) || 0;
  if (extra) {
    if (balance(login) < extra) fail(`You need ${bot.fmtPoints(extra)} more for that.`);
    bot.addPoints(login, -extra, display);
    r.staked += extra;
  }
  let out;
  try {
    out = g.move(r.s, mv, rng, R());
  } catch (e) {
    if (extra) {
      bot.addPoints(login, extra, display);
      r.staked -= extra;
    }
    throw e;
  }
  if (!out.done) {
    save();
    return { done: false, view: g.view(r.s, R(), false), staked: r.staked, balance: balance(login) };
  }
  delete rounds[id];
  settle(login, display, id, r.staked, out.payout, true);
  return { done: true, view: g.view(r.s, R(), true), staked: r.staked, payout: out.payout, cashed: !!out.cashed, balance: balance(login) };
}

/** One request from the casino website. `who` comes from the relay's verified Twitch login. */
export function casinoCall(action, args = {}, who = {}) {
  if (!C()?.enabled) fail('The casino is closed right now.');
  const login = normLogin(who.login);
  if (!/^[a-z0-9_]{1,25}$/.test(login)) fail('Log in with Twitch first.');
  const display = String(who.display || login).slice(0, 25);
  switch (action) {
    case 'info':
      return info(login, display);
    case 'bet':
      return bet(login, display, args || {});
    case 'move':
      return move(login, display, args || {});
    default:
      fail('Unknown casino action.');
  }
}

/** The streamer's view: who's played, how the house is doing. */
export function casinoStats() {
  const games = Object.fromEntries(Object.keys(GAMES).map((id) => [id, { id, name: GAMES[id].name, plays: 0, staked: 0, paid: 0, players: 0 }]));
  for (const u of Object.values(db.users)) {
    for (const [k, g] of Object.entries(u.pnl || {})) {
      const id = k.startsWith('casino_') ? k.slice(7) : null;
      if (!games[id]) continue;
      games[id].plays += g.plays;
      games[id].staked += g.staked;
      games[id].paid += g.paid;
      games[id].players++;
    }
  }
  return { games: Object.values(games), feed: store().feed.slice(0, 20), top: top(), open: Object.values(store().rounds).reduce((s, r) => s + Object.keys(r).length, 0) };
}
