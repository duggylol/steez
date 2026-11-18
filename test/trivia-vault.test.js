// The trivia vault: what ships is valid, and questions are picked by difficulty without repeats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVault, pickFromVault, pickDifficulty, vaultId, MIX } from '../src/main/bot/triviaVault.js';
import { normalizeAnswer } from '../src/main/bot/util.js';

const vault = loadVault();

test('the vault ships with at least 3,000 good questions', () => {
  assert.ok(vault.length >= 3000, `only ${vault.length}`);
  const ids = new Set();
  const qs = new Set();
  for (const x of vault) {
    assert.ok(['easy', 'medium', 'hard'].includes(x.d), x.q);
    assert.ok(x.q.length <= 160, x.q);
    assert.ok(x.a.length && x.a.every((a) => normalizeAnswer(a)), `answers for ${x.q}`);
    assert.equal(x.id, vaultId(x.q), 'ids come from the question');
    assert.ok(!ids.has(x.id), `twice: ${x.q}`);
    ids.add(x.id);
    qs.add(x.q.toLowerCase());
  }
  assert.equal(qs.size, vault.length);
  for (const d of ['easy', 'medium', 'hard']) assert.ok(vault.filter((x) => x.d === d).length >= 800, `enough ${d}`);
});

test('difficulty: mix is roughly 40/35/25, or one difficulty only', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const n = { easy: 0, medium: 0, hard: 0 };
  for (let i = 0; i < 10000; i++) n[pickDifficulty('mix', rand)]++;
  for (const d of Object.keys(MIX)) assert.ok(Math.abs(n[d] / 100 - MIX[d]) < 3, `${d}: ${n[d]}`);
  assert.equal(pickDifficulty('hard', rand), 'hard');
  assert.equal(pickDifficulty('nonsense', () => 0), 'easy');
});

test('picking: never a used question, the asked difficulty first, then anything left', () => {
  const small = [
    { id: '1', q: 'Easy one about cats?', a: ['x'], d: 'easy', c: 'animals' },
    { id: '2', q: 'Hard one about planets?', a: ['y'], d: 'hard', c: 'space' },
    { id: '3', q: 'Medium one about rivers?', a: ['z'], d: 'medium', c: 'rivers' },
  ];
  const used = new Set();
  const order = [];
  for (let i = 0; i < 3; i++) {
    const x = pickFromVault({ vault: small, used, difficulty: 'hard' });
    used.add(x.id);
    order.push(x.id);
  }
  assert.equal(order[0], '2', 'hard first');
  assert.deepEqual(new Set(order), new Set(['1', '2', '3']));
  assert.equal(pickFromVault({ vault: small, used, difficulty: 'easy' }), null, 'used up');
  // a topic matches the category or the question
  assert.equal(pickFromVault({ vault: small, used: new Set(), difficulty: 'easy', topic: 'planets' }).id, '2');
  assert.equal(pickFromVault({ vault: small, used: new Set(), difficulty: 'easy', topic: 'space' }).id, '2');
  assert.equal(pickFromVault({ vault: small, used: new Set(), difficulty: 'easy', topic: 'cooking' }), null);
  // skipped questions are passed over
  assert.equal(pickFromVault({ vault: small, used: new Set(['2', '3']), difficulty: 'easy', skip: (x) => x.id === '1' }), null);
  // recent subjects are avoided while others are left
  const two = [small[0], { id: '4', q: 'Easy one about pizza?', a: ['w'], d: 'easy', c: 'food' }];
  for (const r of [0, 0.99]) assert.equal(pickFromVault({ vault: two, used: new Set(), difficulty: 'easy', recentCategories: ['animals'], rand: () => r }).c, 'food');
});
