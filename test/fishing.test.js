import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FISH_TIERS, cleanTiers, castFish } from '../src/main/bot/fishing.js';

// rand() that returns these numbers in order: [tier roll, name roll, size roll]
const seq = (...xs) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

test('default tiers add up to 100% and godlike is 0.001% for 1,000,000', () => {
  const total = DEFAULT_FISH_TIERS.reduce((s, t) => s + t.chancePercent, 0);
  assert.ok(Math.abs(total - 100) < 1e-9, `total ${total}`);
  const god = DEFAULT_FISH_TIERS.find((t) => t.tier === 'godlike');
  assert.equal(god.chancePercent, 0.001);
  assert.equal(god.minPoints, 1000000);
  assert.equal(god.maxPoints, 1000000);
  assert.equal(god.announce, true);
});

test('payout runs from min (5 lb) to max (20 lb)', () => {
  const tiers = [{ tier: 'only', chancePercent: 100, minPoints: 100, maxPoints: 400, catches: 'a fish' }];
  assert.deepEqual([castFish(tiers, seq(0.5, 0, 0)).size, castFish(tiers, seq(0.5, 0, 0)).value], [5, 100]);
  const big = castFish(tiers, seq(0.5, 0, 0.99999));
  assert.equal(big.size, 20);
  assert.equal(big.value, 400);
  assert.equal(castFish(tiers, seq(0.5, 0, 0.5)).value, 250); // 12.5 lb, halfway
});

test('godlike pays exactly 1,000,000 at any weight, and only on its tiny roll', () => {
  const godRoll = (100 - 0.0005) / 100; // the last 0.001% of the roll
  for (const size of [0, 0.5, 0.99]) {
    const c = castFish(DEFAULT_FISH_TIERS, seq(godRoll, 0, size));
    assert.equal(c.tier.tier, 'godlike');
    assert.equal(c.value, 1000000);
  }
  assert.equal(castFish(DEFAULT_FISH_TIERS, seq((100 - 0.002) / 100, 0, 0.5)).tier.tier, 'mythic');
  assert.equal(castFish(DEFAULT_FISH_TIERS, seq(0, 0, 0.5)).tier.tier, 'trash');
});

test('edited tiers: chances are relative, bad rows are dropped, catches split on commas', () => {
  const raw = [
    { tier: 'big', emoji: '🐳', chancePercent: 1, minPoints: 900, maxPoints: 100, catches: ' a whale ,, a orca ' },
    { tier: 'off', chancePercent: 0, minPoints: 1, maxPoints: 2, catches: 'x' },
    { tier: 'small', chancePercent: '3', minPoints: -5, maxPoints: 'abc', catches: '' },
  ];
  const tiers = cleanTiers(raw);
  assert.deepEqual(tiers.map((t) => t.tier), ['big', 'small']);
  assert.deepEqual([tiers[0].min, tiers[0].max], [100, 900]); // swapped into order
  assert.deepEqual(tiers[0].names, ['a whale', 'a orca']);
  assert.deepEqual([tiers[1].min, tiers[1].max, tiers[1].names], [0, 0, ['a small fish']]);
  // 1 : 3 — a roll at 20% lands in "big", 30% in "small"
  assert.equal(castFish(raw, seq(0.2, 0, 0)).tier.tier, 'big');
  assert.equal(castFish(raw, seq(0.3, 0, 0)).tier.tier, 'small');
});

test('nothing usable falls back to the default tiers', () => {
  assert.equal(cleanTiers([]).length, DEFAULT_FISH_TIERS.length);
  assert.equal(cleanTiers(undefined).length, DEFAULT_FISH_TIERS.length);
  assert.equal(cleanTiers([{ tier: 'x', chancePercent: 0 }]).length, DEFAULT_FISH_TIERS.length);
});
