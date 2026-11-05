// Chat-bot pages of the Steez UI (vanilla DOM, mounted by BotPage.jsx).
// All user data is inserted as text nodes — never innerHTML.
import { toast as uiToast } from '../../ui.jsx';
import { api, buffers, onBot } from '../../lib/bot.js';

const $ = (s, el = document) => el.querySelector(s);

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const toast = (msg, err = false) => uiToast(msg, { error: err });
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString();
const ago = (t) => {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const dur = (ms) => {
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
const label = (k) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const card = (title, ...kids) => h('div', { class: 'card' }, title && h('h3', {}, title), ...kids);
const btn = (text, onclick, cls = '') => h('button', { class: cls, onclick }, text);
const copy = (text) => window.steez.copy(text).then(() => toast('Copied'));
const head = (title, sub) => h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, title), sub ? h('div', { class: 'sub' }, sub) : null));

let S = null; // server state
let hypeNow = { mpm: 0, level: 0, score: 0 };

// ─── Generic settings forms ──────────────────────────────────
const HELP = {
  'general.prefix': 'Character that starts commands.',
  'general.replyStyle': '"mention" (@user ...) or "reply" (native Twitch reply thread).',
  'general.regulars': 'One username per line — these users get the "regular" level.',
  'general.ignoredUsers': 'Other bots to ignore (no points, no commands).',
  'modPanel.enabled': 'Lets your mods use the web Mod Panel while Steez is open.',
  'modPanel.points': 'Give and take loyalty points from viewers.',
  'modPanel.moderation': 'Shield mode and the automatic moderation log.',
  'modPanel.songs': 'Skip, pause, resume and clear song requests.',
  'modPanel.queue': 'Next game, remove players, open or close the viewer queue.',
  'general.allowEval': '⚠️ ${eval} runs JavaScript on this PC. Only enable if you fully trust every moderator.',
  'general.resetCountersOnStream': 'Named counters (${count name}) reset to 0 when a new stream starts.',
  'loyalty.intervalMinutes': 'Points are paid to everyone in chat every N minutes while live.',
  'loyalty.activeChatterBonus': 'Extra points per interval for people who chatted during it.',
  'moderation.exemptLevel': 'This level and higher are never filtered.',
  'moderation.warningFirst': 'First offense: delete + warning. Then escalating timeouts (×10 each strike).',
  'moderation.bannedWords.words': 'One per line. Use * as wildcard (e.g. bad*).',
  'moderation.bannedWords.regex': 'Advanced: one regular expression per line.',
  'moderation.spamBots.patterns': 'Regexes checked against first-time chatters — matches are banned.',
  'shield.followsPerMinute': 'Shield turns on automatically when follows per minute reach this number (follow-bot attack).',
  'ai.model': 'Haiku answers fastest and costs the least — great for busy chats. Opus gives the best answers. Fable is the most capable but costs the most.',
  'ai.effort': 'How hard the model thinks before replying. Lower is faster and cheaper; Low suits chat replies.',
  'ai.allowControls': 'Lets the AI take actions in Steez — queue songs, play playlists, run polls and giveaways, the viewer queue, shoutouts, clips and more.',
  'ai.controlLevel': 'Who can make the AI change things (skip, volume, polls, giveaways, timeouts…).',
  'ai.songRequests': 'Viewers can ask the AI for songs ("@bot play something chill").',
  'ai.songRequestLevel': 'Who can request songs through the AI.',
  'ai.respondToMentions': 'Reply when someone @mentions the bot account.',
  'ai.autoTranslate': 'Automatically translate messages written in non-Latin scripts (Cyrillic, CJK, Arabic, ...).',
  'ai.firstMessageSpamCheck': 'Ask the AI whether first-time chatter messages are spam and delete them.',
  'hype.threshold': 'A hype moment = chat speed this many times above its normal baseline.',
  'songs.voteSkipVotes': 'Votes needed for !voteskip.',
  'games.boss.autoSpawnMinutes': '0 = only spawn manually.',
  'games.trivia.useAI': 'Generate fresh questions with AI (needs ANTHROPIC_API_KEY), about the topic or current game.',
  'games.trivia.duringAdBreaks': 'Start a trivia round automatically when an ad break begins.',
  'overlay.ttsVoice': 'Name of a voice installed on this PC (leave empty for the default).',
  'shoutout.autoList': 'Streamers who get an automatic shoutout the first time they chat each stream (one per line).',
};
const TEMPLATES = {
  'loyalty.ranks': { name: '', hours: 0 },
  'games.heist.tiers': { minPlayers: 1, name: '', successPercent: 50, payout: 2 },
  'shop.items': { name: '', cost: 100, effect: 'confetti', description: '', cooldownSeconds: 0 },
  redemptions: { reward: '', response: '', effect: '', command: '', points: 0 },
};
const SELECTS = {
  'general.replyStyle': ['mention', 'reply'],
  'ai.effort': [
    { value: '', label: 'Model default' },
    { value: 'low', label: 'Low — fastest, cheapest (good for chat)' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Extra high' },
    { value: 'max', label: 'Max — slowest, most thorough' },
  ],
  'ai.controlLevel': [
    { value: 'moderator', label: 'Moderators and you' },
    { value: 'broadcaster', label: 'Only you' },
  ],
  'ai.model': [
    { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — fastest, cheapest' },
    { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — balanced' },
    { value: 'claude-opus-5-5', label: 'Claude Opus 5.5 — smartest (default)' },
    { value: 'claude-fable-5-1', label: 'Claude Fable 5.1 — most capable, most expensive' },
  ],
  effect: ['', 'confetti', 'emoterain', 'tts', 'shake', 'spotlight'],
};

function objTable(arr, path) {
  const tpl = TEMPLATES[path] || arr[0] || {};
  const cols = [...new Set([...Object.keys(tpl), ...arr.flatMap((o) => Object.keys(o))])];
  const wrap = h('div');
  const draw = () => {
    wrap.replaceChildren(
      h(
        'table',
        { class: 'obj-table' },
        h('tr', {}, cols.map((c) => h('th', {}, label(c))), h('th')),
        arr.map((row, i) =>
          h(
            'tr',
            {},
            cols.map((c) => {
              const tv = tpl[c] ?? row[c];
              if (SELECTS[c]) return h('td', {}, h('select', { onchange: (e) => (row[c] = e.target.value) }, SELECTS[c].map((o) => h('option', { value: o, selected: row[c] === o }, o || '—'))));
              if (typeof tv === 'number') return h('td', {}, h('input', { type: 'number', step: 'any', value: row[c] ?? 0, oninput: (e) => (row[c] = Number(e.target.value)) }));
              if (typeof tv === 'boolean') return h('td', {}, h('input', { type: 'checkbox', checked: row[c], onchange: (e) => (row[c] = e.target.checked) }));
              return h('td', {}, h('input', { value: row[c] ?? '', oninput: (e) => (row[c] = e.target.value) }));
            }),
            h('td', {}, btn('✕', () => (arr.splice(i, 1), draw()), 'sm danger')),
          ),
        ),
      ),
      btn('+ Add row', () => (arr.push(structuredClone(tpl)), draw()), 'sm'),
    );
  };
  draw();
  return wrap;
}

function field(obj, key, path) {
  const v = obj[key];
  const help = HELP[path] && h('div', { class: 'help' }, HELP[path]);
  if (typeof v === 'boolean')
    return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: v, onchange: (e) => (obj[key] = e.target.checked) }), h('span', {}, label(key)), help);
  if (typeof v === 'number')
    return h('label', { class: 'field' }, h('span', {}, label(key)), h('input', { type: 'number', step: 'any', value: v, oninput: (e) => (obj[key] = Number(e.target.value)) }), help);
  if (typeof v === 'string') {
    let input;
    if (SELECTS[path]) {
      const opts = SELECTS[path].map((o) => (typeof o === 'string' ? { value: o, label: o || '(default)' } : o));
      if (!opts.some((o) => o.value === v)) opts.push({ value: v, label: v }); // keep a custom value visible
      input = h('select', { onchange: (e) => (obj[key] = e.target.value) }, opts.map((o) => h('option', { value: o.value, selected: v === o.value }, o.label)));
    }
    else if (/level$/i.test(key)) input = h('select', { onchange: (e) => (obj[key] = e.target.value) }, S.levels.map((l) => h('option', { value: l, selected: v === l }, l)));
    else if (/message|personality|response/i.test(key) || v.length > 70) input = h('textarea', { oninput: (e) => (obj[key] = e.target.value) }, v);
    else input = h('input', { value: v, oninput: (e) => (obj[key] = e.target.value) });
    return h('label', { class: 'field' }, h('span', {}, label(key)), input, help);
  }
  if (Array.isArray(v)) {
    if (TEMPLATES[path] || (v.length && typeof v[0] === 'object')) return h('div', { class: 'sub-group' }, h('div', { class: 'sg-title' }, label(key)), objTable(v, path), help);
    return h(
      'label',
      { class: 'field' },
      h('span', {}, `${label(key)} (one per line)`),
      h('textarea', { oninput: (e) => (obj[key] = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean)) }, v.join('\n')),
      help,
    );
  }
  if (v && typeof v === 'object') return h('div', { class: 'sub-group' }, h('div', { class: 'sg-title' }, label(key)), Object.keys(v).map((k) => field(v, k, `${path}.${k}`)), help);
  return null;
}

function settingsForm(section, { title, keys, extra, onSaved } = {}) {
  const data = structuredClone(S.settings[section]);
  const isArr = Array.isArray(data);
  const ks = keys || (isArr ? [] : Object.keys(data));
  const save = async () => {
    const full = isArr ? data : { ...S.settings[section], ...Object.fromEntries(ks.map((k) => [k, data[k]])) };
    S.settings = await api.put('/api/settings', { [section]: full });
    toast('Saved ✓');
    await onSaved?.();
  };
  return card(
    title || label(section),
    isArr ? objTable(data, section) : ks.map((k) => field(data, k, `${section}.${k}`)),
    h('div', { class: 'row', style: 'margin-top:8px' }, btn('Save', save, 'primary'), extra),
  );
}

// ─── Pages ───────────────────────────────────────────────────
function pageOverview(main, on) {
  const st = S.status;
  const pill = (ok, text) => h('span', { class: `pill ${ok ? 'good' : ''}` }, text);
  const statusRow = (st = S.status) =>
    h(
      'div',
      { class: 'row' },
      st.live ? h('span', { class: 'pill live' }, 'LIVE') : h('span', { class: 'pill' }, 'Offline'),
      pill(st.ircConnected, 'Chat'),
      pill(st.eventsubConnected, 'EventSub'),
      pill(st.botIsMod, st.botIsMod ? 'Bot is mod' : 'Bot is not mod (/mod the bot)'),
      pill(S.config.anthropic, 'AI'),
      pill(S.config.youtube, 'YouTube search'),
    );

  main.append(head(`Overview${st.channel ? ` — ${st.channel}` : ''}`));
  const statusBox = h('div', { style: 'margin-top:10px' }, statusRow());
  on.status = (s) => statusBox.replaceChildren(statusRow(s));

  if (!S.config.clientIdSet) {
    main.append(
      h('div', { class: 'banner warn' }, h('div', { class: 'grow' }, h('b', {}, 'Twitch app not set. '), 'Add a Twitch Client ID in Settings to connect your channel.'), btn('Open Settings', () => (location.hash = 'settings'), 'sm primary')),
    );
  }

  const loginAs = async (role) => {
    toast('Finish the login in your browser…');
    try {
      await api.post(`/api/auth/login/${role}`);
      toast('Twitch connected');
    } catch {}
    await reload();
  };
  const acctRow = (role, title, desc) => {
    const a = S.auth[role];
    return h(
      'div',
      { class: 'row', style: 'justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)' },
      h('div', {}, h('b', {}, title), h('div', { class: 'muted small' }, a ? (a.expired ? `Login expired (${a.login}) — reconnect` : `Connected as ${a.login}${a.missingScopes?.length ? ' · reconnect to grant new permissions' : ''}`) : desc)),
      a
        ? h('div', { class: 'row' }, btn('Reconnect', () => loginAs(role), 'sm'), btn('Disconnect', async () => { await api.post(`/api/auth/disconnect/${role}`); await reload(); }, 'sm danger'))
        : btn('Connect with Twitch', () => (S.config.clientIdSet ? loginAs(role) : (location.hash = 'settings')), role === 'broadcaster' ? 'primary' : ''),
    );
  };
  main.append(
    card(
      'Accounts',
      acctRow('broadcaster', 'Your channel', 'Required. Log in with your streaming account.'),
      acctRow('bot', 'Custom bot account (optional)', 'Replies come from the shared Steez bot by default (Settings → Bot identity). Connect your own bot account only if you want a custom name.'),
      statusBox,
    ),
  );

  // Stream info
  const title = h('input', { value: st.stream?.title || '' });
  const game = h('input', { value: st.stream?.game || '' });
  const sess = h('div');
  const drawSession = (s) => {
    s ||= S.session;
    if (!s) return sess.replaceChildren(h('div', { class: 'muted' }, 'Stats appear here while you are live.'));
    const stat = (v, l) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l));
    sess.replaceChildren(
      h('div', { class: 'row' }, stat(dur(s.duration), 'live'), stat(fmt(st.stream?.viewers), 'viewers'), stat(s.peakViewers, 'peak'), stat(fmt(s.messages), 'messages'), stat(s.uniqueChatters, 'chatters'), stat(s.follows, 'follows'), stat(s.subs + s.gifts, 'subs'), stat(fmt(s.bits), 'bits')),
    );
  };
  drawSession();
  on.session = (s) => drawSession(s);
  main.append(
    h('div', { class: 'grid2' },
      card('Stream info',
        h('label', { class: 'field' }, h('span', {}, 'Title'), title),
        h('label', { class: 'field' }, h('span', {}, 'Category'), game),
        btn('Update stream', async () => { await api.action('stream:update', { title: title.value, game: game.value }); toast('Stream updated'); }, 'primary'),
      ),
      card('Quick actions',
        h('div', { class: 'row' },
          btn('Shield ON', () => api.action('shield', { on: true }).then(() => toast('Shield on'))),
          btn('Shield off', () => api.action('shield', { on: false }).then(() => toast('Shield off'))),
          btn('Clip', async () => { const url = await api.action('clip:create'); toast(url ? `Clip: ${url}` : 'Clip failed (are you live?)', !url); }),
          btn('Spawn boss', () => api.action('boss:spawn', {})),
          btn('Trivia', () => api.action('trivia:start', {})),
        ),
        h('div', { class: 'row', style: 'margin-top:10px' }, h('span', { class: 'muted' }, 'Test alert:'),
          ['follow', 'sub', 'resub', 'giftbomb', 'cheer', 'raid'].map((t) => btn(t, () => api.action('alert:test', { type: t }), 'sm'))),
      ),
    ),
    card('This stream', sess),
  );

  // Chat
  const log = h('div', { class: 'chatlog' });
  const addLine = (m) => {
    log.append(
      h('div', { class: `m${m.bot ? ' bot' : ''}` }, h('span', { class: 't' }, new Date(m.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
        h('span', { class: 'u', style: m.color ? `color:${m.color}` : '' }, m.bot ? '🤖 bot' : m.user), ': ', m.text),
    );
    if (log.children.length > 300) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  };
  chatBuf.forEach(addLine);
  on.chat = addLine;
  const say = h('input', { placeholder: 'Send a message as the bot…' });
  const simUser = h('input', { value: 'TestViewer', style: 'max-width:150px' });
  const simLevel = h('select', { style: 'max-width:140px' }, S.levels.map((l) => h('option', { value: l }, l)));
  const simText = h('input', { placeholder: 'Type a message or !command to test…' });
  const sendSay = async () => {
    const text = say.value;
    if (!text) return;
    say.value = '';
    await api.post('/api/say', { text });
  };
  const sendSim = async () => {
    const text = simText.value;
    if (!text) return;
    simText.value = '';
    await api.action('chat:simulate', { user: simUser.value, level: simLevel.value, text });
  };
  say.addEventListener('keydown', (e) => e.key === 'Enter' && sendSay());
  simText.addEventListener('keydown', (e) => e.key === 'Enter' && sendSim());
  main.append(
    card('Live chat', log,
      h('div', { class: 'row', style: 'margin-top:10px' }, say, btn('Send', sendSay, 'primary')),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('span', { class: 'muted small' }, '🧪 Test as:'), simUser, simLevel, simText, btn('Simulate', sendSim)),
      h('div', { class: 'help' }, 'Simulated messages go through the full bot (commands, filters, games). Bot replies are sent to your real chat when it is connected.'),
    ),
  );
}

// Commands
function pageCommands(main) {
  main.append(head('Commands'));
  const cmds = S.commands;
  const list = h('div');
  const search = h('input', { placeholder: 'Search commands…', oninput: () => draw() });
  const saveAll = async () => { S.commands = await api.put('/api/commands', cmds); toast('Commands saved ✓'); draw(); };

  function editor(name, existing) {
    const c = structuredClone(existing || { response: '', level: 'everyone', cooldown: 5, userCooldown: 0, cost: 0, aliases: [], replyType: 'say', enabled: true });
    const nameIn = h('input', { value: name || '', placeholder: 'e.g. discord' });
    const bg = h('div', { class: 'modal-bg', onclick: (e) => e.target === bg && bg.remove() });
    bg.append(
      h('div', { class: 'modal' },
        h('h3', {}, existing ? `Edit !${name}` : 'New command'),
        h('label', { class: 'field' }, h('span', {}, 'Command name (without prefix)'), nameIn),
        h('label', { class: 'field' }, h('span', {}, 'Response'), h('textarea', { oninput: (e) => (c.response = e.target.value), style: 'min-height:110px' }, c.response),
          h('div', { class: 'help' }, 'Variables: ${user} ${touser} ${1} ${1:} ${count} ${random.1-100} ${random.pick \'a\' \'b\'} ${random.chatter} ${uptime} ${game} ${title} ${followage} ${accountage} ${points} ${rank} ${watchtime} ${time} ${weather city} ${customapi url} ${quote} ${song} ${ai prompt} … Start with /me for an action or /announce for an announcement.')),
        h('div', { class: 'grid' },
          h('label', { class: 'field' }, h('span', {}, 'Who can use it'), h('select', { onchange: (e) => (c.level = e.target.value) }, S.levels.map((l) => h('option', { value: l, selected: c.level === l }, l)))),
          h('label', { class: 'field' }, h('span', {}, 'Reply style'), h('select', { onchange: (e) => (c.replyType = e.target.value) }, ['say', 'reply', 'announce'].map((l) => h('option', { value: l, selected: (c.replyType || 'say') === l }, l)))),
          h('label', { class: 'field' }, h('span', {}, 'Global cooldown (s)'), h('input', { type: 'number', value: c.cooldown || 0, oninput: (e) => (c.cooldown = Number(e.target.value)) })),
          h('label', { class: 'field' }, h('span', {}, 'Per-user cooldown (s)'), h('input', { type: 'number', value: c.userCooldown || 0, oninput: (e) => (c.userCooldown = Number(e.target.value)) })),
          h('label', { class: 'field' }, h('span', {}, `Cost (${S.settings.loyalty.currencyName})`), h('input', { type: 'number', value: c.cost || 0, oninput: (e) => (c.cost = Number(e.target.value)) })),
          h('label', { class: 'field' }, h('span', {}, 'Aliases (comma separated)'), h('input', { value: (c.aliases || []).join(', '), oninput: (e) => (c.aliases = e.target.value.split(',').map((s) => s.trim().replace(/^!/, '').toLowerCase()).filter(Boolean)) })),
        ),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: c.enabled !== false, onchange: (e) => (c.enabled = e.target.checked) }), 'Enabled'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!c.hidden, onchange: (e) => (c.hidden = e.target.checked) }), 'Hide from public command list'),
        h('div', { class: 'row' },
          btn('Save', async () => {
            const n = nameIn.value.trim().replace(/^!/, '').toLowerCase();
            if (!n || /\s/.test(n) || !c.response) return toast('Name (no spaces) and response are required', true);
            if (name && n !== name) delete cmds[name];
            cmds[n] = c;
            await saveAll();
            bg.remove();
          }, 'primary'),
          btn('Cancel', () => bg.remove()),
        ),
      ),
    );
    document.body.append(bg);
  }

  function draw() {
    const q = search.value.toLowerCase();
    const names = Object.keys(cmds).filter((n) => !q || n.includes(q) || cmds[n].response.toLowerCase().includes(q)).sort();
    list.replaceChildren(
      names.length
        ? h('table', {},
            h('tr', {}, ['Command', 'Response', 'Level', 'Cooldown', 'Uses', 'On', ''].map((t) => h('th', {}, t))),
            names.map((n) => {
              const c = cmds[n];
              return h('tr', {},
                h('td', {}, h('b', {}, `!${n}`), (c.aliases || []).map((a) => h('span', { class: 'tag' }, `!${a}`))),
                h('td', { class: 'mono', style: 'max-width:520px' }, c.response),
                h('td', {}, c.level || 'everyone', c.cost ? h('div', { class: 'small muted' }, `${c.cost} pts`) : null),
                h('td', {}, `${c.cooldown || 0}s / ${c.userCooldown || 0}s`),
                h('td', {}, fmt(c.uses || 0)),
                h('td', {}, h('input', { type: 'checkbox', checked: c.enabled !== false, onchange: async (e) => { c.enabled = e.target.checked; await saveAll(); } })),
                h('td', {}, h('div', { class: 'row' }, btn('Edit', () => editor(n, c), 'sm'), btn('✕', async () => { if (confirm(`Delete !${n}?`)) { delete cmds[n]; await saveAll(); } }, 'sm danger'))),
              );
            }),
          )
        : h('div', { class: 'empty' }, 'No custom commands yet.'),
    );
  }
  draw();
  main.append(card('Custom commands', h('div', { class: 'row', style: 'margin-bottom:10px' }, search, btn('+ New command', () => editor(), 'primary')), list));

  // Built-ins
  const rows = S.builtins.map((b) => ({ ...b }));
  const bt = h('table', {},
    h('tr', {}, ['Command', 'Description', 'Level', 'Cooldown (global/user)', 'Aliases', 'On'].map((t) => h('th', {}, t))),
    rows.map((b) =>
      h('tr', {},
        h('td', {}, h('b', {}, `!${b.name}`), h('div', { class: 'small muted mono' }, b.usage)),
        h('td', { class: 'small' }, b.description),
        h('td', {}, h('select', { onchange: (e) => (b.level = e.target.value) }, S.levels.map((l) => h('option', { value: l, selected: b.level === l }, l)))),
        h('td', {}, h('div', { class: 'row', style: 'flex-wrap:nowrap' },
          h('input', { type: 'number', value: b.cooldown, style: 'width:70px', oninput: (e) => (b.cooldown = Number(e.target.value)) }),
          h('input', { type: 'number', value: b.userCooldown, style: 'width:70px', oninput: (e) => (b.userCooldown = Number(e.target.value)) }))),
        h('td', {}, h('input', { value: (b.aliases || []).join(', '), oninput: (e) => (b.aliases = e.target.value.split(',').map((s) => s.trim().replace(/^!/, '').toLowerCase()).filter(Boolean)) })),
        h('td', {}, h('input', { type: 'checkbox', checked: b.enabled, onchange: (e) => (b.enabled = e.target.checked) })),
      ),
    ),
  );
  main.append(
    card('Built-in commands', h('div', { class: 'help', style: 'margin-bottom:8px' }, 'Disable, rename (via aliases), change permissions or cooldowns of any default command.'), bt,
      h('div', { class: 'row', style: 'margin-top:10px' },
        btn('Save built-ins', async () => {
          const out = {};
          for (const b of rows) out[b.name] = { enabled: b.enabled, level: b.level, cooldown: b.cooldown, userCooldown: b.userCooldown, aliases: b.aliases };
          await api.put('/api/builtins', out);
          await reload(false);
          toast('Saved ✓');
        }, 'primary'))),
  );

  const imp = h('textarea', { placeholder: 'Paste a JSON export from StreamElements / Streamlabs / Nightbot / Fossabot, or CSV lines: command,response', style: 'min-height:120px' });
  main.append(
    card('Import commands from another bot', imp,
      h('div', { class: 'help' }, 'Variables like $(user), ${user}, $user, {user}, $target, $readapi(url) are converted automatically.'),
      h('div', { class: 'row', style: 'margin-top:8px' }, btn('Import', async () => {
        const r = await api.post('/api/import/commands', { text: imp.value });
        toast(`Imported ${r.imported} commands`);
        await reload();
      }, 'primary'))),
  );
}

// Timers
function pageTimers(main) {
  main.append(head('Timers'), h('p', { class: 'muted' }, 'Messages posted on an interval — only if enough chat lines happened since the last one, so the bot never talks to an empty room.'));
  const timers = structuredClone(S.timers);
  const box = h('div');
  const drawBound = () => {
    for (const t of timers) {
      t.onlineOnly ??= true;
      t.random ??= false;
      t.announce ??= false;
    }
    box.replaceChildren(
      timers.map((t, i) =>
        card(null,
          h('div', { class: 'row' }, h('input', { value: t.name, style: 'max-width:260px;font-weight:600', oninput: (e) => (t.name = e.target.value) }),
            h('label', { class: 'check', style: 'margin:0' }, h('input', { type: 'checkbox', checked: t.enabled, onchange: (e) => (t.enabled = e.target.checked) }), 'Enabled'),
            h('span', { class: 'grow' }), btn('Send now', () => api.action('timer:fire', { id: t.id }), 'sm'), btn('Delete', () => (timers.splice(i, 1), draw()), 'sm danger')),
          h('div', { class: 'grid', style: 'margin-top:10px' },
            ['intervalMinutes', 'minLines'].map((k) => field(t, k, `timer.${k}`)),
            h('div', {}, field(t, 'onlineOnly', 'x'), field(t, 'random', 'x'), field(t, 'announce', 'x')),
          ),
          h('label', { class: 'field' }, h('span', {}, 'Messages (one per line — rotates through them)'),
            h('textarea', { oninput: (e) => (t.messages = e.target.value.split('\n').filter((s) => s.trim())) }, (t.messages || []).join('\n'))),
        ),
      ),
    );
  };
  const draw = drawBound;
  drawBound();
  main.append(box,
    h('div', { class: 'row' },
      btn('+ New timer', () => { timers.push({ id: Math.random().toString(36).slice(2, 10), name: 'New timer', enabled: true, intervalMinutes: 15, minLines: 5, onlineOnly: true, random: false, announce: false, messages: [] }); drawBound(); }),
      btn('Save timers', async () => { S.timers = await api.put('/api/timers', timers); toast('Timers saved ✓'); }, 'primary')));
}

// Moderation
function pageModeration(main, on) {
  main.append(head('Moderation'));
  const sh = h('span');
  const drawShield = (s) => sh.replaceChildren(s?.on ? h('span', { class: 'pill bad' }, `🛡️ ACTIVE until ${new Date(s.until).toLocaleTimeString()}`) : h('span', { class: 'pill' }, 'inactive'));
  drawShield(S.shield);
  on.shield = drawShield;
  main.append(card('Shield mode (panic button)', h('p', { class: 'muted' }, 'Turns on followers-only / slow / emote-only for a few minutes. Triggers automatically during follow-bot attacks.'),
    h('div', { class: 'row' }, sh, btn('Activate', () => api.action('shield', { on: true }), 'primary'), btn('Deactivate', () => api.action('shield', { on: false })))));
  main.append(h('div', { class: 'grid2' }, h('div', {}, settingsForm('moderation', { title: 'Spam filters' })), h('div', {}, settingsForm('shield', { title: 'Shield settings' }), modlogCard(on))));
}
function modlogCard(on) {
  const body = h('div', {}, h('div', { class: 'empty' }, 'Loading…'));
  const rows = [];
  const draw = () =>
    body.replaceChildren(rows.length
      ? h('table', {}, h('tr', {}, ['When', 'User', 'Filter', 'Action', 'Message'].map((t) => h('th', {}, t))),
          rows.slice(0, 100).map((r) => h('tr', {}, h('td', { class: 'small' }, ago(r.t)), h('td', {}, r.user), h('td', {}, r.filter), h('td', {}, r.action), h('td', { class: 'small mono' }, r.message || r.reason))))
      : h('div', { class: 'empty' }, 'Nothing moderated yet.'));
  api.get('/api/modlog').then((l) => { rows.push(...l); draw(); });
  on.modlog = (r) => { rows.unshift(r); draw(); };
  return card('Mod log', h('div', { style: 'max-height:500px;overflow:auto' }, body));
}

// AI
function pageAI(main) {
  main.append(head('AI'));
  const keyIn = h('input', { type: 'password', autocomplete: 'off', placeholder: S.config.anthropic ? '••••••••••••  (saved — paste a new key to replace it)' : 'Paste your key: sk-ant-…' });
  const keyState = h('span', { class: S.config.anthropic ? 'pill good' : 'pill' }, S.config.anthropic ? 'Key saved — AI is on' : 'No key yet — AI is off');
  const saveKey = async (value) => {
    const r = await api.put('/api/secrets', { anthropicKey: value });
    keyIn.value = '';
    S.config.anthropic = r.anthropicKey;
    keyState.className = r.anthropicKey ? 'pill good' : 'pill';
    keyState.textContent = r.anthropicKey ? 'Key saved — AI is on' : 'No key yet — AI is off';
    toast(r.anthropicKey ? 'API key saved' : 'API key removed');
  };
  keyIn.addEventListener('keydown', (e) => e.key === 'Enter' && keyIn.value.trim() && saveKey(keyIn.value.trim()));
  main.append(
    card('Anthropic API key',
      h('div', { class: 'row' }, keyIn, btn('Save', () => keyIn.value.trim() && saveKey(keyIn.value.trim()), 'primary'), btn('Remove', () => confirm('Remove the saved API key?') && saveKey(''), 'danger')),
      h('div', { class: 'row', style: 'margin-top:10px' }, keyState,
        h('span', { class: 'help', style: 'margin:0' }, 'Get one at ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); window.steez.open('https://console.anthropic.com/settings/keys'); } }, 'console.anthropic.com'), '. Stored only on this PC; usage is billed to your Anthropic account.')),
    ),
  );
  const out = h('div', { class: 'mono', style: 'margin-top:10px;white-space:pre-wrap' });
  const prompt = h('input', { placeholder: 'Ask or tell it to do something — e.g. "play my chill playlist" or "start a poll: best snack?"' });
  main.append(
    h('div', { class: 'grid2' },
      settingsForm('ai', { title: 'AI settings' }),
      h('div', {},
        card('Try it', h('div', { class: 'row' }, prompt, btn('Ask', async () => { out.textContent = '…'; const r = await api.action('ai:test', { prompt: prompt.value }); out.textContent = r.reply + (r.actions?.length ? `

Did: ${r.actions.join(', ')}` : ''); }, 'primary')), out),
        card('What the AI can do',
          h('ul', {},
            h('li', {}, h('b', {}, '@mention the bot / !ask'), ' — answers with the context of recent chat, title and game'),
            h('li', {}, h('b', {}, 'Takes actions'), ' — "@bot play Blinding Lights", "play my gym playlist", "skip", "volume 40", "start a poll…", "giveaway for a Steam key", "next game in the queue", "shout out xyz", "clip that" — limited by who is asking'),
            h('li', {}, h('b', {}, '!catchup [minutes]'), ' — “what did I miss?” summary of chat'),
            h('li', {}, h('b', {}, '!translate'), ' + optional auto-translation of foreign-script messages'),
            h('li', {}, h('b', {}, '${ai prompt}'), ' — use AI inside any custom command (try !roast)'),
            h('li', {}, h('b', {}, 'AI trivia'), ' — fresh questions about your current game (Games → Trivia → Use AI)'),
            h('li', {}, h('b', {}, 'Stream recap'), ' — written automatically at the end of each stream (Analytics + Discord)'),
            h('li', {}, h('b', {}, 'Spam check'), ' — optional AI review of first-time chatter messages'),
          ))),
    ),
  );
}

// Loyalty
function pageLoyalty(main) {
  main.append(head('Points & Viewers'));
  const tbl = h('div');
  const search = h('input', { placeholder: 'Search users…' });
  const sort = h('select', {}, ['points', 'watchMinutes', 'messages', 'lastSeen', 'firstSeen'].map((s) => h('option', { value: s }, label(s))));
  let timer;
  const load = async () => {
    const r = await api.get(`/api/users?search=${encodeURIComponent(search.value)}&sort=${sort.value}&limit=200`);
    tbl.replaceChildren(
      h('div', { class: 'muted small', style: 'margin-bottom:6px' }, `${fmt(r.total)} viewers`),
      h('table', {}, h('tr', {}, ['User', S.settings.loyalty.currencyName, 'Watch time', 'Messages', 'Achievements', 'Last seen', ''].map((t) => h('th', {}, t))),
        r.users.map((u) =>
          h('tr', {},
            h('td', {}, h('b', {}, u.display), u.isSub ? h('span', { class: 'tag' }, 'sub') : null),
            h('td', {}, h('input', { type: 'number', value: u.points, style: 'width:110px', onchange: async (e) => { await api.put(`/api/users/${u.login}`, { points: e.target.value }); toast('Saved'); } })),
            h('td', {}, dur((u.watchMinutes || 0) * 60000)),
            h('td', {}, fmt(u.messages)),
            h('td', {}, Object.keys(u.achievements || {}).length),
            h('td', { class: 'small' }, u.lastSeen ? ago(u.lastSeen) : '—'),
            h('td', {}, btn('✕', async () => { if (confirm(`Delete ${u.display}?`)) { await api.del(`/api/users/${u.login}`); load(); } }, 'sm danger')),
          ))),
    );
  };
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  sort.addEventListener('change', load);
  load();
  const csv = h('textarea', { placeholder: 'username,points[,minutes]\nviewer1,1500\nviewer2,320,600' });
  const mode = h('select', {}, h('option', { value: 'replace' }, 'Replace balances'), h('option', { value: 'add' }, 'Add to balances'));
  main.append(
    h('div', { class: 'grid2' },
      settingsForm('loyalty', { title: 'Loyalty settings' }),
      h('div', {},
        card('Import points (from StreamElements / Streamlabs CSV)', csv, h('div', { class: 'row', style: 'margin-top:8px' }, mode, btn('Import', async () => { const r = await api.action('points:import', { csv: csv.value, mode: mode.value }); toast(`Imported ${r.imported} users`); load(); }, 'primary'))),
      )),
    card('Viewers', h('div', { class: 'row', style: 'margin-bottom:10px' }, search, sort), h('div', { style: 'max-height:640px;overflow:auto' }, tbl)),
  );
}

// Games
function pageGames(main, on) {
  main.append(head('Games'));
  const bossBox = h('div');
  const drawBoss = (b) =>
    bossBox.replaceChildren(b
      ? h('div', {}, h('b', {}, `${b.emoji} ${b.name}`), ` — ${fmt(b.hp)}/${fmt(b.maxHp)} HP, ${b.attackers} attackers`, h('div', { class: 'bar', style: 'margin:8px 0' }, h('i', { style: `width:${(b.hp / b.maxHp) * 100}%;background:var(--bad)` })), btn('Make it flee', () => api.action('boss:flee'), 'sm danger'))
      : h('div', { class: 'muted' }, 'No boss active.'));
  drawBoss(S.boss);
  on.boss = drawBoss;
  const hp = h('input', { type: 'number', placeholder: 'HP (auto)', style: 'max-width:140px' });
  const topic = h('input', { placeholder: 'Topic (optional, AI only)' });
  const sw = h('input', { placeholder: 'secret word', value: S.settings.games.secretWord.word });
  const swr = h('input', { type: 'number', value: S.settings.games.secretWord.reward, style: 'max-width:120px' });
  main.append(
    h('div', { class: 'grid' },
      card('Raid boss', bossBox, h('div', { class: 'row', style: 'margin-top:8px' }, hp, btn('Spawn boss', () => api.action('boss:spawn', { hp: hp.value }), 'primary'))),
      card('Trivia', h('div', { class: 'row' }, topic, btn('Start round', () => api.action('trivia:start', { topic: topic.value }), 'primary'))),
      card('Secret word', h('p', { class: 'muted small' }, 'First viewer to say this word in chat wins. Nobody sees it but you.'), h('div', { class: 'row' }, sw, swr, btn('Set', () => api.action('secretword:set', { word: sw.value, reward: swr.value }).then(() => toast(sw.value ? 'Secret word armed 🤫' : 'Cleared')), 'primary'))),
    ),
    settingsForm('games', { title: 'Game settings', keys: Object.keys(S.settings.games).filter((k) => k !== 'secretWord') }),
  );
}

// Giveaways
function pageGiveaways(main, on) {
  main.append(head('Giveaways'));
  const f = { title: 'Giveaway', keyword: '!enter', ticketCost: 0, maxTickets: 1, subLuck: 2 };
  const live = h('div');
  const draw = (st) => {
    st ||= S.raffle;
    S.raffle = st;
    const r = st?.raffle;
    live.replaceChildren(
      r
        ? h('div', {},
            h('div', { class: 'row' }, h('b', {}, r.title), h('span', { class: `pill ${r.open ? 'good' : ''}` }, r.open ? 'OPEN' : 'closed'), h('span', { class: 'muted' }, `${r.entries.length} entrants · ${r.totalTickets} tickets`)),
            h('div', { class: 'row', style: 'margin:10px 0' }, btn('Close entries', () => api.action('raffle:stop')), btn('Draw winner', () => api.action('raffle:draw'), 'primary'), btn('Cancel (refund)', () => confirm('Cancel giveaway?') && api.action('raffle:cancel'), 'danger')),
            h('div', { style: 'max-height:300px;overflow:auto' }, h('table', {}, h('tr', {}, h('th', {}, 'User'), h('th', {}, 'Tickets'), h('th', {}, 'Sub')), r.entries.map((e) => h('tr', {}, h('td', {}, e.display), h('td', {}, e.tickets), h('td', {}, e.isSub ? '✓' : ''))))),
          )
        : h('div', { class: 'muted' }, 'No giveaway running.'),
      st?.lastWinner ? h('div', { class: 'card', style: 'margin-top:12px;border-color:var(--accent)' }, h('div', { class: 'muted small' }, 'Last winner'), h('b', { style: 'font-size:20px' }, `🎉 ${st.lastWinner.display}`), h('div', {}, st.lastWinner.responded ? `✅ responded: "${st.lastWinner.message}"` : '⏳ waiting for them to type in chat…')) : null,
    );
  };
  draw();
  on.raffle = draw;
  main.append(h('div', { class: 'grid2' },
    card('Start a giveaway', Object.keys(f).map((k) => field(f, k, `raffle.${k}`)), h('div', { class: 'help' }, 'Ticket cost 0 = free entry by typing the keyword. With a cost, viewers buy tickets with !ticket <n>. Sub luck multiplies subscriber odds.'), btn('Start giveaway', () => api.action('raffle:start', f), 'primary')),
    card('Current giveaway', live)));
}

// Polls & bets
function pagePolls(main, on) {
  main.append(head('Polls & Bets'));
  const pq = h('input', { placeholder: 'Question' });
  const po = h('textarea', { placeholder: 'One option per line' });
  const ps = h('input', { type: 'number', placeholder: 'Duration (s, optional)' });
  const pollBox = h('div');
  const drawPoll = (p) => {
    p ||= null;
    pollBox.replaceChildren(p
      ? h('div', {}, h('b', {}, p.question), ' ', h('span', { class: 'pill' }, p.open ? 'open' : 'closed'),
          p.options.map((o, i) => h('div', { style: 'margin:8px 0' }, h('div', { class: 'row' }, `${i + 1}. ${o.text}`, h('span', { class: 'grow' }), `${o.votes}`), h('div', { class: 'bar' }, h('i', { style: `width:${p.total ? (o.votes / p.total) * 100 : 0}%` })))),
          p.open ? btn('End poll', () => api.action('poll:end'), 'primary') : null)
      : h('div', { class: 'muted' }, 'No poll running.'));
  };
  drawPoll(S.poll);
  on.poll = drawPoll;

  const bq = h('input', { placeholder: 'What will happen?' });
  const bo = h('textarea', { placeholder: 'One outcome per line' });
  const betBox = h('div');
  const drawBets = (b) =>
    betBox.replaceChildren(b
      ? h('div', {}, h('b', {}, b.question), ' ', h('span', { class: 'pill' }, b.open ? 'open' : 'locked'),
          b.options.map((o, i) => h('div', { class: 'row', style: 'margin:8px 0' }, `${i + 1}. ${o.text}`, h('span', { class: 'muted' }, `${fmt(o.pool)} from ${o.bettors}`), h('span', { class: 'grow' }), btn('Winner', () => confirm(`Pay out "${o.text}"?`) && api.action('bets:resolve', { option: i }), 'sm primary'))),
          h('div', { class: 'row' }, b.open ? btn('Lock bets', () => api.action('bets:lock')) : null, btn('Refund all', () => confirm('Refund everyone?') && api.action('bets:refund'), 'danger')))
      : h('div', { class: 'muted' }, 'No bets running.'));
  drawBets(S.bets);
  on.bets = drawBets;
  const lines = (t) => t.value.split('\n').map((s) => s.trim()).filter(Boolean);
  main.append(h('div', { class: 'grid2' },
    h('div', {}, card('Chat poll', pq, h('div', { style: 'height:8px' }), po, h('div', { class: 'row', style: 'margin-top:8px' }, ps, btn('Start poll', () => api.action('poll:start', { question: pq.value, options: lines(po), seconds: ps.value }), 'primary'))), card('Live poll', pollBox)),
    h('div', {}, card(`Bets (with ${S.settings.loyalty.currencyName})`, bq, h('div', { style: 'height:8px' }), bo, h('div', { class: 'help' }, 'Viewers bet with !bet <option#> <amount>. Winners split the whole pot proportionally.'), btn('Open bets', () => api.action('bets:open', { question: bq.value, options: lines(bo) }), 'primary')), card('Live bets', betBox))));
}

// Queue
function pageQuotes(main) {
  main.append(head('Quotes'));
  const quotes = structuredClone(S.quotes);
  const box = h('div');
  const draw = () =>
    box.replaceChildren(quotes.length
      ? h('table', {}, h('tr', {}, ['#', 'Quote', 'Game', 'Date', ''].map((t) => h('th', {}, t))),
          quotes.map((q, i) => h('tr', {}, h('td', {}, q.id), h('td', {}, h('input', { value: q.text, oninput: (e) => (q.text = e.target.value) })), h('td', {}, h('input', { value: q.game || '', oninput: (e) => (q.game = e.target.value) })), h('td', { class: 'small' }, new Date(q.date).toLocaleDateString()), h('td', {}, btn('✕', () => (quotes.splice(i, 1), draw()), 'sm danger')))))
      : h('div', { class: 'empty' }, 'No quotes yet — mods add them with !addquote <text>.'));
  draw();
  main.append(card(null, box, h('div', { class: 'row', style: 'margin-top:10px' },
    btn('+ Add', () => { quotes.push({ id: Math.max(0, ...quotes.map((q) => q.id)) + 1, text: '', game: S.status.stream?.game || '', date: Date.now(), addedBy: 'dashboard' }); draw(); }),
    btn('Save quotes', async () => { S.quotes = await api.put('/api/quotes', quotes.filter((q) => q.text.trim())); toast('Saved ✓'); }, 'primary'))), settingsForm('quotes'));
}

// Achievements
function pageAchievements(main) {
  main.append(head('Achievements'), h('p', { class: 'muted' }, 'Viewers unlock these automatically. Unlocks are announced in chat, shown on the alert overlay and reward points.'));
  main.append(settingsForm('achievements'), card('All achievements', h('div', { class: 'grid' }, S.achievements.map((a) => h('div', { class: 'stat' }, h('b', {}, `${a.icon} ${a.name}`), h('span', {}, a.desc))))));
}

// Alerts
function pageAlerts(main) {
  main.append(head('Alerts & Events'));
  main.append(card('Test alerts', h('div', { class: 'row' }, ['follow', 'sub', 'resub', 'giftsub', 'giftbomb', 'cheer', 'raid', 'redemption'].map((t) => btn(t, () => api.action('alert:test', { type: t }))))));
  main.append(
    h('div', { class: 'grid2' },
      settingsForm('events', { title: 'Chat messages for events' }),
      h('div', {},
        settingsForm('redemptions', { title: 'Channel point redemptions' }),
        card(null, h('div', { class: 'help' }, 'Match a channel-point reward by its exact title. Response is sent to chat (${user}, ${input}), effect plays on the overlay, command runs a bot command, points gives loyalty points.')),
        settingsForm('overlay', { title: 'Overlay settings' }),
      )));
}

// Shop
function pageShop(main) {
  main.append(head('Shop & Effects'), h('p', { class: 'muted' }, 'Viewers spend loyalty points with !redeem <item> to trigger effects on the overlay. Effects: confetti, emoterain, tts, shake, spotlight.'));
  const txt = h('input', { value: 'Hello from the dashboard!' });
  main.append(card('Test effects', h('div', { class: 'row' }, txt, ['confetti', 'emoterain', 'tts', 'shake', 'spotlight'].map((e) => btn(e, () => api.action('effect:test', { effect: e, text: txt.value }))))), settingsForm('shop'));
}

// Hype
function pageHype(main, on) {
  main.append(head('Hype & Clips'));
  const meter = h('div');
  const drawMeter = () => meter.replaceChildren(h('div', { class: 'row' }, h('div', { class: 'stat' }, h('b', {}, hypeNow.mpm), h('span', {}, 'msgs / min')), h('div', { class: 'stat' }, h('b', {}, `${hypeNow.score}x`), h('span', {}, 'vs baseline')), h('div', { class: 'grow' }, h('div', { class: 'bar', style: 'height:14px' }, h('i', { style: `width:${hypeNow.level * 100}%;background:var(--accent)` })))));
  drawMeter();
  on.hype = (d) => {
    hypeNow = d;
    drawMeter();
  };
  const moments = h('div');
  const clips = h('div');
  const load = async () => {
    const [m, c] = await Promise.all([api.get('/api/hype'), api.get('/api/clips')]);
    moments.replaceChildren(m.length
      ? h('table', {}, h('tr', {}, ['When', 'Stream time', 'Speed', 'Top', 'Chat', 'Clip'].map((t) => h('th', {}, t))),
          m.slice(0, 100).map((x) => h('tr', {}, h('td', { class: 'small' }, new Date(x.t).toLocaleString()), h('td', {}, x.offset, x.manual ? h('div', { class: 'tag' }, `📍 ${x.note || 'marker'}`) : null), h('td', {}, x.mpm ? `${x.mpm}/min (${x.score}x)` : ''), h('td', {}, (x.top || []).join(' ')), h('td', { class: 'small mono', style: 'max-width:380px' }, (x.sample || []).slice(-3).join(' / ')), h('td', {}, x.clip ? h('a', { href: x.clip, target: '_blank' }, 'watch') : ''))))
      : h('div', { class: 'empty' }, 'No hype moments yet. They are detected automatically while live, or saved with !marker.'));
    clips.replaceChildren(c.length ? h('table', {}, c.slice(0, 100).map((x) => h('tr', {}, h('td', { class: 'small' }, new Date(x.t).toLocaleString()), h('td', {}, x.by), h('td', {}, x.game || ''), h('td', {}, h('a', { href: x.url, target: '_blank' }, x.url))))) : h('div', { class: 'empty' }, 'No clips yet.'));
  };
  load();
  on['hype:moment'] = load;
  on.clip = load;
  main.append(card('Live hype meter', meter), h('div', { class: 'grid2' }, settingsForm('hype'), settingsForm('clips', { title: '!clip command' })), card('Hype moments (with VOD timestamps)', moments), card('Clips', clips));
}

// Analytics
function spark(points, key, color) {
  if (points.length < 2) return h('span', { class: 'muted small' }, 'not enough data');
  const max = Math.max(1, ...points.map((p) => p[key]));
  const w = 600;
  const hgt = 60;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * w).toFixed(1)},${(hgt - (p[key] / max) * (hgt - 4) - 2).toFixed(1)}`).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('style', 'width:100%;height:60px');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', '2');
  svg.append(path);
  return h('div', {}, h('div', { class: 'small muted' }, `${label(key)} (max ${max})`), svg);
}
function pageAnalytics(main) {
  main.append(head('Analytics'));
  const box = h('div', {}, h('div', { class: 'empty' }, 'Loading…'));
  api.get('/api/streams').then((list) => {
    if (!list.length) return box.replaceChildren(h('div', { class: 'empty' }, 'Past streams will appear here after your first stream with the bot.'));
    box.replaceChildren(...list.map((s) =>
      card(`${new Date(s.start).toLocaleDateString()} — ${s.title}`,
        h('div', { class: 'row' }, ...[[dur(s.duration), 'duration'], [s.peakViewers, 'peak viewers'], [s.avgViewers, 'avg viewers'], [fmt(s.messages), 'messages'], [s.uniqueChatters, 'chatters'], [s.follows, 'follows'], [s.subs + s.gifts, 'subs'], [fmt(s.bits), 'bits'], [s.hypeMoments, 'hype moments']].map(([v, l]) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l)))),
        s.recap ? h('p', { style: 'margin-top:12px' }, '✨ ', s.recap) : null,
        h('div', { class: 'grid2', style: 'margin-top:10px' }, spark(s.timeline || [], 'viewers', '#d4d4d4'), spark(s.timeline || [], 'mpm', '#7a7a7a')),
        h('div', { class: 'small muted', style: 'margin-top:8px' }, `Games: ${(s.games || []).join(', ') || s.game} · Top chatters: ${(s.topChatters || []).slice(0, 5).map((t) => `${t.user} (${t.n})`).join(', ')}`),
      )));
  });
  main.append(box);
}

// Overlays
function pageSettings(main) {
  void head;
  const counters = structuredClone(S.counters);
  const cBox = h('div', {}, Object.keys(counters).length ? Object.keys(counters).map((k) => field(counters, k, `counter.${k}`)) : h('div', { class: 'muted' }, 'No counters yet — use ${count name} in a command.'));
  main.append(
    h('div', { class: 'grid2' },
      h('div', {}, settingsForm('general'), settingsForm('shoutout')),
      h('div', {},
        settingsForm('discord', { extra: btn('Send test', () => api.action('discord:test').then(() => toast('Sent'))) }),
        card('Counters', cBox, btn('Save counters', async () => { S.counters = await api.put('/api/counters', counters); toast('Saved ✓'); }, 'primary')),
        card('Backup', h('p', { class: 'muted' }, 'Automatic daily backups are kept in the Steez data folder (bot/backups). You can also download everything except login tokens:'),
          h('div', { class: 'row' },
            btn('Download backup', async () => {
              const data = await api.get('/api/export');
              const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: `steez-bot-backup-${new Date().toISOString().slice(0, 10)}.json` });
              a.click();
            }, 'primary'),
            btn('Open data folder', () => window.steez.openDataFolder()))),
      )),
  );
}

// Logs
function pageLogs(main, on) {
  main.append(head('Logs'));
  const box = h('div', { class: 'logbox' });
  const add = (l) => {
    box.append(h('div', { class: l.level }, `${new Date(l.t).toLocaleTimeString()} ${l.level.toUpperCase().padEnd(5)} ${l.msg}`));
    if (box.children.length > 500) box.firstChild.remove();
    box.scrollTop = box.scrollHeight;
  };
  logBuf.forEach(add);
  on.log = add;
  main.append(card(null, box));
}

// Mod Panel — remote access for the channel's moderators
function pageModPanel(main, on) {
  main.append(head('Mod Panel', 'Your Twitch mods can manage the bot from their browser while Steez is open.'));
  const st = h('div');
  let status = null;
  const draw = (s) => {
    status = s || status;
    if (!status) return;
    const tone = status.state === 'online' ? 'good' : status.state === 'error' ? 'bad' : '';
    const text = { online: 'Live — mods can connect', connecting: 'Connecting…', off: status.enabled ? 'Not connected' : 'Turned off', error: 'Problem' }[status.state] || status.state;
    st.replaceChildren(
      h('div', { class: 'row' }, h('span', { class: `pill ${tone}` }, text), status.detail ? h('span', { class: 'faint small grow' }, status.detail) : null, status.state !== 'online' && status.enabled ? btn('Reconnect', async () => draw(await api.action('modpanel:reconnect')), 'sm') : null),
      status.url
        ? h('div', { style: 'margin-top:14px' },
            h('div', { class: 'faint small', style: 'margin-bottom:6px' }, 'Send this link to your mods. They log in with their own Twitch account — only moderators of your channel get in.'),
            h('div', { class: 'row' }, h('code', {}, status.url), btn('Copy link', () => copy(status.url), 'sm primary'), btn('Open', () => window.steez.open(status.url), 'sm')))
        : h('div', { class: 'faint', style: 'margin-top:10px' }, 'The mod panel needs the Steez relay, which isn’t available in this build.'),
    );
  };
  api.action('modpanel:status').then(draw);
  on.modPanel = draw;

  const setup = card('One-time setup (channel owner of the Steez Twitch app only)',
    h('p', { class: 'muted', style: 'margin-top:0' }, 'Twitch must allow the mod panel to log people in. In dev.twitch.tv → your Steez app → OAuth Redirect URLs, add:'),
    h('div', { class: 'row' }, h('code', { id: 'mp-redirect' }, '…'), btn('Copy', () => copy(document.getElementById('mp-redirect').textContent), 'sm')),
    h('div', { class: 'help' }, 'Only the owner of the Twitch app needs to do this once — streamers using Steez don’t.'));
  api.action('modpanel:status').then((s) => {
    const el = setup.querySelector('#mp-redirect');
    if (el) el.textContent = s.url || 'Relay not configured';
  });

  const actBox = h('div');
  const acts = [];
  const drawActs = () =>
    actBox.replaceChildren(acts.length
      ? h('table', {}, h('tr', {}, ['When', 'Mod', 'What'].map((t) => h('th', {}, t))), acts.slice(0, 100).map((a) => h('tr', {}, h('td', { class: 'small faint' }, ago(a.t)), h('td', {}, h('b', {}, a.mod)), h('td', {}, a.summary))))
      : h('div', { class: 'empty' }, 'Nothing changed by mods yet.'));
  api.action('modpanel:activity').then((l) => {
    acts.push(...l);
    drawActs();
  });
  on.modActivity = (a) => {
    acts.unshift(a);
    drawActs();
  };

  main.append(
    h('div', { class: 'grid2' },
      h('div', {}, card('Status', st), settingsForm('modPanel', { title: 'What mods can change', onSaved: async () => draw(await api.action('modpanel:apply')) })),
      h('div', {}, card('Mod activity', h('div', { style: 'max-height:520px;overflow:auto' }, actBox)), setup)),
  );
}

// ─── Mounting ────────────────────────────────────────────────
const PAGES = {
  overview: pageOverview,
  commands: pageCommands,
  timers: pageTimers,
  moderation: pageModeration,
  ai: pageAI,
  loyalty: pageLoyalty,
  games: pageGames,
  giveaways: pageGiveaways,
  polls: pagePolls,
  quotes: pageQuotes,
  achievements: pageAchievements,
  alerts: pageAlerts,
  shop: pageShop,
  hype: pageHype,
  analytics: pageAnalytics,
  settings: pageSettings,
  logs: pageLogs,
  modpanel: pageModPanel,
};

const chatBuf = buffers.chat;
const logBuf = buffers.log;
let mounted = null; // { id, el, offs }

async function reload(redraw = true) {
  S = await api.get('/api/state');
  if (redraw && mounted) render();
}

function render() {
  const { id, el } = mounted;
  mounted.offs.forEach((f) => f());
  mounted.offs = [];
  const on = {};
  el.replaceChildren();
  try {
    PAGES[id](el, on);
  } catch (e) {
    el.append(card('Error', String(e.stack || e)));
  }
  // Live updates: page handlers declared in `on`
  const map = { chat: 'chat', log: 'log', hype: 'hype', status: 'status' };
  for (const [type, fn] of Object.entries(on)) {
    mounted.offs.push(
      onBot(map[type] || type, (data) => {
        if (['raffle', 'poll', 'bets', 'boss', 'shield', 'session', 'status'].includes(type) && S) S[type] = data;
        fn(data);
      }),
    );
  }
}

/** Mount a bot page into a container. Returns an unmount function. */
export async function mountBotPage(id, el) {
  mounted = { id, el, offs: [] };
  const mine = mounted;
  el.replaceChildren(h('div', { class: 'faint' }, 'Loading…'));
  await reload(false);
  if (mounted !== mine) return () => {};
  hypeNow = buffers.hype;
  render();
  return () => {
    mine.offs.forEach((f) => f());
    if (mounted === mine) mounted = null;
  };
}
