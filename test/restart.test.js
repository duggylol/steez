// Closing Steez and opening it again picks up what was running; trivia never repeats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planRound, isRepeat, parseTrivia, triviaPrompt, isGame } from '../src/main/bot/trivia.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const child = (dir, phase) => JSON.parse(execFileSync(process.execPath, [path.join(here, 'helpers', 'restart-child.mjs'), dir, phase], { encoding: 'utf8' }).trim().split('\n').pop());

test('a giveaway, poll, bets, heist and trivia round survive a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steez-restart-'));
  const before = child(dir, 'before');
  assert.equal(before.points.ann, 700, 'the bet took 300 points');
  const after = child(dir, 'after');
  assert.ok(after.raffle, 'giveaway is back');
  assert.equal(after.raffle.title, 'Big prize');
  assert.equal(after.raffle.open, true);
  assert.deepEqual(after.raffle.entries.map((e) => e.login).sort(), ['ann', 'ben']);
  assert.equal(after.poll.question, 'Best?');
  assert.equal(after.poll.options[1].votes, 1);
  assert.ok(after.poll.endsAt > Date.now() + 60_000, 'the poll keeps its remaining time');
  assert.equal(after.bets.question, 'Win?');
  assert.equal(after.bets.options[0].pool, 300, 'wagered points are still in the bet');
  assert.equal(after.heist.crew.length, 1);
  assert.ok(after.trivia?.q, 'the trivia round is still running');
  assert.ok(after.downtime >= 0 && after.downtime < 60_000);
});

test('trivia: half the rounds are about the game, half random', () => {
  let state = {};
  const kinds = [];
  for (let i = 0; i < 10; i++) {
    const p = planRound({ game: 'Elden Ring', state });
    kinds.push(p.kind);
    if (p.kind === 'game') assert.equal(p.topic, 'Elden Ring');
    state = p.state;
  }
  assert.equal(kinds.filter((k) => k === 'game').length, 5);
  assert.equal(kinds.filter((k) => k === 'random').length, 5);
  // Not playing a game: all random, and the game gets the next turn once one is on.
  const chatting = planRound({ game: 'Just Chatting', state: { next: 'game' } });
  assert.equal(chatting.kind, 'random');
  assert.equal(chatting.state.next, 'game');
  assert.equal(isGame('Just Chatting'), false);
  assert.equal(isGame('Minecraft'), true);
  // Random categories don't repeat back to back
  let st = {};
  const cats = [];
  for (let i = 0; i < 12; i++) {
    const p = planRound({ game: '', state: st });
    cats.push(p.topic);
    st = p.state;
  }
  assert.equal(new Set(cats).size, 12);
  // A topic from !trivia <topic> wins
  assert.equal(planRound({ topic: 'cats', game: 'Elden Ring' }).kind, 'custom');
  assert.equal(planRound({ game: '', randomTopic: 'space', state: {} }).topic, 'space');
});

test('trivia: repeats are spotted and the AI is told what was asked', () => {
  const history = [{ q: 'What is the largest planet in our solar system?', a: 'Jupiter' }];
  assert.equal(isRepeat('What is the largest planet in our solar system?', 'jupiter', history), true);
  assert.equal(isRepeat('Which planet is the largest in the solar system?', 'Jupiter', history), true);
  assert.equal(isRepeat('Which planet has the most moons?', 'Saturn', history), false);
  assert.deepEqual(parseTrivia('sure! {"question":"Q?","answers":["A","a2"]}'), { question: 'Q?', answers: ['A', 'a2'] });
  assert.equal(parseTrivia('no json'), null);
  const prompt = triviaPrompt({ kind: 'game', topic: 'Elden Ring', angle: 'bosses and enemies' }, ['Old question?']);
  assert.match(prompt, /Elden Ring/);
  assert.match(prompt, /Old question\?/);
});
