// Twitch Chat: the channel's chat split into panes (chat, commands & bots, mods, events), drawn the
// way Twitch draws it, with Twitch, 7TV, BTTV and FFZ emotes. Plain DOM and batched updates keep it
// light: each pane holds a few hundred lines and new lines are added once per frame.
import '@fontsource-variable/inter';
import './twitchChat.css';
import { api, onBot, connectBotSocket } from '../../lib/bot.js';

const KEY = 'steez.twitchChat.v1';
const MAX_LINES = 250;
export const CATS = [
  ['chat', 'Chat', 'Everyday chat messages'],
  ['mod', 'Mods & you', 'Messages from mods and the broadcaster'],
  ['command', 'Commands', 'Messages that start with the command prefix'],
  ['bot', 'Bots', 'Steez, SteezBot and the bots on your ignore list'],
  ['event', 'Stream events', 'Subs, gifts, raids, bits, follows, redemptions'],
];
export const EXTRAS = [
  ['mention', 'Mentions of you'],
  ['first', 'First-time chatters'],
];
export const DEFAULT_LAYOUT = {
  dir: 'auto', // auto: side by side when there's room for every pane, stacked when narrow
  font: 13,
  timestamps: false,
  modIcons: true,
  chatBox: true,
  panes: [
    { id: 'chat', title: 'Chat', cats: ['chat'], w: 1.5 },
    { id: 'cmd', title: 'Commands & Bots', cats: ['command', 'bot'], w: 1 },
    { id: 'mod', title: 'Mod Chat', cats: ['mod'], w: 1 },
    { id: 'events', title: 'Stream Events', cats: ['event'], w: 1 },
  ],
};

/** Does this line belong in a pane showing `cats`? */
export const fits = (item, cats) => cats.includes(item.cat) || (item.mention && cats.includes('mention')) || (item.first && cats.includes('first'));

// ─── Small helpers ────────────────────────────────────────────────
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const SVG = {
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-2.1a7.6 7.6 0 0 0 0-1.8l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.6-.9L15 3.5h-4l-.4 2.7a7 7 0 0 0-1.6.9l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 1.8l-2 1.6 2 3.4 2.4-1c.5.4 1 .7 1.6.9l.4 2.7h4l.4-2.7c.6-.2 1.1-.5 1.6-.9l2.4 1 2-3.4z',
  x: 'M6 6l12 12M18 6 6 18',
  grip: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
  plus: 'M12 5v14M5 12h14',
  cols: 'M4 4h16v16H4zM9.5 4v16M14.5 4v16',
  rows: 'M4 4h16v16H4zM4 9.5h16M4 14.5h16',
  out: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  pin: 'M15 4l5 5-3 1-4 4 1 4-2 2-4-4-4 4-1-1 4-4-4-4 2-2 4 1 4-4z',
  refresh: 'M20 11a8 8 0 0 0-14.3-4.9L4 8m0-4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16m0 4v-4h-4',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6',
  trash: 'M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-13v4l3 2',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
  reply: 'M9 7 4 12l5 5M4 12h10a6 6 0 0 1 6 6',
  star: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1-3-5-4-5-1.5S12 7 12 7zm0 0c1-3 5-4 5-1.5S12 7 12 7z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  bits: 'M12 3 5 12l7 9 7-9z',
  raid: 'M4 12h12M12 6l6 6-6 6M4 6v12',
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 12h6M12 9v6',
  mega: 'M4 10v4h3l6 4V6L7 10zM17 9a4 4 0 0 1 0 6',
  obs: 'M4 5h16v14H4zM4 9h16M15 9v10',
  auto: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
};
const icon = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', SVG[name] || '');
  s.append(p);
  return s;
};
const btn = (ic, title, onclick, cls = 'tc-btn ic') => {
  const b = el('button', cls);
  b.type = 'button';
  b.title = title;
  if (ic) b.append(icon(ic));
  b.addEventListener('click', onclick);
  return b;
};

// Twitch's default name colours, and a lift for colours too dark to read on the dark theme.
const DEFAULT_COLORS = ['#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50', '#9ACD32', '#FF4500', '#2E8B57', '#DAA520', '#D2691E', '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F'];
const colorCache = new Map();
export function nameColor(login, color) {
  const raw = color || DEFAULT_COLORS[((login || 'x').charCodeAt(0) + (login || 'x').charCodeAt((login || 'x').length - 1)) % DEFAULT_COLORS.length];
  if (colorCache.has(raw)) return colorCache.get(raw);
  const m = /^#?([0-9a-f]{6})$/i.exec(raw);
  let out = raw;
  if (m) {
    const n = parseInt(m[1], 16);
    let r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum < 0.35) {
      l = Math.max(l, 0.5 + (0.35 - lum) * 0.5);
      out = `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(Math.min(l, 0.82) * 100)}%)`;
    }
  }
  colorCache.set(raw, out);
  return out;
}

const URL_RE = /^(https?:\/\/[^\s]+|www\.[^\s]+\.[a-z]{2,}[^\s]*)$/i;

/**
 * The message body: Twitch emotes by position, then 7TV/BTTV/FFZ emotes by word, links and
 * @mentions. Built with DOM nodes only, never HTML strings.
 */
export function renderBody(text, ranges, emotes, me) {
  const frag = document.createDocumentFragment();
  const chars = [...text];
  const parts = [];
  let i = 0;
  for (const [a, b, id] of ranges || []) {
    if (a < i || a >= chars.length) continue;
    if (a > i) parts.push(chars.slice(i, a).join(''));
    parts.push({ twitch: id, name: chars.slice(a, b + 1).join('') });
    i = b + 1;
  }
  if (i < chars.length) parts.push(chars.slice(i).join(''));
  let last = null; // the last emote node, for zero-width emotes to sit on
  const addEmote = (src, src2, name, w, h, zw) => {
    const img = el('img', 'tc-emote');
    img.src = src;
    if (src2) img.srcset = `${src} 1x, ${src2} 2x`;
    img.alt = name;
    img.title = name;
    img.decoding = 'async';
    if (w && h) {
      img.width = w;
      img.height = h;
    }
    if (zw && last) {
      if (!last.classList.contains('tc-stack')) {
        const stack = el('span', 'tc-stack');
        last.replaceWith(stack);
        stack.append(last);
        last = stack;
      }
      last.append(img);
      return;
    }
    frag.append(img);
    last = img;
  };
  for (const p of parts) {
    if (typeof p !== 'string') {
      addEmote(`https://static-cdn.jtvnw.net/emoticons/v2/${p.twitch}/default/dark/1.0`, `https://static-cdn.jtvnw.net/emoticons/v2/${p.twitch}/default/dark/2.0`, p.name, 0, 28, false);
      continue;
    }
    for (const w of p.split(/(\s+)/)) {
      if (!w) continue;
      if (/^\s+$/.test(w)) {
        frag.append(w);
        continue;
      }
      const e = emotes && Object.prototype.hasOwnProperty.call(emotes, w) ? emotes[w] : null;
      if (e) {
        addEmote(e[0], e[1], w, e[2], e[3], e[4]);
        continue;
      }
      last = null;
      if (URL_RE.test(w)) {
        const a = el('a', 'tc-link', w);
        a.href = /^https?:/i.test(w) ? w : `https://${w}`;
        a.addEventListener('click', (ev) => {
          ev.preventDefault();
          if (window.steez?.open) window.steez.open(a.href);
          else window.open(a.href, '_blank', 'noopener'); // OBS dock
        });
        frag.append(a);
      } else if (w[0] === '@' && w.length > 1) {
        const s = el('span', 'tc-mention', w);
        if (me && w.slice(1).replace(/[^\w]/g, '').toLowerCase() === me) s.classList.add('tc-me');
        frag.append(s);
      } else frag.append(w);
    }
  }
  return frag;
}

// ─── Getting the lines: from Steez itself, or (in an OBS dock) with the dock key ──
function appTransport() {
  return {
    recent: () => api.action('chatfeed:recent'),
    refresh: () => api.action('chatfeed:refresh'),
    mod: (a) => api.action('chatfeed:mod', a),
    say: (text) => api.action('chatfeed:say', { text }),
    listen(h) {
      connectBotSocket();
      const offs = [onBot('chatfeed', h.add), onBot('chatfeed:del', h.del), onBot('chatfeed:assets', h.assets)];
      return () => offs.forEach((f) => f());
    },
  };
}
function dockTransport(key) {
  const call = async (method, path, body) => {
    const r = await fetch(`/dockapi/chat/${path}`, { method, headers: { 'x-dock-key': key, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Steez answered ${r.status}`), { status: r.status });
    return j.result;
  };
  return {
    recent: () => call('GET', 'recent'),
    refresh: () => call('POST', 'refresh', {}),
    mod: (a) => call('POST', 'mod', a),
    say: (text) => call('POST', 'say', { text }),
    listen(h) {
      let ws = null;
      let dead = false;
      let timer = 0;
      const open = () => {
        ws = new WebSocket(`ws://${location.host}/ws?dock=${encodeURIComponent(key)}`);
        ws.onopen = () => h.connected?.();
        ws.onmessage = (ev) => {
          let m;
          try {
            m = JSON.parse(ev.data);
          } catch {
            return;
          }
          if (m.type === 'chatfeed') h.add(m.data);
          else if (m.type === 'chatfeed:del') h.del(m.data);
          else if (m.type === 'chatfeed:assets') h.assets(m.data);
        };
        // Steez closed or restarted: keep trying, then reload what was missed
        ws.onclose = () => {
          if (!dead) timer = setTimeout(open, 3000);
          h.lost?.();
        };
      };
      open();
      return () => {
        dead = true;
        clearTimeout(timer);
        ws?.close();
      };
    },
  };
}

// ─── The view ──────────────────────────────────────────────────────
export function mountTwitchChat(root, { popout = false, dock = null } = {}) {
  const T = dock ? dockTransport(dock) : appTransport();
  let layout = loadLayout();
  let assets = { badges: {}, emotes: {}, counts: {}, channel: null };
  const items = [];
  const byId = new Map(); // message id → rendered nodes
  const queue = [];
  let frame = 0;
  let panes = [];
  let alive = true;
  const offs = [];

  const shell = el('div', `tc-root${popout ? ' popout' : ''}`);
  const status = el('span', 'st', 'Connecting…');
  const panesEl = el('div', 'tc-panes');
  const DIRS = { auto: 'Layout: automatic (side by side when there is room). Click for side by side', cols: 'Layout: side by side. Click for stacked', rows: 'Layout: stacked. Click for automatic' };
  const dirBtn = btn(null, DIRS.auto, () => setLayout({ dir: { auto: 'cols', cols: 'rows', rows: 'auto' }[layout.dir] || 'auto' }));
  // the direction actually used: 'auto' picks by the width available for each pane
  const stacked = () => (layout.dir === 'auto' ? panesEl.clientWidth / Math.max(1, layout.panes.length) < 230 : layout.dir === 'rows');
  const bar = el('div', 'tc-bar');
  bar.append(
    el('span', 't', 'Twitch Chat'),
    status,
    el('span', 'grow'),
    btn('plus', 'Add a pane', () => addPane(), 'tc-btn'),
    dirBtn,
    btn('sliders', 'Chat settings', (e) => openAppSettings(e.currentTarget)),
    btn('refresh', 'Reload badges and emotes', () => T.refresh().then(applyAssets).catch(() => {})),
  );
  bar.children[3].append(' Pane');
  if (popout && window.steez?.chat) {
    const pin = btn('pin', 'Keep this window on top', async () => {
      const on = await window.steez.chat.onTop(!pin.classList.contains('on'));
      pin.classList.toggle('on', !!on);
    });
    bar.append(pin);
  } else if (!popout) {
    const obs = btn('obs', 'Use this chat as a dock inside OBS', (e) => openDockInfo(e.currentTarget), 'tc-btn');
    obs.append(' OBS dock');
    const out = btn('out', 'Pop out into its own window', () => window.steez?.chat?.popout(), 'tc-btn');
    out.append(' Pop out');
    bar.append(obs, out);
  }
  const box = chatBox();
  shell.append(bar, panesEl, box.el);
  root.replaceChildren(shell);

  function loadLayout() {
    try {
      const l = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (l && Array.isArray(l.panes) && l.panes.length) return { ...DEFAULT_LAYOUT, ...l };
    } catch {
      /* ignore */
    }
    return structuredClone(DEFAULT_LAYOUT);
  }
  function saveLayout() {
    try {
      localStorage.setItem(KEY, JSON.stringify(layout));
    } catch {
      /* ignore */
    }
  }
  function setLayout(patch, rebuild = true) {
    layout = { ...layout, ...patch };
    saveLayout();
    if (rebuild) build();
    else applyLook();
  }
  // The main window and the pop-out share the layout: a change in one shows in the other.
  const onStorage = (e) => {
    if (e.key !== KEY) return;
    layout = loadLayout();
    build();
  };
  window.addEventListener('storage', onStorage);

  // ─── Chatting from here (as the streamer) ──
  function chatBox() {
    const wrap = el('div', 'tc-send');
    const input = el('input');
    input.type = 'text';
    input.maxLength = 500;
    input.placeholder = 'Send a message';
    input.spellcheck = true;
    const count = el('span', 'tc-count');
    const as = el('span', 'tc-as');
    const go = el('button', 'tc-btn primary', 'Chat');
    const row = el('div', 'tc-send-row');
    row.append(as, count, go);
    wrap.append(input, row);
    let last = '';
    let busy = false;
    // Tab completes emote names and the names of people in chat, cycling on repeat presses
    let tab = null;
    const candidates = (prefix) => {
      const p = prefix.toLowerCase();
      const at = p.startsWith('@');
      const q = at ? p.slice(1) : p;
      const names = [...new Set(items.slice(-300).reverse().map((it) => it.user?.display).filter(Boolean))].filter((n) => n.toLowerCase().startsWith(q)).map((n) => (at ? '@' : '') + n);
      const emotes = at ? [] : Object.keys(assets.emotes || {}).filter((e) => e.toLowerCase().startsWith(q)).sort((a, b) => a.length - b.length);
      return [...names, ...emotes].slice(0, 50);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const v = input.value;
        const end = input.selectionStart;
        if (tab && tab.text !== v) tab = null; // the text changed since the last Tab: start over
        if (!tab) {
          const start = v.lastIndexOf(' ', end - 1) + 1;
          const word = v.slice(start, end);
          if (!word) return;
          tab = { start, end, list: candidates(word), i: -1 };
        }
        if (!tab.list.length) return (tab = null);
        tab.i = (tab.i + (e.shiftKey ? -1 : 1) + tab.list.length) % tab.list.length;
        const pick = tab.list[tab.i];
        input.value = v.slice(0, tab.start) + pick + ' ' + v.slice(tab.end).replace(/^ /, '');
        tab.end = tab.start + pick.length + 1;
        tab.text = input.value;
        input.setSelectionRange(tab.end, tab.end);
        return update();
      }
      tab = null;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      } else if (e.key === 'ArrowUp' && !input.value && last) {
        e.preventDefault();
        input.value = last;
        update();
      }
    });
    const update = () => {
      const n = input.value.length;
      count.textContent = n > 400 ? String(500 - n) : '';
      count.classList.toggle('warn', n > 480);
      go.disabled = busy || !input.value.trim();
    };
    input.addEventListener('input', () => ((tab = null), update()));
    async function send() {
      const text = input.value.trim();
      if (!text || busy) return;
      busy = true;
      update();
      try {
        await T.say(text);
        last = text;
        input.value = '';
        wrap.classList.remove('err');
        as.textContent = chattingAs();
      } catch (e) {
        wrap.classList.add('err');
        as.textContent = e.message || 'Could not send that.';
      }
      busy = false;
      update();
      input.focus();
    }
    go.addEventListener('click', send);
    const chattingAs = () => (assets.channel ? `Chatting as ${assets.channel.login}` : '');
    update();
    return { el: wrap, refresh: () => (as.textContent = wrap.classList.contains('err') ? as.textContent : chattingAs()) };
  }

  function applyLook() {
    box?.el.classList.toggle('hidden', !layout.chatBox);
    shell.style.setProperty('--tc-font', `${layout.font}px`);
    panesEl.classList.toggle('rows', stacked());
    dirBtn.replaceChildren(icon(layout.dir === 'auto' ? 'auto' : layout.dir === 'rows' ? 'rows' : 'cols'));
    dirBtn.title = DIRS[layout.dir] || DIRS.auto;
  }

  // ─── Rendering a line ──
  const me = () => (assets.channel?.login || '').toLowerCase();
  function badgeImgs(user) {
    const out = [];
    for (const [set, ver] of user.badges || []) {
      const b = assets.badges[`${set}/${ver}`];
      if (!b) continue;
      const img = el('img', 'tc-badge');
      img.src = b[0];
      if (b[1]) img.srcset = `${b[0]} 1x, ${b[1]} 2x`;
      img.alt = img.title = b[2] || set;
      out.push(img);
    }
    return out;
  }
  const time = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');
  function chatLine(item, { inNotice = false } = {}) {
    const u = item.user;
    const ln = el('div', 'tc-ln');
    if (!inNotice) {
      if (item.action) ln.classList.add('tc-act');
      if (item.deleted) ln.classList.add('tc-del');
      if (item.mention) ln.classList.add('tc-mentioned');
      if (item.self) ln.classList.add('tc-self');
      if (item.first) {
        ln.classList.add('tc-first');
        ln.append(el('span', 'tc-tag', 'First-time chat'));
      } else if (item.highlight) {
        ln.classList.add('tc-hl');
        ln.append(el('span', 'tc-tag', 'Highlighted message'));
      }
      if (item.reply) {
        const r = el('div', 'tc-reply');
        r.append(icon('reply'), `Replying to @${item.reply.display}: ${item.reply.text}`);
        ln.append(r);
      }
      if (layout.modIcons && item.kind === 'chat' && !item.self && u.login && u.login !== me() && !(u.badges || []).some(([s]) => s === 'broadcaster')) ln.append(modIcons(item));
    }
    if (layout.timestamps) ln.append(el('span', 'tc-ts', time(item.t)));
    ln.append(...badgeImgs(u));
    const name = el('span', 'tc-name', u.display || u.login);
    name.style.color = nameColor(u.login, u.color);
    ln.append(name);
    if (!item.action) ln.append(el('span', 'tc-colon', ':'));
    else ln.append(' ');
    const body = el('span', 'tc-body');
    if (item.action) body.style.color = nameColor(u.login, u.color);
    if (item.deleted) body.textContent = '<message deleted>';
    else body.append(renderBody(item.text, item.emotes, assets.emotes, me()));
    ln.append(body);
    return ln;
  }
  const NOTE_ICON = { sub: 'star', resub: 'star', subgift: 'gift', submysterygift: 'gift', anonsubgift: 'gift', anonsubmysterygift: 'gift', giftpaidupgrade: 'star', cheer: 'bits', follow: 'heart', raid: 'raid', redeem: 'coin', announcement: 'mega' };
  const ANNOUNCE = { BLUE: ['#00d6d6', '#9146ff'], GREEN: ['#00db84', '#57bee6'], ORANGE: ['#ffb31a', '#e0e000'], PURPLE: ['#9146ff', '#ff75e6'] };
  function noticeLine(item) {
    const type = item.event?.type || 'notice';
    const kind = /gift/.test(type) ? 'gift' : /sub|upgrade/.test(type) ? 'sub' : type;
    const box = el('div', `tc-note ${kind}`);
    if (type === 'announcement') {
      const c = ANNOUNCE[(item.event.color || '').toUpperCase()] || ANNOUNCE.BLUE;
      box.style.setProperty('--a1', c[0]);
      box.style.setProperty('--a2', c[1]);
      box.append(el('span', 'tc-label', 'Announcement'));
    }
    if (item.event?.text) {
      const sys = el('div', 'sys');
      if (NOTE_ICON[type]) sys.append(icon(NOTE_ICON[type]));
      sys.append(el('span', null, item.event.text));
      box.append(sys);
    }
    if (item.text && item.user?.login) box.append(chatLine(item, { inNotice: true }));
    else if (item.text) box.append(el('div', 'tc-ln', item.text));
    return box;
  }
  const render = (item) => (item.kind === 'notice' || item.bits ? noticeLine(item) : chatLine(item));

  function modIcons(item) {
    const box = el('span', 'tc-mod');
    const act = (a, extra) => (ev) => {
      ev.stopPropagation();
      if (a === 'ban' && !confirm(`Ban ${item.user.display} from the channel?`)) return;
      T.mod({ act: a, id: item.id, login: item.user.login, userId: item.user.id, ...extra }).catch(() => {});
    };
    box.append(btn('trash', 'Delete message', act('delete'), ''), btn('clock', 'Timeout 10 minutes', act('timeout', { seconds: 600 }), ''), btn('ban', 'Ban user', act('ban'), ''));
    return box;
  }

  // ─── Panes ──
  function build() {
    applyLook();
    panesEl.replaceChildren();
    byId.clear();
    panes = layout.panes.map((p, i) => makePane(p, i));
    panes.forEach((p, i) => {
      if (i) panesEl.append(splitter(i));
      panesEl.append(p.el);
    });
    // fill each pane with what it should already show
    for (const p of panes) {
      const frag = document.createDocumentFragment();
      const mine = items.filter((it) => fits(it, p.cfg.cats)).slice(-MAX_LINES);
      for (const it of mine) frag.append(track(it, render(it)));
      p.list.append(frag);
      p.count = mine.length;
      p.empty.classList.toggle('hidden', p.count > 0);
      p.list.scrollTop = p.list.scrollHeight;
    }
  }

  function makePane(cfg, index) {
    const pane = { cfg, atBottom: true, count: 0 };
    const node = el('section', 'tc-pane');
    node.style.setProperty('--w', String(cfg.w || 1));
    const head = el('div', 'tc-head');
    const left = el('div', 'l');
    const grip = btn('grip', 'Drag to move this pane', () => {}, 'tc-btn ic grip');
    grip.draggable = true;
    grip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/tc-pane', String(index));
      e.dataTransfer.effectAllowed = 'move';
      node.classList.add('dragging');
    });
    grip.addEventListener('dragend', () => node.classList.remove('dragging'));
    node.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('text/tc-pane')) return;
      e.preventDefault();
      node.classList.add('drop-before');
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-before'));
    node.addEventListener('drop', (e) => {
      node.classList.remove('drop-before');
      const from = Number(e.dataTransfer.getData('text/tc-pane'));
      if (!Number.isInteger(from) || from === index) return;
      const list = [...layout.panes];
      const [moved] = list.splice(from, 1);
      list.splice(from < index ? index - 1 : index, 0, moved);
      setLayout({ panes: list });
    });
    left.append(grip);
    const nm = el('div', 'nm', cfg.title || 'Chat');
    const right = el('div', 'r');
    right.append(
      btn('gear', 'Pane settings', () => togglePaneSettings(pane)),
      btn('x', 'Remove this pane', () => {
        if (layout.panes.length <= 1) return;
        setLayout({ panes: layout.panes.filter((p) => p !== cfg) });
      }),
    );
    if (layout.panes.length <= 1) right.lastChild.disabled = true;
    head.append(left, nm, right);
    const list = el('div', 'tc-list');
    const empty = el('div', 'tc-empty', emptyText(cfg));
    list.append(empty);
    const paused = el('button', 'tc-paused hidden', 'Chat paused due to scroll');
    paused.addEventListener('click', () => {
      list.scrollTop = list.scrollHeight;
    });
    list.addEventListener(
      'scroll',
      () => {
        const at = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
        if (at !== pane.atBottom) {
          pane.atBottom = at;
          if (at) {
            paused.textContent = 'Chat paused due to scroll';
            trim(pane);
          }
          paused.classList.toggle('hidden', at);
        }
      },
      { passive: true },
    );
    node.append(head, list, paused);
    Object.assign(pane, { el: node, list, empty, paused, nm, pending: 0 });
    return pane;
  }
  function emptyText(cfg) {
    const names = cfg.cats.map((c) => (CATS.find((x) => x[0] === c) || EXTRAS.find((x) => x[0] === c) || [c, c])[1].toLowerCase());
    return `Waiting for ${names.join(', ') || 'messages'}…`;
  }

  function splitter(i) {
    const s = el('div', 'tc-split');
    s.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      s.classList.add('drag');
      s.setPointerCapture(e.pointerId);
      const a = panes[i - 1], b = panes[i];
      const rows = stacked();
      const ra = a.el.getBoundingClientRect(), rb = b.el.getBoundingClientRect();
      const total = rows ? ra.height + rb.height : ra.width + rb.width;
      const wsum = (a.cfg.w || 1) + (b.cfg.w || 1);
      const start = rows ? e.clientY : e.clientX;
      const sizeA = rows ? ra.height : ra.width;
      const move = (ev) => {
        const d = (rows ? ev.clientY : ev.clientX) - start;
        const fa = Math.min(0.88, Math.max(0.12, (sizeA + d) / total));
        a.cfg.w = +(wsum * fa).toFixed(3);
        b.cfg.w = +(wsum * (1 - fa)).toFixed(3);
        a.el.style.setProperty('--w', a.cfg.w);
        b.el.style.setProperty('--w', b.cfg.w);
      };
      const up = () => {
        s.classList.remove('drag');
        s.removeEventListener('pointermove', move);
        s.removeEventListener('pointerup', up);
        saveLayout();
      };
      s.addEventListener('pointermove', move);
      s.addEventListener('pointerup', up);
    });
    return s;
  }

  function addPane() {
    const id = Math.random().toString(36).slice(2, 8);
    setLayout({ panes: [...layout.panes, { id, title: 'New pane', cats: ['chat'], w: 1 }] });
    togglePaneSettings(panes[panes.length - 1]);
  }

  function togglePaneSettings(pane) {
    const open = pane.el.querySelector('.tc-pop');
    if (open) return open.remove();
    const pop = el('div', 'tc-pop');
    const title = el('input');
    title.type = 'text';
    title.value = pane.cfg.title || '';
    title.placeholder = 'Pane name';
    pop.append(el('div', 'h', 'Name'), title, el('div', 'h', 'Show'));
    const boxes = [...CATS, ...EXTRAS].map(([key, label, help]) => {
      const lab = el('label', 'ck');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = pane.cfg.cats.includes(key);
      cb.value = key;
      lab.title = help || '';
      lab.append(cb, label);
      pop.append(lab);
      return cb;
    });
    const row = el('div', 'row');
    const done = el('button', 'tc-btn primary', 'Done');
    done.addEventListener('click', () => {
      const cats = boxes.filter((b) => b.checked).map((b) => b.value);
      const panesNext = layout.panes.map((p) => (p === pane.cfg ? { ...p, title: title.value.trim() || 'Chat', cats: cats.length ? cats : ['chat'] } : p));
      setLayout({ panes: panesNext });
    });
    row.append(done);
    pop.append(row);
    pane.el.append(pop);
    title.focus();
  }

  function openAppSettings(anchor) {
    const old = shell.querySelector('.tc-pop.app');
    if (old) return old.remove();
    const pop = el('div', 'tc-pop app');
    const font = el('input');
    font.type = 'range';
    font.min = '11';
    font.max = '20';
    font.value = String(layout.font);
    font.addEventListener('input', () => setLayout({ font: Number(font.value) }, false));
    const ck = (key, label) => {
      const lab = el('label', 'ck');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = !!layout[key];
      cb.addEventListener('change', () => setLayout({ [key]: cb.checked }));
      lab.append(cb, label);
      return lab;
    };
    const reset = el('button', 'tc-btn', 'Reset layout');
    reset.addEventListener('click', () => setLayout(structuredClone(DEFAULT_LAYOUT)));
    const row = el('div', 'row');
    row.append(reset);
    pop.append(el('div', 'h', 'Text size'), font, ck('timestamps', 'Show timestamps'), ck('modIcons', 'Mod buttons on hover (delete, timeout, ban)'), ck('chatBox', 'Show the chat box'), row);
    const r = anchor.getBoundingClientRect();
    pop.style.top = `${r.bottom + 6}px`;
    pop.style.right = `${Math.max(10, innerWidth - r.right)}px`;
    shell.append(pop);
    const close = (e) => {
      if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) {
        pop.remove();
        document.removeEventListener('pointerdown', close, true);
      }
    };
    document.addEventListener('pointerdown', close, true);
  }

  // ─── Incoming lines, one batch per frame ──
  function track(item, node) {
    if (item.id) {
      const list = byId.get(item.id);
      if (list) list.push(node);
      else byId.set(item.id, [node]);
    }
    node._tcId = item.id;
    return node;
  }
  function trim(pane) {
    const extra = pane.list.children.length - 1 - MAX_LINES; // minus the empty-state node
    for (let i = 0; i < extra; i++) {
      const n = pane.list.children[1];
      if (n._tcId) byId.delete(n._tcId);
      n.remove();
    }
  }
  function flush() {
    frame = 0;
    if (!alive || !queue.length) return;
    const batch = queue.splice(0);
    for (const p of panes) {
      const mine = batch.filter((it) => fits(it, p.cfg.cats));
      if (!mine.length) continue;
      const frag = document.createDocumentFragment();
      for (const it of mine.slice(-MAX_LINES)) frag.append(track(it, render(it)));
      p.list.append(frag);
      p.count += mine.length;
      p.empty.classList.add('hidden');
      if (p.atBottom) {
        trim(p);
        p.list.scrollTop = p.list.scrollHeight;
      } else {
        p.pending += mine.length;
        p.paused.textContent = `${p.pending > 99 ? '99+' : p.pending} new messages`;
        if (p.list.children.length > MAX_LINES * 4) trim(p);
      }
    }
    for (const p of panes) if (p.atBottom) p.pending = 0;
  }
  function add(item) {
    items.push(item);
    if (items.length > 600) items.splice(0, items.length - 600);
    queue.push(item);
    if (!frame) frame = requestAnimationFrame(flush);
  }
  function markDeleted({ id, login, all }) {
    for (const it of items) {
      if (it.kind !== 'chat') continue;
      if ((id && it.id === id) || (login && it.user.login === login)) {
        it.deleted = true;
        for (const node of byId.get(it.id) || []) node.replaceWith(track(it, render(it)));
      }
    }
    void all; // a full clear keeps the lines and shows the notice, like Twitch does for mods
  }

  function applyAssets(a) {
    if (!a) return;
    assets = a;
    box.refresh();
    const c = a.counts || {};
    status.textContent = a.channel ? `#${a.channel.login} · 7TV ${c['7tv'] || 0} · BTTV ${c.bttv || 0} · FFZ ${c.ffz || 0} emotes` : 'Connect your Twitch channel in Settings to load emotes and badges';
    build();
  }

  // The OBS dock link, to paste into OBS → Docks → Custom Browser Docks.
  function openDockInfo(anchor) {
    const old = shell.querySelector('.tc-pop.app');
    if (old) return old.remove();
    const pop = el('div', 'tc-pop app');
    pop.style.width = '340px';
    const url = el('input');
    url.type = 'text';
    url.readOnly = true;
    url.value = 'Loading…';
    const copy = el('button', 'tc-btn primary', 'Copy link');
    const renew = el('button', 'tc-btn', 'New link');
    const show = (r) => (url.value = r.url);
    api.action('chatfeed:dock').then(show).catch(() => {});
    copy.addEventListener('click', () => {
      (window.steez?.copy ? window.steez.copy(url.value) : navigator.clipboard.writeText(url.value)).then(() => (copy.textContent = 'Copied ✓'));
    });
    renew.addEventListener('click', () => {
      if (confirm('Make a new dock link? The old link stops working, so you will need to paste the new one into OBS.')) api.action('chatfeed:dock', { renew: true }).then(show);
    });
    const steps = el('div', null);
    steps.style.cssText = 'color:var(--tc-muted);line-height:1.55';
    steps.append('In OBS: ', el('b', null, 'Docks → Custom Browser Docks'), ', type a name (like "Chat"), paste the link as the URL, then Apply. The dock is a window you can snap anywhere in OBS. It uses the same pane layout options and works while Steez is running.');
    const row = el('div', 'row');
    row.append(renew, copy);
    url.addEventListener('focus', () => url.select());
    pop.append(el('div', 'h', 'OBS dock link'), url, row, steps, el('div', 'h', 'Keep this link private: it shows your chat and can use the mod buttons.'));
    const r = anchor.getBoundingClientRect();
    pop.style.top = `${r.bottom + 6}px`;
    pop.style.right = `${Math.max(10, innerWidth - r.right)}px`;
    shell.append(pop);
    const close = (e) => {
      if (!pop.contains(e.target) && !anchor.contains(e.target)) {
        pop.remove();
        document.removeEventListener('pointerdown', close, true);
      }
    };
    document.addEventListener('pointerdown', close, true);
  }

  // ─── Start ──
  const ro = new ResizeObserver(() => {
    if (layout.dir === 'auto' && panesEl.classList.contains('rows') !== stacked()) applyLook();
  });
  ro.observe(panesEl);
  offs.push(() => ro.disconnect());
  build();
  let retry = 0;
  function loadRecent() {
    T.recent()
      .then((r) => {
        if (!alive) return;
        retry = 0;
        // lines that arrived live while the backlog was loading stay, without doubles
        const lastN = (r.items || []).reduce((m, it) => Math.max(m, it.n || 0), 0);
        const live = items.filter((it) => (it.n || 0) > lastN);
        items.length = 0;
        items.push(...(r.items || []), ...live);
        applyAssets(r.assets);
      })
      .catch((e) => {
        if (!alive) return;
        if (e.status === 401) return (status.textContent = e.message);
        status.textContent = dock ? 'Waiting for Steez… open Steez and this dock connects by itself.' : 'Chat is starting…';
        if (dock) setTimeout(loadRecent, Math.min(15000, 2000 * ++retry));
      });
  }
  let wasLost = false;
  offs.push(
    T.listen({
      add,
      del: markDeleted,
      assets: applyAssets,
      lost: () => {
        wasLost = true;
        if (dock && alive) status.textContent = 'Waiting for Steez… open Steez and this dock connects by itself.';
      },
      connected: () => wasLost && loadRecent(), // catch up on what came in while Steez was away
    }),
  );
  loadRecent();

  return () => {
    alive = false;
    cancelAnimationFrame(frame);
    window.removeEventListener('storage', onStorage);
    offs.forEach((f) => f());
    root.replaceChildren();
  };
}
