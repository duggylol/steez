// The AI tool loop with a fake Claude API: the AI asks to run a tool, Steez runs it,
// sends the result back, and the final reply reaches chat. Also checks permission filtering.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.STEEZ_BOT_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tbai-'));
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...a) => realSetInterval(...a).unref();

const { bot } = await import('../src/main/bot/core/bot.js');
const { db } = await import('../src/main/bot/store.js');

const requests = [];
let script = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  if (!String(url).includes('api.anthropic.com')) return realFetch(url, opts);
  const body = JSON.parse(opts.body);
  requests.push(body);
  const next = script.shift();
  return new Response(JSON.stringify({ id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: body.model, usage: { input_tokens: 10, output_tokens: 10 }, stop_sequence: null, ...next }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'request-id': 'req_test' },
  });
};

const said = [];
const songRequests = [];
before(async () => {
  db.secrets.anthropicKey = 'sk-ant-test';
  db.settings.ai.model = 'claude-haiku-5-5';
  db.settings.events.firstTimeChatter.enabled = false;
  db.settings.events.returningViewer.enabled = false;
  await bot.init();
  for (const n of ['events', 'ai']) (await import(`../src/main/bot/modules/${n}.js`)).init(bot);
  bot.action('songs:request', (a) => (songRequests.push(a), { queued: a.query }));
  bot.on('bot:said', (t) => said.push(t));
});

const ask = async (user, level, text) => {
  await bot.runAction('chat:simulate', { user, level, text });
  for (let i = 0; i < 100 && script.length; i++) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 1700));
};

test('a viewer asks for a song → the AI queues it and replies', async () => {
  script = [
    { content: [{ type: 'tool_use', id: 'toolu_1', name: 'queue_song', input: { query: 'The Weeknd - Blinding Lights' } }], stop_reason: 'tool_use' },
    { content: [{ type: 'text', text: 'Queued Blinding Lights for you!' }], stop_reason: 'end_turn' },
  ];
  await ask('Viewer1', 'everyone', '!ask play blinding lights');
  assert.deepEqual(songRequests[0], { query: 'The Weeknd - Blinding Lights', user: 'Viewer1' });
  // Second request carries the tool result back to Claude
  const second = requests.at(-1);
  const result = second.messages.at(-1).content[0];
  assert.equal(result.type, 'tool_result');
  assert.equal(result.tool_use_id, 'toolu_1');
  assert.ok(said.some((t) => t.includes('Queued Blinding Lights')));
});

test('viewers only get viewer tools; mods get control tools', async () => {
  const viewerTools = requests[0].tools.map((t) => t.name);
  assert.ok(viewerTools.includes('queue_song'));
  assert.ok(!viewerTools.includes('timeout_user'));
  assert.ok(!viewerTools.includes('play_playlist'));

  script = [{ content: [{ type: 'text', text: 'Sure.' }], stop_reason: 'end_turn' }];
  const before = requests.length;
  await ask('ModPerson', 'moderator', '!ask hi');
  const modTools = requests[before].tools.map((t) => t.name);
  assert.ok(modTools.includes('play_playlist') && modTools.includes('timeout_user') && modTools.includes('start_poll'));
});

test('control level "broadcaster" locks mods out of control tools', async () => {
  db.settings.ai.controlLevel = 'broadcaster';
  script = [{ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }];
  const before = requests.length;
  await ask('ModPerson2', 'moderator', '!ask hi');
  const names = requests[before].tools.map((t) => t.name);
  assert.ok(!names.includes('play_playlist'));
  assert.ok(names.includes('queue_song'));
  db.settings.ai.controlLevel = 'moderator';
});

test('chat memory: every message is saved and the AI remembers what a viewer said in earlier streams', async () => {
  const { getUser } = await import('../src/main/bot/store.js');
  getUser('oldtimer', 'OldTimer');
  const weekAgo = Date.now() - 7 * 86400000;
  bot.chatHistory.add({ t: weekAgo, login: 'oldtimer', user: 'OldTimer', text: 'my cat is named Biscuit' });
  bot.chatHistory.add({ t: weekAgo + 1000, login: 'someoneelse', user: 'SomeoneElse', text: 'elden ring is the best' });

  script = [{ content: [{ type: 'text', text: 'Biscuit!' }], stop_reason: 'end_turn' }];
  const before = requests.length;
  await ask('OldTimer', 'everyone', '!ask what is my cat called?');
  const req = requests[before];
  assert.ok(req.tools.some((t) => t.name === 'chat_history'), 'viewers get the history tool');
  const prompt = req.messages[0].content;
  assert.match(prompt, /What you remember about OldTimer/);
  assert.match(prompt, /my cat is named Biscuit/);
  assert.doesNotMatch(prompt, /elden ring/, 'only their own messages are added automatically');
  assert.match(req.system, /chat_history/);

  // today's chat was saved too (the question itself and the bot's reply)
  bot.chatHistory.flush();
  const today = bot.chatHistory.search({ login: 'oldtimer', since: Date.now() - 60000 });
  assert.ok(today.some((r) => r.m.includes('what is my cat called')));
});

test('chat memory: the AI looks up anyone with the chat_history tool', async () => {
  script = [
    { content: [{ type: 'tool_use', id: 'toolu_h', name: 'chat_history', input: { username: '@SomeoneElse', contains: 'ELDEN' } }], stop_reason: 'tool_use' },
    { content: [{ type: 'text', text: 'They love Elden Ring.' }], stop_reason: 'end_turn' },
  ];
  const before = requests.length;
  await ask('Curious', 'everyone', '!ask what does SomeoneElse think of elden ring?');
  const result = requests[before + 1].messages.at(-1).content[0];
  assert.equal(result.tool_use_id, 'toolu_h');
  const out = JSON.parse(result.content);
  assert.equal(out.found, 1);
  assert.match(out.messages, /SomeoneElse: elden ring is the best/);
  assert.ok(out.history_starts);
  assert.ok(said.some((t) => t.includes('They love Elden Ring')));
  const info = await bot.runAction('ai:memory');
  assert.ok(info.on && info.days >= 2 && info.bytes > 0);
});

test('chat memory off: nothing is saved and there is no history tool', async () => {
  db.settings.ai.chatMemory = false;
  try {
    bot.chatHistory.flush();
    const count = () => bot.chatHistory.search({ limit: 10000 }).length;
    const n = count();
    script = [{ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }];
    const before = requests.length;
    await ask('OldTimer', 'moderator', '!ask secret stuff'); // a mod, so the 30s viewer cooldown doesn't apply
    assert.ok(!requests[before].tools?.some((t) => t.name === 'chat_history'));
    assert.doesNotMatch(requests[before].messages[0].content, /What you remember/);
    assert.equal(count(), n);
  } finally {
    db.settings.ai.chatMemory = true;
  }
});
