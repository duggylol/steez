// Jackpot: everyone puts points in, one winner is drawn who takes the whole pot.
// Each player's share of the reel's spots (and chance to win) is their share of the pot.

/**
 * Pick the winner. players: [{ amount }] in join order.
 * Returns { index, at } — at (0..1) is where the roll landed if the players' shares were laid end to
 * end, kept away from the edges of the winner's share. The overlay uses it to pick which of the
 * winner's spots the reel stops on, and where in that spot.
 */
export function pickWinner(players, rand = Math.random) {
  const total = players.reduce((s, p) => s + p.amount, 0);
  if (!players.length || !(total > 0)) return null;
  let r = rand() * total;
  let start = 0;
  for (let i = 0; i < players.length; i++) {
    const a = players[i].amount;
    if (r < a || i === players.length - 1) {
      const at = (start + a * (0.1 + 0.8 * rand())) / total;
      return { index: i, at };
    }
    r -= a;
    start += a;
  }
  return null;
}

/** "12.5%" style chance for a stake. */
export const chanceOf = (amount, pot) => {
  const p = pot > 0 ? (amount / pot) * 100 : 0;
  return `${p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)}%`;
};
