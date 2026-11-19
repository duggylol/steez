// Gambling profit & loss: every settled play of a points game (what went in, what came back),
// kept per viewer and per game in db.users[login].pnl. Refunds and cancelled rounds aren't plays.
import { db, getUser, save } from './store.js';

export const PNL_GAMES = { gamble: 'Gamble', slots: 'Slots', duel: 'Duel', heist: 'Heist', jackpot: 'Jackpot', plinko: 'Plinko', bets: 'Bets' };

const blank = () => ({ plays: 0, wins: 0, staked: 0, paid: 0, best: 0, worst: 0 });

/** One settled play: `staked` points went in, `paid` came back (0 = lost it all). */
export function recordPlay(login, display, game, staked, paid) {
  staked = Math.max(0, Math.round(Number(staked) || 0));
  paid = Math.max(0, Math.round(Number(paid) || 0));
  if (!login || !PNL_GAMES[game] || !staked) return;
  const u = getUser(login, display);
  u.pnl ||= {};
  const g = (u.pnl[game] ||= blank());
  const net = paid - staked;
  g.plays++;
  if (net > 0) g.wins++;
  g.staked += staked;
  g.paid += paid;
  if (net > g.best) g.best = net;
  if (net < g.worst) g.worst = net;
  save();
}

/** One viewer's totals and per-game lines (games they've played only, biggest swing first). */
export function viewerPnl(u) {
  const games = Object.entries(u?.pnl || {})
    .filter(([k, g]) => PNL_GAMES[k] && g.plays)
    .map(([game, g]) => ({ game, label: PNL_GAMES[game], ...g, net: g.paid - g.staked }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  const sum = (k) => games.reduce((s, g) => s + g[k], 0);
  return {
    plays: sum('plays'),
    wins: sum('wins'),
    staked: sum('staked'),
    paid: sum('paid'),
    net: sum('paid') - sum('staked'),
    best: Math.max(0, ...games.map((g) => g.best)),
    worst: Math.min(0, ...games.map((g) => g.worst)),
    games,
  };
}

/** The whole channel: per-game totals, and the viewers most up and most down. skip: logins to leave out. */
export function channelPnl({ skip = new Set(), top = 5 } = {}) {
  const games = Object.fromEntries(Object.entries(PNL_GAMES).map(([game, label]) => [game, { game, label, players: 0, ...blank() }]));
  const people = [];
  for (const u of Object.values(db.users)) {
    if (!u.pnl || skip.has(u.login)) continue;
    const v = viewerPnl(u);
    if (!v.plays) continue;
    people.push({ user: u.display, login: u.login, net: v.net, plays: v.plays, staked: v.staked });
    for (const g of v.games) {
      const t = games[g.game];
      t.players++;
      t.plays += g.plays;
      t.wins += g.wins;
      t.staked += g.staked;
      t.paid += g.paid;
      t.best = Math.max(t.best, g.best);
      t.worst = Math.min(t.worst, g.worst);
    }
  }
  const list = Object.values(games).map((g) => ({ ...g, net: g.paid - g.staked }));
  const sum = (k) => list.reduce((s, g) => s + g[k], 0);
  return {
    players: people.length,
    plays: sum('plays'),
    staked: sum('staked'),
    paid: sum('paid'),
    net: sum('paid') - sum('staked'),
    games: list,
    winners: people.filter((p) => p.net > 0).sort((a, b) => b.net - a.net).slice(0, top),
    losers: people.filter((p) => p.net < 0).sort((a, b) => a.net - b.net).slice(0, top),
  };
}

/** Start everyone's PnL over. */
export function resetPnl() {
  for (const u of Object.values(db.users)) delete u.pnl;
  save();
}
