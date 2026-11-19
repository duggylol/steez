import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plinkoBoard, dropBall, ballColor } from '../src/main/bot/plinko.js';

test('boards are symmetric, one slot per landing spot, and pay back about the target', () => {
  for (const risk of ['low', 'medium', 'high']) {
    for (let rows = 8; rows <= 16; rows++) {
      for (const returnPercent of [90, 97, 100]) {
        const b = plinkoBoard({ rows, risk, returnPercent });
        assert.equal(b.multipliers.length, rows + 1);
        assert.deepEqual(b.multipliers, [...b.multipliers].reverse());
        assert.ok(Math.abs(b.chances.reduce((s, c) => s + c, 0) - 1) < 1e-9);
        assert.ok(Math.abs(b.rtp * 100 - returnPercent) < 2.5, `${risk} ${rows} ${returnPercent}: ${b.rtp}`);
        // the edges pay the most and the middle the least
        assert.equal(Math.max(...b.multipliers), b.multipliers[0]);
        assert.equal(Math.min(...b.multipliers), b.multipliers[Math.floor(rows / 2)]);
      }
    }
  }
});

test('higher risk = bigger edges and a smaller middle', () => {
  const [low, med, high] = ['low', 'medium', 'high'].map((risk) => plinkoBoard({ rows: 12, risk }));
  assert.ok(low.multipliers[0] < med.multipliers[0] && med.multipliers[0] < high.multipliers[0]);
  assert.ok(low.multipliers[6] > med.multipliers[6] && med.multipliers[6] > high.multipliers[6]);
});

test('bad settings fall back to something sane', () => {
  assert.equal(plinkoBoard({ rows: 99 }).rows, 16);
  assert.equal(plinkoBoard({ rows: 'nope' }).rows, 12);
  assert.equal(plinkoBoard({ risk: 'insane' }).risk, 'medium');
  assert.equal(plinkoBoard({ rows: '10' }).rows, 10); // the settings select stores text
});

test('a ball lands in the slot its path leads to, mostly near the middle', () => {
  const { path, slot } = dropBall(12, () => 0.9); // all rights
  assert.equal(path.length, 12);
  assert.equal(slot, 12);
  assert.equal(dropBall(8, () => 0.1).slot, 0);
  const counts = Array(13).fill(0);
  for (let i = 0; i < 20000; i++) {
    const d = dropBall(12);
    assert.equal(d.slot, d.path.reduce((s, b) => s + b, 0));
    counts[d.slot]++;
  }
  assert.ok(counts[6] > counts[3] && counts[3] > counts[0]);
  assert.ok(counts[6] / 20000 > 0.19 && counts[6] / 20000 < 0.26); // 924 / 4096 ≈ 22.6%
});

test('ball colors: readable, from the Twitch color when there is one, never clashing', () => {
  const hex = /^#[0-9a-f]{6}$/;
  const red = ballColor('a', '#FF0000');
  assert.match(red, hex);
  assert.match(ballColor('b', ''), hex);
  assert.equal(ballColor('same', ''), ballColor('same', '')); // stable per viewer
  // pure blue gets lifted so it shows on the dark board
  const blue = parseInt(ballColor('c', '#0000FF').slice(1), 16);
  assert.ok(((blue >> 16) & 255) > 60 && ((blue >> 8) & 255) > 60);
  // a second viewer with the same Twitch color gets pushed to another hue
  assert.notEqual(ballColor('d', '#FF0000', [red]), red);
});
