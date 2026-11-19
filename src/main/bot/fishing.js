// Fishing: the catch tiers (editable in Games settings) and one cast. No database or chat here.

// chancePercent is out of 100 (if the total isn't 100 the chances are scaled to fit).
// A catch pays between minPoints and maxPoints: the heavier the fish (5–20 lb), the closer to maxPoints.
// announce: shout it to the whole chat, show it on the overlay and unlock "Release the Kraken".
// catches: what can be caught in this tier, separated by commas.
export const DEFAULT_FISH_TIERS = [
  { tier: 'trash', emoji: '🥾', chancePercent: 22, minPoints: 0, maxPoints: 3, announce: false, catches: 'an old boot, a soggy sock, a tin can, a tangle of seaweed, a rubber duck' },
  { tier: 'common', emoji: '🐟', chancePercent: 39.999, minPoints: 3, maxPoints: 35, announce: false, catches: 'a minnow, a sardine, a perch, a sunfish, a carp' },
  { tier: 'uncommon', emoji: '🐠', chancePercent: 22, minPoints: 13, maxPoints: 105, announce: false, catches: 'a bass, a trout, a catfish, a pike' },
  { tier: 'rare', emoji: '🐡', chancePercent: 10, minPoints: 35, maxPoints: 280, announce: false, catches: 'a salmon, a swordfish, a tuna, a pufferfish' },
  { tier: 'epic', emoji: '🦑', chancePercent: 4.5, minPoints: 100, maxPoints: 900, announce: false, catches: 'a golden koi, a giant squid, an anglerfish' },
  { tier: 'legendary', emoji: '🐙', chancePercent: 1.2, minPoints: 500, maxPoints: 4500, announce: true, catches: 'THE KRAKEN, a shark wearing sunglasses, Nessie herself' },
  { tier: 'mythic', emoji: '💎', chancePercent: 0.3, minPoints: 2500, maxPoints: 16000, announce: true, catches: 'a glowing treasure chest, the Golden Leviathan' },
  { tier: 'godlike', emoji: '🔱', chancePercent: 0.001, minPoints: 1000000, maxPoints: 1000000, announce: true, catches: "Poseidon's lost trident, the World Serpent, an actual sea god" },
];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The tiers from settings, made safe to use (bad rows dropped, min/max in order). Falls back to the defaults. */
export function cleanTiers(raw) {
  const out = (Array.isArray(raw) ? raw : [])
    .map((t) => {
      const tier = String(t?.tier || '').trim() || 'fish';
      let min = Math.max(0, Math.round(num(t?.minPoints)));
      let max = Math.max(0, Math.round(num(t?.maxPoints)));
      if (min > max) [min, max] = [max, min];
      const names = String(t?.catches ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return {
        tier,
        emoji: String(t?.emoji || '').trim() || '🐟',
        chance: Math.max(0, num(t?.chancePercent)),
        min,
        max,
        announce: !!t?.announce,
        names: names.length ? names : [`a ${tier} fish`],
      };
    })
    .filter((t) => t.chance > 0);
  return out.length ? out : cleanTiers(DEFAULT_FISH_TIERS);
}

/** One cast: { tier, name, size, value }. rand is swappable for tests. */
export function castFish(rawTiers, rand = Math.random) {
  const tiers = cleanTiers(rawTiers);
  const total = tiers.reduce((s, t) => s + t.chance, 0);
  let r = rand() * total;
  let tier = tiers[tiers.length - 1];
  for (const t of tiers) {
    r -= t.chance;
    if (r < 0) {
      tier = t;
      break;
    }
  }
  const name = tier.names[Math.floor(rand() * tier.names.length)] || tier.names[0];
  const size = Math.round((rand() * 1.5 + 0.5) * 100) / 10; // 5.0 - 20.0 lb
  const value = Math.round(tier.min + (tier.max - tier.min) * ((size - 5) / 15));
  return { tier, name, size, value };
}
