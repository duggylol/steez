import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickWinner, chanceOf } from '../src/main/bot/jackpot.js';

const seq = (...xs) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

test('the winner is where the roll lands, weighted by stake', () => {
  const players = [{ amount: 100 }, { amount: 300 }, { amount: 600 }];
  assert.equal(pickWinner(players, seq(0.05, 0.5)).index, 0);
  assert.equal(pickWinner(players, seq(0.2, 0.5)).index, 1);
  assert.equal(pickWinner(players, seq(0.4, 0.5)).index, 2);
  assert.equal(pickWinner(players, seq(0.9999, 0.5)).index, 2);
});

test('the wheel lands inside the winner’s slice, away from its edges', () => {
  const players = [{ amount: 100 }, { amount: 300 }, { amount: 600 }];
  for (const r2 of [0, 0.5, 0.9999]) {
    const w = pickWinner(players, seq(0.2, r2)); // player 2's slice is 0.1–0.4 of the wheel
    assert.equal(w.index, 1);
    assert.ok(w.at >= 0.1 + 0.03 - 1e-9 && w.at <= 0.4 - 0.03 + 1e-9, `at ${w.at}`);
  }
});

test('over many rounds each player wins about their share', () => {
  const players = [{ amount: 100 }, { amount: 300 }, { amount: 600 }];
  const wins = [0, 0, 0];
  for (let i = 0; i < 20000; i++) wins[pickWinner(players).index]++;
  assert.ok(Math.abs(wins[0] / 20000 - 0.1) < 0.02, String(wins));
  assert.ok(Math.abs(wins[1] / 20000 - 0.3) < 0.02, String(wins));
  assert.ok(Math.abs(wins[2] / 20000 - 0.6) < 0.02, String(wins));
});

test('no players or an empty pot picks nobody; chance text', () => {
  assert.equal(pickWinner([]), null);
  assert.equal(pickWinner([{ amount: 0 }]), null);
  assert.equal(chanceOf(25, 100), '25%');
  assert.equal(chanceOf(1, 300), '0.3%');
  assert.equal(chanceOf(100, 100), '100%');
});
