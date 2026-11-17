// Subathon dashboard inside Steez (vanilla DOM, mounted by SubathonPage.jsx).
// Port of the standalone Subathon Media Player's admin page: timer, media & prices, goals,
// test lab, TV/viewer screens and settings. User data is only ever inserted as text nodes.
import { toast as uiToast } from '../../ui.jsx';
import { api, steezInfo } from '../../lib/bot.js';
import { icon, fmtClock, fmtDur, money, num, eventInfo, timeAgo, chatFragment, connect, remaining } from './smp.js';
import './subathon.css';

const BASE = '/subathon';
const A = (p) => BASE + '/api' + p;

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'hidden') el.hidden = !!v;
    else if (k === 'disabled') el.disabled = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
// DOM append/replace that skips null/false (conditional children), like h() does.
const clean = (kids) => kids.flat(Infinity).filter((k) => k != null && k !== false).map((k) => (k instanceof Node ? k : document.createTextNode(String(k))));
const add = (el, ...kids) => el.append(...clean(kids));
const put = (el, ...kids) => el.replaceChildren(...clean(kids));
const toast = (msg, err = false) => uiToast(msg, { error: err });
const card = (title, ...kids) => h('div', { class: 'card' }, title ? h('h3', {}, title) : null, ...kids);
const btn = (text, onclick, cls = '') => h('button', { class: cls, onclick }, text);
const hint = (...t) => h('div', { class: 'help' }, ...t);
const field = (label, input, help) => h('label', { class: 'field' }, h('span', {}, label), input, help ? hint(help) : null);
const check = (input, ...label) => h('label', { class: 'check' }, input, h('span', {}, ...label));
const copy = (text) => window.steez.copy(text).then(() => toast('Copied!'));
const openUrl = (url) => window.steez.open(url);
/** Runs an async handler; API errors are already toasted by lib/bot.js. */
const safe = (fn) => async (...a) => {
  try {
    return await fn(...a);
  } catch (e) {
    if (e && e.local) toast(e.message, true);
  }
};
const localErr = (msg) => Object.assign(new Error(msg), { local: true });

/** Small Steez modal that asks for one value (Electron has no window.prompt). */
function ask(title, value = '', { type = 'text', okText = 'OK', help } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type, value: value == null ? '' : String(value) });
    const done = (v) => {
      bg.remove();
      resolve(v);
    };
    const bg = h('div', { class: 'modal-bg', onmousedown: (e) => e.target === bg && done(null) },
      h('div', { class: 'modal', style: 'width:min(440px,94vw)' },
        h('h3', {}, title),
        input,
        help ? hint(help) : null,
        h('div', { class: 'row', style: 'margin-top:14px;justify-content:flex-end' }, btn('Cancel', () => done(null)), btn(okText, () => done(input.value), 'primary'))));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value);
      if (e.key === 'Escape') done(null);
    });
    document.body.append(bg);
    input.focus();
    input.select();
  });
}

const TABS = [
  ['dash', 'Dashboard'],
  ['media', 'Media & prices'],
  ['goals', 'Goals'],
  ['test', 'Test lab'],
  ['screens', 'Screens & links'],
  ['settings', 'Settings'],
];
let lastTab = 'dash';

const SWATCHES = [['#d4d4d4', '#8a8a8a'], ['#a970ff', '#00e5ff'], ['#ff4d8d', '#ffb86b'], ['#3ddc97', '#00b4d8'], ['#ff5c5c', '#ffd93d'], ['#4d96ff', '#c77dff'], ['#f72585', '#7209b7']];
const METRICS = { subs: 'Subs', bits: 'Bits', donations: 'Donations', time: 'Hours added', coins: 'TikTok coins', manual: 'Manual' };
const EFFECT_LABELS = { pop: 'Pop', slide: 'Slide in', glow: 'Glow', confetti: 'Confetti', fireworks: 'Fireworks', shockwave: 'Shockwave', coinrain: 'Coin rain', rainbow: 'Rainbow' };
const QUICK = [
  ['sub', 'Prime sub', { type: 'sub', tier: 'prime' }],
  ['sub', 'Tier 1 sub', { type: 'sub', tier: 'tier1' }],
  ['sub', 'Tier 3 sub', { type: 'sub', tier: 'tier3' }],
  ['sub', 'Resub', { type: 'resub', tier: 'tier1' }],
  ['gift', 'Gift 1 sub', { type: 'gift', tier: 'tier1' }],
  ['gift', 'Gift bomb ×5', { type: 'giftbomb', amount: 5 }],
  ['gift', 'Gift bomb ×20', { type: 'giftbomb', amount: 20 }],
  ['bits', '100 bits', { type: 'bits', amount: 100 }],
  ['bits', '500 bits', { type: 'bits', amount: 500 }],
  ['bits', '1,000 bits', { type: 'bits', amount: 1000 }],
  ['money', 'Donate 5', { type: 'donation', amount: 5 }],
  ['money', 'Donate 25', { type: 'donation', amount: 25 }],
];
const STATUS_LABEL = { connected: 'Connected', connecting: 'Connecting…', reconnecting: 'Reconnecting…', error: 'Error', off: 'Off', disconnected: 'Not connected' };
const toneOf = (s) => (s === 'connected' ? 'good' : s === 'error' ? 'bad' : s === 'connecting' || s === 'reconnecting' ? 'warn' : '');

// "2d 4h", "36h", "90m", "12:00:00" or "1:12:00:00" (days:hours:minutes:seconds)
export function parseHMS(v) {
  v = String(v || '').trim().toLowerCase();
  if (!v) return null;
  if (/^[\d.\s]*[a-z]/.test(v)) {
    let total = 0;
    let rest = v;
    let hit = false;
    for (const m of v.matchAll(/(\d+(?:\.\d+)?)\s*(d|h|m|s)[a-z]*/g)) {
      hit = true;
      total += parseFloat(m[1]) * { d: 86400, h: 3600, m: 60, s: 1 }[m[2]];
      rest = rest.replace(m[0], '');
    }
    return hit && !rest.trim() ? Math.round(total) : null;
  }
  const parts = v.split(':').map(Number);
  if (parts.length > 4 || parts.some((n) => isNaN(n))) return null;
  while (parts.length < 4) parts.unshift(0);
  return parts[0] * 86400 + parts[1] * 3600 + parts[2] * 60 + parts[3];
}
const fmtHours = (hours) => {
  const d = Math.floor(hours / 24);
  const h = Math.round((hours - d * 24) * 100) / 100;
  return d ? `${d} ${d === 1 ? 'day' : 'days'}${h ? ` ${h}h` : ''}` : `${h} hours`;
};

export function mountSubathonPage(root) {
  let S = null;
  let conn = null;
  let nowPlaying = null;
  let settingsDirty = false;
  let demoRunning = false;
  let alive = true;
  const timers = [];
  const deferred = new Map(); // element → render fn, for lists the user is typing in

  // ─── Skeleton ──────────────────────────────────────────────
  const headPills = h('div', { class: 'row' });
  const head = h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Subathon'), h('div', { class: 'sub' }, 'Countdown timer, TV screen, wake-up media menu and goals.')),
    headPills);
  const tabBar = h('div', { class: 'tabs' });
  const sections = {};
  for (const [id, label] of TABS) {
    add(tabBar, h('button', { 'data-tab': id, onclick: () => showTab(id) }, label));
    sections[id] = h('section', { class: 'smp-tab', hidden: true });
  }
  put(root, h('div', { class: 'smp' }, head, tabBar, ...Object.values(sections)));

  function showTab(id) {
    lastTab = id;
    for (const [k, el] of Object.entries(sections)) el.hidden = k !== id;
    tabBar.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
  }

  // Lists are rebuilt on every server update, except while the user is typing in them.
  function renderSafe(el, fn) {
    const a = document.activeElement;
    if (el.contains(a) && a.matches('input,select,textarea')) {
      deferred.set(el, fn);
      return;
    }
    fn();
  }
  const onFocusOut = () =>
    setTimeout(() => {
      for (const [el, fn] of [...deferred]) {
        if (!el.contains(document.activeElement)) {
          deferred.delete(el);
          if (alive && S) fn();
        }
      }
    }, 50);
  document.addEventListener('focusout', onFocusOut);

  const cs = () => S.settings.currencySymbol;
  const pfx = () => S.settings.triggerPrefix || '#';
  const channelName = () => S.settings.channel || S.twitchLogin || '';
  const lan = () => S.lanUrls || [];
  const lanOn = () => !!(S.lan && S.lan.running);
  const tvs = () => (S.statuses && S.statuses.tvs) || 0;

  // ═══ DASHBOARD ═════════════════════════════════════════════
  const setupText = h('span', { class: 'grow' });
  const setupBanner = h('div', { class: 'banner warn', hidden: true }, h('b', {}, 'Finish setup:'), setupText, btn('Go to settings', () => showTab('settings'), 'sm'));

  const timerChip = h('span', { class: 'pill' }, 'Paused');
  const bigTimer = h('div', { class: 'smp-timer mono' }, '00:00:00');
  const timerHint = h('div', { class: 'faint small' }, ' ');
  const btnStartPause = h('button', { class: 'primary', onclick: safe(() => api.post(A('/timer'), { action: S.timer.running ? 'pause' : 'start' })) }, 'Start timer');
  const adj = h('div', { class: 'row smp-adj' },
    [[-86400, '−1d'], [-3600, '−1h'], [-600, '−10m'], [-60, '−1m'], [60, '+1m'], [600, '+10m'], [3600, '+1h'], [86400, '+1d']].map(([s, t]) =>
      btn(t, safe(() => api.post(A('/timer'), { action: 'add', seconds: s })), 'sm' + (s > 0 ? ' smp-plus' : ''))));
  const setTime = h('input', { type: 'text', placeholder: 'Set exact time, e.g. 2d 6h, 36h or 12:00:00' });
  const doSet = safe(async () => {
    const secs = parseHMS(setTime.value);
    if (secs == null) throw localErr('Try 2d 6h, 36h, 90m or 12:00:00');
    await api.post(A('/timer'), { action: 'set', seconds: secs });
    setTime.value = '';
    toast('Timer set to ' + fmtClock(secs * 1000).text);
  });
  setTime.addEventListener('keydown', (e) => e.key === 'Enter' && doSet());
  const timerCard = h('div', { class: 'card' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Subathon timer'), timerChip),
    bigTimer, timerHint,
    h('div', { class: 'row', style: 'margin-top:14px' }, btnStartPause, adj),
    h('div', { class: 'row', style: 'margin-top:10px' }, setTime, btn('Set', doSet)));

  const nowBox = h('div', { class: 'smp-now' });
  const tvBtn = (action, text, cls = 'sm') =>
    btn(text, safe(async () => {
      await api.post(A('/tv/control'), { action });
      if (!tvs()) toast('No TV screen is connected right now', true);
      else toast({ skip: 'Skipped', clear: 'Queue cleared', reload: 'TV reloading', 'test-sound': 'Test sound sent to TV' }[action]);
    }), cls);
  const mediaPaused = h('input', {
    type: 'checkbox',
    onchange: safe(async (e) => {
      await api.put(A('/settings'), { mediaPaused: e.target.checked });
      toast(e.target.checked ? 'Viewer media paused' : 'Viewer media on');
    }),
  });
  const tvCard = card('On the TV', nowBox,
    h('div', { class: 'row' }, tvBtn('skip', 'Skip'), tvBtn('clear', 'Clear queue'), tvBtn('test-sound', 'Test sound')),
    h('div', { style: 'margin-top:12px' }, check(mediaPaused, 'Pause viewer-triggered media')),
    hint("When paused, events still count and show alerts, but sounds/videos won't play."));

  const stSubs = h('b', {}, '0'), stBits = h('b', {}, '0'), stMoney = h('b', {}, '$0'), stTime = h('b', {}, '0m');
  const statTile = (ic, val, label, key) =>
    h('div', {
      class: 'stat smp-stat' + (key ? ' click' : ''),
      title: key ? 'Click to correct this counter' : null,
      onclick: key
        ? safe(async () => {
            const v = await ask('Set total ' + key, S.stats[key], { type: 'number', help: 'This only changes the counter, not the timer — e.g. for subs that came in while Steez was closed.' });
            if (v == null || v === '' || isNaN(Number(v))) return;
            await api.put(A('/stats'), { [key]: Number(v) });
          })
        : null,
    }, icon(ic, 'smp-ico smp-k-' + ic), h('div', {}, val, h('span', {}, label)));
  const statsRow = h('div', { class: 'smp-stats' },
    statTile('sub', stSubs, 'Subs', 'subs'), statTile('bits', stBits, 'Bits', 'bits'),
    statTile('money', stMoney, 'Donations', 'donations'), statTile('clock', stTime, 'Time added'));

  const soundboard = h('div', { class: 'smp-soundboard' });
  const feedList = h('div', { class: 'smp-feed' });
  const chatChan = h('span', { class: 'faint small' });
  const chatBox = h('div', { class: 'chatlog smp-chat' });
  const dashScreens = h('div');

  add(sections.dash, 
    setupBanner,
    h('div', { class: 'grid2' }, timerCard, tvCard),
    statsRow,
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Soundboard'), btn('Manage media →', () => showTab('media'), 'sm ghost')), soundboard),
      h('div', { class: 'card' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Live activity'), btn('Clear', safe(() => api.post(A('/feed/clear'))), 'sm')), feedList)),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Screens & links'), btn('All screen options →', () => showTab('screens'), 'sm ghost')), dashScreens),
      h('div', { class: 'card' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Chat'), chatChan), chatBox)));

  function renderBanner() {
    const todo = [];
    if (!channelName()) todo.push('connect Twitch or set your channel');
    if (S.settings.donation.provider === 'none') todo.push('connect a donation service (optional)');
    if (!S.media.length) todo.push('upload your sounds/videos');
    setupBanner.hidden = !!(channelName() && S.media.length);
    setupText.textContent = todo.join(' · ');
  }

  function renderTimer() {
    if (!S) return;
    const t = S.timer;
    const rem = remaining(t, conn);
    bigTimer.textContent = fmtClock(rem).text;
    timerChip.textContent = t.ended ? 'Ended' : t.running ? 'Running' : 'Paused';
    timerChip.className = 'pill ' + (t.ended ? 'bad' : t.running ? 'good' : '');
    btnStartPause.textContent = t.running ? 'Pause timer' : t.ended ? 'Timer ended' : 'Start timer';
    btnStartPause.disabled = !t.running && rem <= 0;
    const fmtD = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    let hintText = '';
    if (t.running) hintText = 'Ends ' + fmtD((conn ? conn.now() : Date.now()) + rem);
    if (t.startedAt) hintText += (hintText ? ' · ' : '') + 'started ' + fmtD(t.startedAt);
    timerHint.textContent = hintText || 'Press start when you go live. Time added while paused is kept.';
  }

  function renderStats() {
    const st = S.stats;
    stSubs.textContent = num(st.subs);
    stBits.textContent = num(st.bits);
    stMoney.textContent = money(st.donations, cs());
    stTime.textContent = fmtDur(st.timeAdded || 0);
  }

  function renderStatus() {
    const st = S.statuses || {};
    const tw = st.twitch || {}, dn = st.donations || {};
    put(headPills, 
      h('span', { class: 'pill ' + toneOf(tw.status), title: tw.detail || '' }, 'Twitch chat'),
      h('span', { class: 'pill ' + (dn.status === 'off' ? '' : toneOf(dn.status)), title: dn.detail || '' }, 'Donations'),
      h('span', { class: 'pill ' + (tvs() > 0 ? 'good' : '') }, tvs() > 0 ? tvs() + ' TV screen' + (tvs() > 1 ? 's' : '') + ' on' : 'No TV connected'),
      shortLink() ? btn('Copy viewer link', copyViewerLink, 'sm primary') : null,
      lanOn() && S.tvCode && lan()[0] ? btn('Open TV screen ↗', () => openUrl(lan()[0] + '/tv/' + S.tvCode), 'sm') : null,
      lanOn() && lan()[0] ? btn('Open viewer page ↗', () => openUrl(lan()[0] + '/'), 'sm') : null);
    tvCount2.textContent = tvs();
    const rows = [
      ['Twitch chat', tw, channelName() ? '#' + channelName() : 'No channel set'],
      ['Donations', dn, S.settings.donation.provider === 'none' ? 'Not set up' : S.settings.donation.provider],
      ['TV & viewer server', { status: lanOn() ? 'connected' : S.lan?.error ? 'error' : 'off', detail: S.lan?.error }, lanOn() ? 'Port ' + S.lan.port : 'Turned off'],
      ['TV screens', { status: tvs() > 0 ? 'connected' : 'off' }, tvs() + ' connected'],
    ];
    put(connList, ...rows.map(([name, s, extra]) =>
      h('div', { class: 'row smp-conn' },
        h('span', { class: 'pill ' + (s.status === 'off' ? '' : toneOf(s.status)) }, STATUS_LABEL[s.status] || s.status || 'Off'),
        h('b', {}, name),
        h('span', { class: 'faint small grow' }, s.detail && s.status !== 'connected' ? s.detail : extra))));
  }

  function renderNowPlaying() {
    if (nowPlaying && nowPlaying.item) {
      put(nowBox, 
        h('div', { class: 'smp-eq' }, h('i'), h('i'), h('i')),
        h('div', {}, h('b', {}, nowPlaying.item.name),
          h('div', { class: 'faint small' }, (nowPlaying.item.by ? 'from ' + nowPlaying.item.by : '') + (nowPlaying.queue ? ' · ' + nowPlaying.queue + ' in queue' : ''))));
    } else put(nowBox, h('div', { class: 'faint' }, 'Nothing playing'));
  }

  function renderFeed() {
    if (!S.feed.length) return put(feedList, h('div', { class: 'empty' }, 'No activity yet. Try the Test lab!'));
    put(feedList, ...S.feed.slice(0, 50).map((f) => {
      const info = eventInfo(f, cs());
      const meta = [timeAgo(f.ts)];
      if (f.media && f.media.length) meta.push('▶ ' + f.media.join(', '));
      if (f.message) meta.push('“' + f.message + '”');
      return h('div', { class: 'smp-fl k-' + info.kind },
        icon(info.icon, 'smp-ico'),
        h('div', { class: 'grow' },
          h('div', {}, h('b', {}, info.title), ' ' + info.action, f.test ? h('span', { class: 'tag smp-test' }, 'TEST') : null),
          h('div', { class: 'faint small nowrap-text' }, meta.join(' · '))),
        f.added > 0 ? h('div', { class: 'smp-add mono' }, '+' + fmtDur(f.added)) : null);
    }));
  }

  function chatLine(c) {
    return h('div', { class: 'm' },
      h('span', { class: 'u', style: c.color ? 'color:' + c.color : '' }, c.user),
      c.action ? ' ' : ': ',
      h('span', { style: c.action && c.color ? 'color:' + c.color : '' }, chatFragment(c.text || '', c.emotes)));
  }
  function renderChat() {
    chatChan.textContent = channelName() ? '#' + channelName() : '';
    if (!S.chat.length) put(chatBox, h('div', { class: 'faint smp-chat-empty' }, channelName() ? 'Waiting for chat messages…' : 'Connect Twitch or set your channel in Settings'));
    else put(chatBox, ...S.chat.map(chatLine));
    chatBox.scrollTop = chatBox.scrollHeight;
  }
  function addChat(c) {
    chatBox.querySelector('.smp-chat-empty')?.remove();
    const stick = chatBox.scrollTop + chatBox.clientHeight >= chatBox.scrollHeight - 30;
    add(chatBox, chatLine(c));
    while (chatBox.children.length > 80) chatBox.firstChild.remove();
    if (stick) chatBox.scrollTop = chatBox.scrollHeight;
  }
  function clearChat(c) {
    for (let i = S.chat.length - 1; i >= 0; i--) {
      const m = S.chat[i];
      if ((c.id && m.id === c.id) || (c.user && String(m.user).toLowerCase() === String(c.user).toLowerCase()) || (!c.id && !c.user)) S.chat.splice(i, 1);
    }
    renderChat();
  }

  function priceText(m) {
    const p = m.prices || {}, out = [];
    if (p.bits) out.push(num(p.bits) + ' bits');
    if (p.subs) out.push(p.subs + ' sub' + (p.subs > 1 ? 's' : ''));
    if (p.donation) out.push(money(p.donation, cs()));
    return out.join(' · ');
  }
  const playOnTv = safe(async (m) => {
    await api.post(A('/media/' + m.id + '/play'));
    toast(tvs() ? '▶ ' + m.name : 'Sent — but no TV screen is connected', !tvs());
  });
  function renderSoundboard() {
    if (!S.media.length) return put(soundboard, h('div', { class: 'empty', style: 'grid-column:1/-1;cursor:pointer', onclick: () => showTab('media') }, 'Upload your first sound or video →'));
    put(soundboard, ...S.media.map((m) =>
      h('button', { class: 'smp-sb' + (m.enabled === false ? ' off' : ''), title: 'Play on TV', onclick: () => playOnTv(m) },
        icon(m.type, 'smp-ico'), h('b', { class: 'nowrap-text' }, m.name), h('small', { class: 'faint' }, priceText(m) || 'No price'))));
  }

  // Link rows
  const shortLink = () => (S.hosted && S.hosted.link) || '';
  const copyViewerLink = () =>
    window.steez.copy(shortLink()).then(() =>
      toast(lanOn() ? 'Viewer link copied. Paste it in chat or your Twitch panels.' : 'Viewer link copied. It shows a waiting screen until the TV & viewer server is on.'));
  function linkRow(url) {
    const input = h('input', { type: 'text', readonly: true, value: url, onfocus: (e) => e.target.select() });
    return h('div', { class: 'row smp-link' }, input, btn('Copy', () => copy(url), 'sm'), btn('Open', () => openUrl(url), 'sm'));
  }
  const enableLanBtn = () => btn('Turn on TV & viewer server', safe(() => setLan({ enabled: true })), 'primary');

  function renderDashScreens() {
    if (!lanOn()) {
      put(dashScreens, 
        h('p', { class: 'muted', style: 'margin-top:0' }, S.lan?.error ? 'The TV & viewer server could not start: ' + S.lan.error : 'The TV screen and the viewer page are served on your home network. Turn the server on to get their links.'),
        enableLanBtn());
      return;
    }
    const pub = S.settings.publicUrl;
    put(dashScreens, 
      h('div', { class: 'row', style: 'margin-bottom:6px' }, h('b', {}, 'TV screen'), h('span', { class: 'tag' }, S.tvCode)),
      hint('On your TV open the Internet app and go to this address (TV and computer on the same Wi-Fi):'),
      ...lan().slice(0, 2).map((u) => linkRow(u + '/tv/' + S.tvCode)),
      h('div', { class: 'divider' }),
      h('b', {}, 'Viewer page'),
      hint('Share this with your viewers (Twitch panels / a chat command).'),
      shortLink() ? linkRow(shortLink()) : null,
      !shortLink() && pub ? linkRow(pub + '/') : null,
      ...(shortLink() ? [] : lan().slice(0, pub ? 1 : 2).map((u) => linkRow(u + '/'))),
      !pub && !shortLink() ? hint('LAN links only work on your home Wi-Fi. Add a short viewer link on Screens & links to share it with viewers.') : null);
  }

  // ═══ MEDIA ═════════════════════════════════════════════════
  const fileInput = h('input', { type: 'file', multiple: true, accept: 'audio/*,video/*,image/*', hidden: true });
  const dropzone = h('label', { class: 'smp-drop' }, fileInput, icon('audio', 'smp-ico smp-drop-ico'),
    h('div', {}, h('b', {}, 'Drop files here or click to upload'), hint('MP3, WAV, OGG, MP4, WEBM, GIF, PNG… up to 500 MB each')));
  const uploads = h('div', { class: 'smp-uploads' });
  const howText = h('p', { class: 'muted', style: 'margin:0' });
  const mediaList = h('div', { class: 'smp-media-list' });
  // TikTok gifts → media
  const tkStatus = h('div', { class: 'row', style: 'margin-bottom:10px' });
  const tkRules = h('div', { class: 'smp-tk-rules' });
  const tkList = h('datalist', { id: 'smp-tk-gifts' });
  let tkSaveT = null;
  const saveRules = () => {
    clearTimeout(tkSaveT);
    tkSaveT = setTimeout(safe(async () => {
      const r = await api.put(A('/tiktok-rules'), { rules: S.tiktokRules });
      S.tiktokRules = r.rules;
      toast('TikTok gifts saved');
    }), 400);
  };
  const giftInfo = (name) => (S.tiktokCatalog || []).find((g) => g.name.toLowerCase() === String(name || '').trim().toLowerCase()) || {};
  const giftImg = (src) => (src ? h('img', { src, alt: '', class: 'smp-gift-img', referrerpolicy: 'no-referrer' }) : h('span', { class: 'smp-gift-img smp-gift-ph' }, icon('tiktok', 'smp-ico')));
  const rulesFor = (m) => (S.tiktokRules || []).filter((r) => r.mediaId === m.id && r.enabled !== false);
  const tkCard = card('TikTok gifts',
    h('p', { class: 'muted', style: 'margin-top:0' }, 'Pick which TikTok gift plays which sound. Gifts also add time (Settings → Time rules → per 100 TikTok coins) plus any extra time you set here. A combo (one gift tapped many times) counts once with its size; “Min.” is how many of that gift are needed in one go.'),
    tkStatus, tkRules, tkList,
    h('div', { class: 'row', style: 'margin-top:10px' },
      btn('+ Add gift', () => {
        S.tiktokRules.push({ id: '', gift: 'Rose', minCount: 1, mediaId: (S.media[0] || {}).id || '', addSeconds: 0, enabled: true });
        saveRules();
        renderTiktok();
      }, 'primary'),
      hint('The overlay and viewer page show these automatically.')));
  function renderTiktok() {
    const st = S.tiktokStatus || {};
    const live = st.status === 'live';
    put(tkStatus,
      h('span', { class: 'pill ' + (live ? 'good' : st.status && st.status !== 'off' ? 'warn' : '') }, live ? 'Watching @' + st.username : st.username ? '@' + st.username + ' · ' + st.status : 'TikTok not connected'),
      h('span', { class: 'faint small grow' }, live ? 'Gifts on your TikTok LIVE trigger the sounds below.' : 'Connect your TikTok username on the TikTok Gifts page — the same connection feeds the subathon.'),
      btn('Open TikTok Gifts', () => (location.hash = 'gifts'), 'sm'));
    put(tkList, ...(S.tiktokCatalog || []).map((g) => h('option', { value: g.name }, g.name + ' · ' + num(g.coins) + ' coin' + (g.coins === 1 ? '' : 's'))));
    if (!(S.tiktokRules || []).length) return put(tkRules, h('div', { class: 'empty' }, 'No TikTok gifts set up yet. Add one — e.g. a Rose plays the air horn.'));
    put(tkRules,
      h('div', { class: 'smp-tk-row smp-tk-head' }, ...['', 'Gift', 'Min.', 'Plays', 'Extra time (min)', '', ''].map((t) => h('span', { class: 'faint small' }, t))),
      ...S.tiktokRules.map(ruleRow));
  }
  function ruleRow(r) {
    const info = giftInfo(r.gift);
    const coinsEach = r.coins || info.coins;
    const gift = h('input', { type: 'text', value: r.gift, list: 'smp-tk-gifts', placeholder: 'Gift name, e.g. Rose' });
    const minCount = h('input', { type: 'number', min: 1, step: 1, value: r.minCount || 1 });
    const media = h('select', {}, h('option', { value: '' }, '— no sound (time only) —'), ...S.media.map((m) => h('option', { value: m.id }, m.name)));
    media.value = r.mediaId || '';
    const extra = h('input', { type: 'number', min: 0, step: 'any', value: r.addSeconds ? +(r.addSeconds / 60).toFixed(2) : '', placeholder: '0' });
    const en = h('input', { type: 'checkbox', checked: r.enabled !== false });
    const upd = () => {
      r.gift = gift.value.trim();
      const g = giftInfo(r.gift);
      r.image = g.image || '';
      r.giftId = g.giftId || '';
      r.coins = g.coins || 0;
      r.minCount = Math.max(1, Math.round(Number(minCount.value) || 1));
      r.mediaId = media.value;
      r.addSeconds = Math.round(Number(extra.value || 0) * 60);
      r.enabled = en.checked;
      saveRules();
    };
    [gift, minCount, media, extra, en].forEach((el) => el.addEventListener('change', upd));
    return h('div', { class: 'smp-tk-row' + (r.enabled === false ? ' disabled' : '') },
      giftImg(r.image || info.image),
      h('div', { class: 'smp-tk-gift' }, gift, h('span', { class: 'faint small' }, coinsEach ? num(coinsEach) + ' coin' + (coinsEach === 1 ? '' : 's') + ' each' : 'coin value unknown until seen')),
      minCount, media, extra,
      h('div', { class: 'row nowrap' }, check(en, 'On'), btn('Test', () => fire({ type: 'tiktok', gift: r.gift, amount: r.minCount || 1 }), 'sm')),
      btn('✕', () => {
        S.tiktokRules = S.tiktokRules.filter((x) => x !== r);
        saveRules();
        renderTiktok();
      }, 'sm danger'));
  }
  add(sections.media, dropzone, uploads, card('How triggers work', howText), tkCard, mediaList);

  async function uploadFile(file, url) {
    const bar = h('i', { style: 'width:0%' });
    const pct = h('span', { class: 'mono small' }, '0%');
    const row = h('div', { class: 'row smp-up' }, h('span', { class: 'grow nowrap-text' }, file.name), h('div', { class: 'bar smp-up-bar' }, bar), pct);
    add(uploads, row);
    const { apiKey } = await steezInfo();
    const fd = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url || A('/media'));
    xhr.setRequestHeader('x-steez-key', apiKey);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const p = Math.round((e.loaded / e.total) * 100);
      bar.style.width = p + '%';
      pct.textContent = p + '%';
    };
    xhr.onload = () => {
      let d = {};
      try {
        d = JSON.parse(xhr.responseText);
      } catch {
        /* not json */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        toast('Uploaded ' + file.name);
        row.remove();
      } else {
        toast(d.error || 'Upload failed', true);
        pct.textContent = 'Failed';
        setTimeout(() => row.remove(), 4000);
      }
    };
    xhr.onerror = () => {
      toast('Upload failed', true);
      row.remove();
    };
    xhr.send(fd);
  }
  fileInput.addEventListener('change', (e) => {
    [...e.target.files].forEach((f) => uploadFile(f));
    e.target.value = '';
  });
  ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('over'); }));
  dropzone.addEventListener('drop', (e) => [...e.dataTransfer.files].forEach((f) => uploadFile(f)));

  function renderHow() {
    put(howText, 
      'Give each item a price in bits, gifted subs and/or donations (leave blank to skip). ',
      h('b', {}, 'With a trigger code: '), `a viewer includes ${pfx()}code in their cheer, resub or donation message and pays at least the price. `,
      h('b', {}, 'Without a code: '),
      S.settings.matchMode === 'tier' ? 'the most expensive item their amount covers plays.' : `the item whose price matches the amount exactly plays (e.g. exactly 500 bits, or exactly ${cs()}5).`,
      ' Gift bombs use the number of subs gifted.');
  }

  function renderMedia() {
    if (!S.media.length) return put(mediaList, h('div', { class: 'empty' }, 'Nothing uploaded yet. Your sounds, videos and images will show up here.'));
    put(mediaList, ...S.media.map(mediaCard));
  }

  function mediaCard(m, idx) {
    const url = BASE + '/media/' + encodeURIComponent(m.file);
    const preview =
      m.type === 'image' ? h('img', { src: url, alt: '' })
      : m.type === 'video' ? h('video', { src: url, controls: true, preload: 'metadata' })
      : h('div', { class: 'smp-audio' }, icon('audio', 'smp-ico'), h('audio', { src: url, controls: true, preload: 'none' }));
    const p = m.prices || {};
    const val = (v) => (v != null ? v : '');
    const f = {
      name: h('input', { type: 'text', value: m.name, placeholder: 'Name', class: 'smp-mc-name' }),
      enabled: h('input', { type: 'checkbox', checked: m.enabled !== false }),
      code: h('input', { type: 'text', value: val(m.code), placeholder: 'optional' }),
      description: h('input', { type: 'text', value: val(m.description), placeholder: 'e.g. Air horn at full blast' }),
      volume: h('input', { type: 'range', min: 0, max: 100, value: m.volume != null ? m.volume : 100 }),
      effect: h('select', {}, [['none', 'None'], ['flash', 'Screen flash'], ['shake', 'Screen shake'], ['both', 'Flash + shake']].map(([v, t]) => h('option', { value: v }, t))),
      duration: h('input', { type: 'number', min: 1, max: 600, value: val(m.duration) }),
      maxSeconds: h('input', { type: 'number', min: 0, max: 3600, value: m.maxSeconds ? m.maxSeconds : '', placeholder: 'full' }),
      showOnViewer: h('input', { type: 'checkbox', checked: m.showOnViewer !== false }),
    };
    f.effect.value = m.effect || 'none';
    const prices = {
      bits: h('input', { type: 'number', min: 0, step: 1, value: val(p.bits), placeholder: '—' }),
      subs: h('input', { type: 'number', min: 0, step: 1, value: val(p.subs), placeholder: '—' }),
      donation: h('input', { type: 'number', min: 0, step: 0.01, value: val(p.donation), placeholder: '—' }),
    };
    const volOut = h('b', {}, f.volume.value + '%');
    f.volume.addEventListener('input', () => (volOut.textContent = f.volume.value + '%'));
    const summary = h('div', { class: 'row smp-summary' });
    const node = h('div', { class: 'card smp-mc' + (m.enabled === false ? ' disabled' : '') });
    const drawSummary = () => {
      const pp = m.prices || {};
      put(summary, 
        pp.bits ? h('span', { class: 'tag smp-k-bits' }, num(pp.bits) + ' bits') : null,
        pp.subs ? h('span', { class: 'tag smp-k-gift' }, pp.subs + ' gifted sub' + (pp.subs > 1 ? 's' : '')) : null,
        pp.donation ? h('span', { class: 'tag smp-k-money' }, money(pp.donation, cs())) : null,
        m.code ? h('span', { class: 'tag' }, pfx() + m.code) : null,
        ...rulesFor(m).map((r) => h('span', { class: 'tag smp-tk-tag' }, giftImg(r.image || giftInfo(r.gift).image), (r.minCount > 1 ? r.minCount + '× ' : '') + r.gift)),
        !pp.bits && !pp.subs && !pp.donation && !rulesFor(m).length ? h('span', { class: 'smp-warn' }, '⚠ No price or TikTok gift set — viewers can’t trigger this (you can still play it from the soundboard).') : null,
        m.enabled === false ? h('span', { class: 'smp-warn' }, 'Disabled') : null);
    };
    drawSummary();

    let t = null;
    const save = () => {
      clearTimeout(t);
      t = setTimeout(safe(async () => {
        const body = { prices: {} };
        for (const [k, el] of Object.entries(f)) body[k] = el.type === 'checkbox' ? el.checked : el.value;
        for (const [k, el] of Object.entries(prices)) body.prices[k] = el.value;
        const r = await api.put(A('/media/' + m.id), body);
        Object.assign(m, r.item);
        node.classList.toggle('disabled', m.enabled === false);
        drawSummary();
        toast('Saved “' + m.name + '”');
      }), 500);
    };
    [...Object.values(f), ...Object.values(prices)].forEach((el) => el.addEventListener('change', save));

    const move = (dir) => safe(async () => {
      const ids = S.media.map((x) => x.id);
      const j = idx + dir;
      if (j < 0 || j >= ids.length) return;
      [ids[idx], ids[j]] = [ids[j], ids[idx]];
      await api.post(A('/media/reorder'), { ids });
    });
    const replace = h('input', { type: 'file', accept: 'audio/*,video/*,image/*', hidden: true, onchange: (e) => e.target.files[0] && uploadFile(e.target.files[0], A('/media/' + m.id + '/file')) });

    add(node, 
      h('div', { class: 'smp-mc-prev' }, preview),
      h('div', { class: 'smp-mc-body' },
        h('div', { class: 'row nowrap' }, h('span', { class: 'tag' }, m.type), f.name, check(f.enabled, 'Enabled')),
        h('div', { class: 'smp-grid4' },
          field('Bits', prices.bits),
          field('Gifted subs', prices.subs),
          field('Donation (' + cs() + ')', prices.donation),
          h('label', { class: 'field' }, h('span', {}, 'Trigger code'), h('div', { class: 'smp-prefixed' }, h('em', {}, pfx()), f.code))),
        field('Description for viewers', f.description),
        h('div', { class: 'smp-grid4' },
          h('label', { class: 'field' }, h('span', {}, 'Volume ', volOut), f.volume),
          field('Effect', f.effect),
          m.type === 'image' ? field('Show for (sec)', f.duration) : field('Stop after (sec)', f.maxSeconds)),
        summary,
        h('div', { class: 'row', style: 'margin-top:10px' },
          btn('▶ Play on TV', () => playOnTv(m), 'sm primary'),
          check(f.showOnViewer, 'On viewer page'),
          h('div', { class: 'grow' }),
          btn('↑', move(-1), 'sm'),
          btn('↓', move(1), 'sm'),
          h('label', { class: 'btn sm' }, 'Replace file', replace),
          btn('Delete', safe(async () => {
            if (!confirm('Delete “' + m.name + '”? This removes the file too.')) return;
            await api.del(A('/media/' + m.id));
            toast('Deleted');
          }), 'sm danger'))));
    return node;
  }

  // ═══ GOALS ═════════════════════════════════════════════════
  const goalList = h('div', { class: 'smp-goals' });
  add(sections.goals, 
    h('div', { class: 'row', style: 'margin-bottom:14px' },
      h('div', { class: 'grow muted' }, 'Shown on the TV and the viewer page. Progress updates automatically.'),
      btn('+ Add goal', safe(async () => {
        await api.post(A('/goals'), { title: 'New goal', metric: 'subs', target: 25 });
        setTimeout(() => {
          const last = goalList.lastElementChild;
          if (last) {
            last.scrollIntoView({ behavior: 'smooth', block: 'center' });
            last.querySelector('input')?.select();
          }
        }, 300);
      }), 'primary')),
    goalList);

  function goalNum(g) {
    if (g.metric === 'donations') return money(g.current, cs()) + ' / ' + money(g.target, cs());
    if (g.metric === 'time') return g.current + 'h / ' + g.target + 'h';
    return num(g.current) + ' / ' + num(g.target);
  }
  const goalPct = (g) => (g.target > 0 ? Math.min(100, (g.current / g.target) * 100) : 0);
  function renderGoals() {
    if (!S.goals.length) return put(goalList, h('div', { class: 'empty' }, 'No goals yet. Add things like “50 subs: spicy noodle challenge”.'));
    const move = (idx, dir) => safe(async () => {
      const ids = S.goals.map((x) => x.id);
      const j = idx + dir;
      if (j < 0 || j >= ids.length) return;
      [ids[idx], ids[j]] = [ids[j], ids[idx]];
      await api.post(A('/goals/reorder'), { ids });
    });
    put(goalList, ...S.goals.map((g, idx) => {
      const sel = h('select', {}, Object.keys(METRICS).map((k) => h('option', { value: k }, METRICS[k])));
      sel.value = g.metric;
      const title = h('input', { type: 'text', value: g.title, placeholder: 'Goal title' });
      const target = h('input', { type: 'number', min: 0, step: 'any', value: g.target });
      const prog = h('input', { type: 'number', min: 0, step: 'any', value: g.progress || 0 });
      const progField = field('Progress', prog);
      progField.hidden = g.metric !== 'manual';
      const desc = h('input', { type: 'text', value: g.description || '', placeholder: 'What happens when it’s reached (shown to viewers)' });
      const done = h('input', { type: 'checkbox', checked: !!g.done });
      const save = safe(async () => {
        await api.put(A('/goals/' + g.id), { title: title.value, metric: sel.value, target: target.value, progress: prog.value, description: desc.value, done: done.checked });
        toast('Goal saved');
      });
      [title, sel, target, prog, desc, done].forEach((el) => el.addEventListener('change', save));
      sel.addEventListener('change', () => (progField.hidden = sel.value !== 'manual'));
      return h('div', { class: 'card smp-goal' + (g.done || g.current >= g.target ? ' done' : ''), 'data-goal': g.id },
        h('div', { class: 'smp-goal-fields' }, field('Title', title), field('Counts', sel), field('Target', target), progField,
          h('div', { class: 'row smp-goal-actions' }, btn('↑', move(idx, -1), 'sm'), btn('↓', move(idx, 1), 'sm'),
            btn('Delete', safe(async () => {
              if (confirm('Delete this goal?')) await api.del(A('/goals/' + g.id));
            }), 'sm danger'))),
        field('Reward / description', desc),
        h('div', { class: 'row nowrap' }, h('div', { class: 'bar grow smp-goal-bar' }, h('i', { style: 'width:' + goalPct(g) + '%' })),
          h('span', { class: 'mono small smp-goal-num' }, goalNum(g)), check(done, 'Mark done')));
    }));
  }
  function renderGoalBars() {
    for (const g of S.goals) {
      const c = goalList.querySelector('[data-goal="' + CSS.escape(g.id) + '"]');
      if (!c) continue;
      c.querySelector('.smp-goal-bar > i').style.width = goalPct(g) + '%';
      c.querySelector('.smp-goal-num').textContent = goalNum(g);
      c.classList.toggle('done', !!(g.done || g.current >= g.target));
    }
  }

  // ═══ TEST LAB ══════════════════════════════════════════════
  const tUser = h('input', { type: 'text', value: 'TestViewer' });
  const tMsg = h('input', { type: 'text', placeholder: 'e.g. wake up! #horn' });
  const tReal = h('input', { type: 'checkbox' });
  const tType = h('select', {}, [['sub', 'Sub'], ['resub', 'Resub'], ['gift', 'Gift sub'], ['giftbomb', 'Gift bomb'], ['bits', 'Bits'], ['donation', 'Donation']].map(([v, t]) => h('option', { value: v }, t)));
  const tAmount = h('input', { type: 'number', value: 100, min: 0, step: 'any' });
  const tTier = h('select', {}, [['tier1', 'Tier 1'], ['tier2', 'Tier 2'], ['tier3', 'Tier 3'], ['prime', 'Prime']].map(([v, t]) => h('option', { value: v }, t)));
  const quickGrid = h('div', { class: 'smp-quick' });
  const tkGift = h('input', { type: 'text', value: 'Rose', list: 'smp-tk-gifts' });
  const tkCount = h('input', { type: 'number', value: 5, min: 1, step: 1 });
  const tvCount2 = h('b', {}, '0');
  const connList = h('div', { class: 'stack' });
  const mCur = h('select', {}, [['bits', 'Bits'], ['subs', 'Gifted subs'], ['donation', 'Donation']].map(([v, t]) => h('option', { value: v }, t)));
  const mAmount = h('input', { type: 'number', value: 500, min: 0, step: 'any' });
  const mMsg = h('input', { type: 'text', placeholder: '#horn' });
  const matchOut = h('div', { class: 'row', style: 'margin-top:10px' });
  const priceFire = h('div', { class: 'stack' });
  const btnDemo = h('button', { class: 'primary' }, '▶ Run demo');

  async function fireRaw(ev) {
    const body = { user: tUser.value, message: tMsg.value, real: tReal.checked, tier: 'tier1', ...ev };
    if (body.type === 'bits' && body.message.indexOf('Cheer') < 0) body.message = ('Cheer' + body.amount + ' ' + body.message).trim();
    await api.post(A('/test'), body);
  }
  const fire = safe(async (ev) => {
    await fireRaw(ev);
    toast('Test event sent' + (tReal.checked ? ' (counted for real)' : ''));
  });
  for (const [ic, label, ev] of QUICK) {
    const b = h('button', { class: 'smp-qb smp-k-' + ic, onclick: () => fire(ev) }, icon(ic, 'smp-ico'), h('em', {}, label));
    if (ev.type === 'donation') b.dataset.money = ev.amount;
    add(quickGrid, b);
  }
  const runCheck = safe(async () => {
    const r = await api.post(A('/test-match'), { currency: mCur.value, amount: mAmount.value, message: mMsg.value });
    if (!r.matched.length) put(matchOut, h('span', { class: 'faint' }, 'Nothing would play for this event (it still counts).'));
    else put(matchOut, h('span', { class: 'faint' }, 'Would play:'), ...r.matched.map((m) => h('span', { class: 'tag' }, '▶ ' + m.name)));
  });
  btnDemo.addEventListener('click', safe(async () => {
    if (demoRunning) return;
    demoRunning = true;
    btnDemo.disabled = true;
    btnDemo.textContent = 'Demo running…';
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const real = tReal.checked;
    tReal.checked = false;
    const pick = (cur) => S.media.find((m) => m.enabled !== false && m.prices && m.prices[cur]);
    const send = (ev) => api.post(A('/test'), { real: false, tier: 'tier1', message: '', ...ev });
    const chat = (user, text) => api.post(A('/test-chat'), { user, text });
    const code = (m) => (m && m.code ? pfx() + m.code : '');
    try {
      await chat('NightOwl', 'is the subathon starting??');
      await wait(1200); await chat('CoffeeGoblin', 'LETS GOOO');
      await wait(1500); await send({ type: 'sub', user: 'NightOwl', tier: 'tier1', message: 'Happy subathon!' });
      await wait(3500); await chat('SleepyPanda', 'he looks so tired lol');
      const b = pick('bits');
      const bits = b ? b.prices.bits : 500;
      await wait(1200); await send({ type: 'bits', user: 'SleepyPanda', amount: bits, message: 'Cheer' + bits + ' WAKE UP ' + code(b) });
      await wait(4500); await send({ type: 'giftbomb', user: 'xXGamerXx', amount: (pick('subs') || { prices: { subs: 5 } }).prices.subs });
      await wait(4500); await chat('ModSquad', 'chat is going crazy');
      const d = pick('donation');
      await wait(1200); await send({ type: 'donation', user: 'pixelpirate', amount: d ? d.prices.donation : 10, message: 'stay strong! ' + code(d) });
      toast('Demo finished');
    } finally {
      tReal.checked = real;
      demoRunning = false;
      if (alive) {
        btnDemo.disabled = false;
        btnDemo.textContent = '▶ Run demo';
      }
    }
  }));

  add(sections.test, 
    h('p', { class: 'muted', style: 'margin-top:0' }, 'Fire fake events and check the TV before you go live. Test events are marked as tests.'),
    h('div', { class: 'grid2' },
      card('Simulate events',
        h('div', { class: 'grid2 smp-tight' }, field('Viewer name', tUser), field('Message (put trigger codes here)', tMsg)),
        check(tReal, 'Count for real (stats, and time if that is on)'),
        quickGrid,
        h('div', { class: 'divider' }),
        h('h3', {}, 'Custom event'),
        h('div', { class: 'row smp-custom' }, field('Type', tType), field('Amount', tAmount), field('Tier', tTier),
          btn('Fire event', () => fire({ type: tType.value, amount: Number(tAmount.value), tier: tTier.value }), 'primary')),
        h('div', { class: 'divider' }),
        h('h3', {}, 'TikTok gift'),
        h('div', { class: 'row smp-custom' }, h('div', { class: 'grow' }, field('Gift', tkGift)), field('How many', tkCount),
          btn('Send gift', () => fire({ type: 'tiktok', gift: tkGift.value, amount: Number(tkCount.value) || 1 }), 'primary'))),
      card('TV checks',
        h('p', { class: 'muted', style: 'margin-top:0' }, 'TVs connected: ', tvCount2),
        h('div', { class: 'row' },
          tvBtn('test-sound', 'Test sound', ''),
          btn('Test chat message', safe(async () => {
            const text = await ask('Chat message to show on the TV', 'Hello from the test lab! Kappa');
            if (text == null) return;
            await api.post(A('/test-chat'), { text: text === 'Hello from the test lab! Kappa' ? '' : text });
          })),
          tvBtn('skip', 'Skip media', ''),
          tvBtn('clear', 'Clear queue', ''),
          tvBtn('reload', 'Reload TV', '')),
        hint('After “Reload TV” you need to press OK on the TV remote once to re-enable sound.'),
        h('div', { class: 'divider' }),
        h('h3', {}, 'Full demo'),
        h('p', { class: 'muted', style: 'margin-top:0' }, "Plays a 20-second scripted show: chat, a sub, bits, a gift bomb and a donation — triggering any media whose price matches. Doesn't change your timer or stats."),
        btnDemo,
        h('div', { class: 'divider' }),
        h('h3', {}, 'Connections'),
        connList,
        btn('Reconnect all', safe(async () => {
          await api.post(A('/reconnect'));
          toast('Reconnecting…');
        }), 'sm smp-mt'))),
    h('div', { class: 'grid2' },
      card('Trigger checker',
        h('p', { class: 'muted', style: 'margin-top:0' }, 'Check which media an event would play — nothing is played.'),
        h('div', { class: 'row smp-custom' }, field('Paid with', mCur), field('Amount', mAmount), h('div', { class: 'grow' }, field('Message', mMsg)), btn('Check', runCheck)),
        matchOut),
      card("Fire each media's price",
        h('p', { class: 'muted', style: 'margin-top:0' }, 'One click sends a test event at exactly that price.'),
        priceFire)));

  function renderQuickMoney() {
    quickGrid.querySelectorAll('[data-money]').forEach((b) => (b.querySelector('em').textContent = 'Donate ' + money(b.dataset.money, cs())));
  }
  function renderPriceFire() {
    const priced = S.media.filter((m) => m.prices && (m.prices.bits || m.prices.subs || m.prices.donation));
    if (!priced.length) return put(priceFire, h('div', { class: 'empty' }, 'Set prices on your media to test them here.'));
    put(priceFire, ...priced.map((m) => {
      const msg = m.code ? pfx() + m.code : '';
      return h('div', { class: 'row smp-pf' }, h('b', { class: 'grow nowrap-text' }, m.name),
        m.prices.bits ? btn(num(m.prices.bits) + ' bits', () => fire({ type: 'bits', amount: m.prices.bits, message: msg }), 'sm') : null,
        m.prices.subs ? btn(m.prices.subs + ' subs', () => fire(m.prices.subs === 1 ? { type: 'gift', message: msg } : { type: 'giftbomb', amount: m.prices.subs, message: msg }), 'sm') : null,
        m.prices.donation ? btn(money(m.prices.donation, cs()), () => fire({ type: 'donation', amount: m.prices.donation, message: msg }), 'sm') : null);
    }));
  }

  // ═══ SCREENS & LINKS ═══════════════════════════════════════
  const lanEnabled = h('input', { type: 'checkbox' });
  const lanPort = h('input', { type: 'number', min: 1024, max: 65535, style: 'width:110px' });
  const lanStatus = h('div', { class: 'row', style: 'margin-top:4px' });
  const tvBox = h('div');
  const viewerBox = h('div');
  const tunnelBox = h('div');
  const hostedBox = h('div');
  const hostedAuto = h('input', { type: 'checkbox' });
  hostedAuto.addEventListener('change', safe(async () => {
    const r = await api.put(A('/hosted'), { auto: hostedAuto.checked });
    S.hosted = r.hosted;
    renderScreens();
  }));
  const kofiBox = h('div');
  const remoteBox = h('div');

  // OBS wake-up menu overlay
  const ovStyle = h('select', {}, [['steez', 'Steez — flat grey'], ['glass', 'Glass'], ['neon', 'Neon'], ['minimal', 'Minimal lower-third']].map(([v, t]) => h('option', { value: v }, t)));
  const ovInterval = h('input', { type: 'number', min: 1, max: 60, step: 1 });
  const ovHeader = h('input', { type: 'text', maxlength: 40 });
  const ovDesc = h('input', { type: 'checkbox' }), ovPrices = h('input', { type: 'checkbox' }), ovCode = h('input', { type: 'checkbox' }), ovTiktok = h('input', { type: 'checkbox' });
  const ovUrl = () => location.origin.replace('localhost', '127.0.0.1') + '/overlay/subathon-menu';
  const ovCard = card('OBS wake-up menu overlay',
    h('p', { class: 'muted', style: 'margin-top:0' }, 'An animated card that shows what viewers can set off — icon, name, price, TikTok gift and description — a new one every few seconds. Add it in OBS as a Browser Source (640×240).'),
    linkRow(ovUrl()),
    h('div', { class: 'grid2 smp-tight' }, field('Style', ovStyle), field('Seconds per item', ovInterval)),
    field('Header', ovHeader),
    h('div', { class: 'row' }, check(ovPrices, 'Prices'), check(ovTiktok, 'TikTok gifts'), check(ovDesc, 'Description'), check(ovCode, 'Trigger code')));
  const saveOverlay = safe(async () => {
    await api.put(A('/settings'), { overlay: { style: ovStyle.value, interval: Number(ovInterval.value) || 3, header: ovHeader.value, showDescription: ovDesc.checked, showPrices: ovPrices.checked, showCode: ovCode.checked, showTiktok: ovTiktok.checked } });
    toast('Overlay updated');
  });
  [ovStyle, ovInterval, ovHeader, ovDesc, ovPrices, ovCode, ovTiktok].forEach((el) => el.addEventListener('change', saveOverlay));
  function fillOverlay() {
    if (ovCard.contains(document.activeElement)) return;
    const o = S.settings.overlay || {};
    ovStyle.value = o.style || 'steez';
    ovInterval.value = o.interval || 3;
    ovHeader.value = o.header == null ? 'WAKE-UP MENU' : o.header;
    ovDesc.checked = o.showDescription !== false;
    ovPrices.checked = o.showPrices !== false;
    ovCode.checked = o.showCode !== false;
    ovTiktok.checked = o.showTiktok !== false;
  }

  async function setLan(body) {
    const r = await api.put(A('/lan'), body);
    if (r && r.lan) {
      S.lan = r.lan;
      renderLanBits();
    }
    toast(body.enabled === false ? 'TV & viewer server turned off' : 'TV & viewer server updated');
  }

  add(sections.screens, 
    h('div', { class: 'grid2' },
      h('div', {},
        card('TV & viewer server',
          h('p', { class: 'muted', style: 'margin-top:0' }, 'Serves the TV screen and the viewer page to devices on your home network (only the subathon pages — nothing else from Steez). The remote dashboard is password-protected.'),
          h('div', { class: 'row' }, check(lanEnabled, 'Server on'), h('span', { class: 'faint small' }, 'Port'), lanPort,
            btn('Apply', safe(() => setLan({ enabled: lanEnabled.checked, port: Number(lanPort.value) || 3000 })), 'sm primary')),
          lanStatus),
        card('TV screen', tvBox),
        card('Viewer page', viewerBox),
        ovCard),
      h('div', {},
        card('Share with viewers', hostedBox),
        card('Internet tunnel', tunnelBox),
        card('Ko-fi webhook', kofiBox),
        card('Fix TV connection',
          h('p', { class: 'muted', style: 'margin-top:0' }, 'TV can’t open the link? This fixes the usual Windows causes: it sets your network to Private, removes firewall rules that block Steez, allows the server port, warns about other firewalls and two-router setups, and prints the exact address for your TV.'),
          btn('Run the fixer', safe(async () => {
            if (!confirm('This opens a PowerShell window with administrator rights.\n\nWindows will ask “Do you want to allow this app to make changes?” — click Yes. Continue?')) return;
            await api.post(A('/fix-tv'));
            toast('Fixer started — approve the Windows prompt');
          }), 'primary'),
          h('div', { class: 'divider' }),
          h('h3', {}, 'If it still won’t load'),
          h('ul', { class: 'smp-list' },
            h('li', {}, 'Open the TV link on your phone first — same Wi-Fi as the TV, not mobile data.'),
            h('li', {}, 'Your phone/TV address should start with the same three numbers as the link (e.g. 192.168.1.x). If not, the PC and TV are on different routers: plug the PC into the router the Wi-Fi comes from, or set the second router/mesh to “Access Point” / “Bridge” mode.'),
            h('li', {}, 'Make sure the TV is not on a guest Wi-Fi, and that “AP / client isolation” is off in your router.'),
            h('li', {}, 'Antivirus with its own firewall (Norton, McAfee, Bitdefender…) can ignore the Windows settings — allow Steez or the port there.'),
            h('li', {}, 'Or start the internet tunnel — it works no matter how your network is set up.'))))));

  function renderLanBits() {
    const L = S.lan || {};
    if (document.activeElement !== lanPort) lanPort.value = L.port || 3000;
    lanEnabled.checked = !!L.enabled;
    put(lanStatus, 
      h('span', { class: 'pill ' + (L.running ? 'good' : L.error ? 'bad' : '') }, L.running ? 'Running on port ' + L.port : L.error ? 'Error' : 'Off'),
      L.error ? h('span', { class: 'small', style: 'color:var(--bad)' }, L.error) : null);
    renderScreens();
    renderDashScreens();
    renderStatus();
  }

  function renderScreens() {
    const pub = S.settings.publicUrl;
    const T = S.tunnel || {};
    if (!lanOn()) {
      put(tvBox, h('p', { class: 'muted', style: 'margin-top:0' }, 'Turn on the TV & viewer server to get the TV link.'), enableLanBtn());
      put(viewerBox, pub ? linkRow(pub + '/') : h('p', { class: 'muted', style: 'margin:0' }, 'Turn on the TV & viewer server to get the viewer link.'));
    } else {
      put(tvBox, 
        h('div', { class: 'row', style: 'margin-bottom:8px' }, h('span', { class: 'muted' }, 'TV code'), h('span', { class: 'tag smp-code' }, S.tvCode),
          btn('New TV code', safe(async () => {
            if (!confirm('Make a new TV code? The TV will disconnect and you will need to open the new link on it.')) return;
            await api.post(A('/tv/regen-code'));
          }), 'sm')),
        hint('On your Samsung TV open the Internet app and go to this address (TV and computer must be on the same Wi-Fi):'),
        ...lan().map((u) => linkRow(u + '/tv/' + S.tvCode)),
        hint('Or open ', h('code', {}, lan()[0] + '/tv'), ' and type the code. The TV asks you to press OK once so it may play sound.'),
        h('div', { class: 'divider' }),
        h('b', {}, 'OBS browser source'),
        hint('Same screen without the “press OK” step (', h('code', {}, '?obs=1'), '). Use 1920×1080.'),
        linkRow(`http://127.0.0.1:${S.lan.port}/tv/${S.tvCode}?obs=1`));
      put(viewerBox, 
        hint('Share this with your viewers (put it in your Twitch panels / chat command).'),
        shortLink() ? linkRow(shortLink()) : null,
        pub ? linkRow(pub + '/') : null,
        ...lan().map((u) => linkRow(u + '/')),
        !pub ? hint('LAN links only work on your home Wi-Fi. To share it with viewers, start the internet tunnel and use it as your public address.') : null);
    }

    renderHosted();
    const tState = T.state || 'off';
    const busy = tState === 'installing' || tState === 'starting';
    put(tunnelBox, 
      h('p', { class: 'muted', style: 'margin-top:0' }, 'A free Cloudflare quick tunnel puts the TV screen and viewer page on the internet — works even when your home network blocks the TV, and lets viewers open the menu. Steez installs cloudflared the first time (via winget). The address changes every time you start it.'),
      h('div', { class: 'row' },
        h('span', { class: 'pill ' + (tState === 'up' ? 'good' : tState === 'error' ? 'bad' : busy ? 'warn' : '') },
          { off: 'Off', installing: 'Installing cloudflared…', starting: 'Starting…', up: 'Online', error: 'Error' }[tState] || tState),
        T.detail ? h('span', { class: 'faint small grow' }, T.detail) : null,
        tState === 'up' || busy
          ? btn('Stop tunnel', safe(() => tunnel('stop')), 'sm danger')
          : btn('Start tunnel', safe(async () => {
              if (!lanOn()) throw localErr('Turn on the TV & viewer server first');
              await tunnel('start');
            }), 'sm primary')),
      tState === 'up' && T.url
        ? h('div', { style: 'margin-top:10px' },
            h('b', {}, 'TV'), linkRow(T.url + '/tv/' + S.tvCode),
            h('b', {}, 'Viewers'), linkRow(T.url + '/'),
            pub === T.url
              ? hint('This is your public address — the dashboard shows it as the viewer link.')
              : btn('Use as public address', safe(async () => {
                  await api.put(A('/settings'), { publicUrl: T.url });
                  sPublicUrl.value = T.url;
                  toast('Public address set');
                }), 'sm', ))
        : null);

    const kbase = pub || (T.state === 'up' && T.url) || lan()[0];
    put(kofiBox, 
      h('p', { class: 'muted', style: 'margin-top:0' }, 'For Ko-fi donations: ko-fi.com → Settings → API → paste this webhook URL, then copy the verification token into Settings → Donations. Ko-fi has to reach this address from the internet, so use the tunnel or your own public address.'),
      kbase ? linkRow(kbase + '/webhook/kofi') : h('div', { class: 'faint' }, 'Turn on the TV & viewer server first.'));
  }
  function renderHosted() {
    const H = S.hosted || {};
    if (!H.link) {
      put(hostedBox, h('p', { class: 'muted', style: 'margin:0' }, 'Turn on the subathon to get your viewer link.'));
      return;
    }
    hostedAuto.checked = H.auto !== false;
    const T = S.tunnel || {};
    const st = H.status === 'error' ? 'error' : T.state === 'up' && H.status === 'online' ? 'live' : T.state === 'starting' || T.state === 'installing' ? 'starting' : 'waiting';
    const pill = { live: ['good', 'Live: viewers see your page'], starting: ['warn', 'Going online…'], error: ['bad', 'Problem'], waiting: ['', 'Waiting screen'] }[st];
    const why =
      st === 'error' ? H.error
      : st === 'waiting' && !lanOn() ? 'Turn on the TV & viewer server to go live.'
      : st === 'waiting' && H.auto === false ? 'Start the internet tunnel below to go live.'
      : '';
    put(hostedBox,
      h('p', { class: 'muted', style: 'margin-top:0' }, 'Your own link for viewers. It never changes: while the subathon is online it shows your live viewer page, and while it’s off viewers see a waiting screen that connects by itself.'),
      h('div', { class: 'row smp-link' },
        h('input', { type: 'text', readonly: true, value: H.link, onfocus: (e) => e.target.select() }),
        btn('Copy link', copyViewerLink, 'primary'),
        btn('Open', () => openUrl(H.link), 'sm')),
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('span', { class: 'pill ' + pill[0] }, pill[1]),
        why ? h('span', { class: 'faint small grow' }, why) : h('span', { class: 'grow' })),
      h('div', { class: 'divider' }),
      check(hostedAuto, 'Go online automatically while the TV & viewer server is on'),
      hint('Uses the internet tunnel below. The first time, Steez installs cloudflared for it (one time, via winget).'),
      h('div', { class: 'row', style: 'margin-top:6px' },
        btn('Make a new link', safe(async () => {
          if (!confirm('Make a new viewer link? The old link stops working for good (it shows the waiting screen), so update it wherever you shared it.')) return;
          const r = await api.post(A('/hosted/new'));
          S.hosted = r.hosted;
          renderScreens();
          renderDashScreens();
          renderStatus();
          toast('New viewer link made');
        }), 'sm ghost')));
  }

  async function tunnel(action) {
    const r = await api.post(A('/tunnel'), { action });
    if (r && r.tunnel) {
      S.tunnel = r.tunnel;
      renderScreens();
    }
  }

  // ═══ SETTINGS ══════════════════════════════════════════════
  const S$ = (type, attrs = {}) => h(type === 'select' ? 'select' : type === 'textarea' ? 'textarea' : 'input', type === 'select' || type === 'textarea' ? attrs : { type, ...attrs });
  const sChannel = S$('text', { placeholder: 'yourname' });
  const sProvider = h('select', {}, [['none', 'None'], ['streamlabs', 'Streamlabs'], ['streamelements', 'StreamElements'], ['kofi', 'Ko-fi']].map(([v, t]) => h('option', { value: v }, t)));
  const sSlToken = S$('password', { autocomplete: 'off' });
  const sSeToken = S$('password', { autocomplete: 'off' });
  const sKofiToken = S$('password', { autocomplete: 'off' });
  const kofiUrlCode = h('code');
  const provSl = h('div', {}, field('Streamlabs Socket API token', sSlToken, 'streamlabs.com → Dashboard → Settings → API Settings → API Tokens → copy “Your Socket API Token”.'));
  const provSe = h('div', {}, field('StreamElements JWT token', sSeToken, 'streamelements.com → Dashboard → click your avatar → Channels → Show secrets → copy the JWT token.'));
  const provKofi = h('div', {}, field('Ko-fi verification token', sKofiToken), hint('ko-fi.com → Settings → API → paste this webhook URL, then copy the verification token here: ', kofiUrlCode, '. Ko-fi needs the app reachable from the internet (start the tunnel on Screens & links).'));
  const timeInputs = {};
  const timeField = (key, label) => {
    timeInputs[key] = S$('number', { step: 'any', min: 0 });
    return field(label, timeInputs[key]);
  };
  const perDollarLbl = h('span', {}, 'Per $1 donated');
  timeInputs.perDollar = S$('number', { step: 'any', min: 0 });
  const sMult = S$('number', { step: 0.1, min: 0 });
  const sInitialD = S$('number', { step: 1, min: 0, placeholder: '0' });
  const sInitial = S$('number', { step: 'any', min: 0, placeholder: '0' });
  const sCapD = S$('number', { step: 1, min: 0, placeholder: '0' });
  const sCap = S$('number', { step: 'any', min: 0, placeholder: '0' });
  const sAddTime = S$('checkbox');
  const dh = (d, hrs) => h('div', { class: 'row nowrap smp-dh' }, d, h('span', { class: 'faint small' }, 'days'), hrs, h('span', { class: 'faint small' }, 'hours'));
  const splitHours = (total, dEl, hEl) => {
    total = Number(total) || 0;
    const d = Math.floor(total / 24);
    dEl.value = d;
    hEl.value = +(total - d * 24).toFixed(2);
  };
  const joinHours = (dEl, hEl) => Math.max(0, (Number(dEl.value) || 0) * 24 + (Number(hEl.value) || 0));
  const sPrefix = S$('text', { maxlength: 3 });
  const sCurrency = S$('text', { maxlength: 4 });
  const sMatch = h('select', {}, h('option', { value: 'exact' }, 'Play media whose price matches the amount exactly'), h('option', { value: 'tier' }, 'Play the most expensive media the amount covers'));
  const sTitle = S$('text', { maxlength: 60 });
  const sAccent = S$('color');
  const sAccent2 = S$('color');
  const swatches = h('div', { class: 'row smp-swatches' });
  const sShowChat = S$('checkbox'), sShowGoals = S$('checkbox'), sShowFeed = S$('checkbox'), sShowNames = S$('checkbox');
  const sAlertSecs = S$('number', { min: 2, max: 30 });
  const sVolume = S$('range', { min: 0, max: 100 });
  const volLbl = h('b');
  const sIntro = h('textarea', { maxlength: 600 });
  const sShowRecent = S$('checkbox');
  const sPreviews = S$('checkbox');
  const sTkEnabled = S$('checkbox');
  const sTkMin = S$('number', { min: 0, step: 1 });
  const fxEnabled = S$('checkbox');
  const fxDonLbl = h('span', {}, 'Donation');
  const fxRows = [0, 1, 2, 3, 4].map(() => ({
    effect: h('select', {}, Object.entries(EFFECT_LABELS).map(([v, t]) => h('option', { value: v }, t))),
    subs: S$('number', { min: 0, step: 1 }),
    bits: S$('number', { min: 0, step: 1 }),
    donation: S$('number', { min: 0, step: 'any' }),
    tiktok: S$('number', { min: 0, step: 1 }),
  }));
  const previewLevel = (i) => {
    const t = S.settings.effects.tiers[i] || {};
    if (t.bits > 0) return fire({ type: 'bits', amount: t.bits });
    if (t.donation > 0) return fire({ type: 'donation', amount: t.donation });
    if (t.subs > 1) return fire({ type: 'giftbomb', amount: t.subs });
    if (t.subs > 0) return fire({ type: 'sub' });
    if (t.tiktok > 0) return fire({ type: 'tiktok', gift: 'Rose', amount: t.tiktok });
    return toast('Set a threshold for this level first', true);
  };
  const fxCard = card('Alert effects (TV screen)',
    check(fxEnabled, 'Bigger support gets bigger effects'),
    hint('Each event gets the highest level it reaches — a level applies when the event meets any of its numbers (0 = never for that kind). Subs counts gift bombs by size. Bigger levels also stay on screen longer. Save, then preview on the TV.'),
    h('table', { class: 'smp-fx' },
      h('tr', {}, ...['Level', 'Effect', 'Subs', 'Bits', fxDonLbl, 'TikTok coins', ''].map((t) => h('th', {}, t))),
      ...fxRows.map((r, i) => h('tr', {}, h('td', {}, h('b', {}, 'L' + (i + 1))), h('td', {}, r.effect), h('td', {}, r.subs), h('td', {}, r.bits), h('td', {}, r.donation), h('td', {}, r.tiktok),
        h('td', {}, btn('Preview', () => previewLevel(i), 'sm'))))));
  const sPublicUrl = S$('url', { placeholder: 'https://your-tunnel.trycloudflare.com' });
  const pwNew = S$('password', { autocomplete: 'new-password', placeholder: 'At least 6 characters' });
  const pwState = h('div', { class: 'row', style: 'margin-bottom:10px' });
  const btnSave = h('button', { class: 'primary' }, 'Save settings');
  const channelHelp = h('div', { class: 'help' });

  for (const [a, b] of SWATCHES) {
    add(swatches, h('button', {
      type: 'button',
      class: 'smp-swatch',
      title: 'Use these colors',
      onclick: () => {
        sAccent.value = a;
        sAccent2.value = b;
        markDirty();
      },
    }, h('i', { style: 'background:' + a }), h('i', { style: 'background:' + b })));
  }
  sVolume.addEventListener('input', () => (volLbl.textContent = sVolume.value + '%'));
  function showRates() {
    const wrap = sAddTime.closest && sAddTime.closest('.card');
    const rates = wrap && wrap.querySelector('.smp-rates');
    if (rates) rates.classList.toggle('smp-dim', !sAddTime.checked);
  }
  sAddTime.addEventListener('change', showRates);
  const showProvider = () => {
    const p = sProvider.value;
    provSl.hidden = p !== 'streamlabs';
    provSe.hidden = p !== 'streamelements';
    provKofi.hidden = p !== 'kofi';
  };
  sProvider.addEventListener('change', showProvider);

  const settingsWrap = h('div', { class: 'smp-settings' },
    h('div', { class: 'grid2' },
      card('Twitch', field('Twitch channel', sChannel), channelHelp),
      card('Donations', field('Donation service', sProvider), provSl, provSe, provKofi, hint('Tokens stay on your computer and are never shown to viewers.'))),
    card('Time rules',
      check(sAddTime, h('b', {}, 'Subs, bits, donations and TikTok gifts add time to the countdown')),
      hint('Off by default: support still counts toward stats and goals, shows alerts and plays sounds, but the clock only changes when you add time yourself. Turn it on to use the amounts below.'),
      h('p', { class: 'muted' }, 'How much time each thing adds to the clock (in minutes).'),
      h('div', { class: 'smp-grid4 smp-rates' },
        timeField('prime', 'Prime sub'), timeField('tier1', 'Tier 1 sub'), timeField('tier2', 'Tier 2 sub'), timeField('tier3', 'Tier 3 sub'),
        timeField('per100Bits', 'Per 100 bits'),
        timeField('per100Coins', 'Per 100 TikTok coins'),
        h('label', { class: 'field' }, perDollarLbl, timeInputs.perDollar),
        field('Multiplier (happy hour)', sMult, '2 = double time')),
      h('div', { class: 'grid2', style: 'margin-top:12px' },
        field('Starting time', dh(sInitialD, sInitial), 'Used when you reset the timer'),
        field('Max length', dh(sCapD, sCap), 'Longest the subathon can run with added time. 0 = no limit'))),
    h('div', { class: 'grid2' },
      card('Triggers',
        h('div', { class: 'grid2 smp-tight' }, field('Code prefix', sPrefix, 'Viewers type this before a code, e.g. #horn'), field('Currency symbol', sCurrency)),
        field('When no code is in the message', sMatch)),
      card('Look (TV & viewer page)',
        field('Title', sTitle),
        h('div', { class: 'row' }, field('Main color', sAccent), field('Second color', sAccent2), swatches))),
    h('div', { class: 'grid2' },
      card('TV screen',
        check(sShowChat, 'Show chat'), check(sShowGoals, 'Show goals'), check(sShowFeed, 'Show latest support'), check(sShowNames, 'Show supporter names'),
        h('div', { class: 'grid2 smp-tight' }, field('Alert length (seconds)', sAlertSecs), h('label', { class: 'field' }, h('span', {}, 'Master volume ', volLbl), sVolume))),
      card('Viewer page',
        field('Intro text', sIntro),
        check(sShowRecent, 'Show recent supporters'),
        check(sPreviews, 'Viewers can preview sounds by clicking them'),
        field('Public address (optional)', sPublicUrl, 'If the app is online (tunnel or your own domain), paste its address so the dashboard shows the right viewer link.'))),
    fxCard,
    card('TikTok gifts',
      check(sTkEnabled, 'TikTok gifts count toward the subathon (stats, alerts, sounds, and time if that is on)'),
      field('Only show an alert for gifts worth at least (coins)', sTkMin, 'Smaller gifts still count — they just don’t pop up on the TV. Gifts set up on Media & prices always alert.')),
    h('div', { class: 'grid2' },
      card('Remote dashboard password',
        h('p', { class: 'muted', style: 'margin-top:0' }, 'The same dashboard also runs on your network at /admin, so you can run the subathon from your phone or another PC. It needs a password; Steez itself never asks for it.'),
        pwState,
        h('div', { class: 'row' }, pwNew, btn('Set password', safe(async () => {
          if (pwNew.value.length < 6) throw localErr('Password must be at least 6 characters');
          await api.post(A('/password'), { password: pwNew.value });
          pwNew.value = '';
          S.hasPassword = true;
          renderRemote();
          toast('Password saved');
        })))),
      h('div', { class: 'card smp-danger' }, h('h3', {}, 'Reset'),
        h('div', { class: 'row' },
          btn('Reset timer to starting time', safe(async () => {
            if (!confirm('Reset the timer to ' + fmtHours(S.settings.time.initialHours) + ' and stop it?')) return;
            await api.post(A('/timer'), { action: 'reset' });
            toast('Timer reset');
          }), 'danger'),
          btn('Reset stats & activity', safe(async () => {
            if (!confirm('Reset subs, bits, donations and time-added counters to zero and clear the activity list?')) return;
            await api.post(A('/stats/reset'));
            toast('Stats reset');
          }), 'danger')),
        hint('Use these before your real subathon starts to wipe out test data.'))),
    card('Import from Subathon Media Player',
      h('p', { class: 'muted', style: 'margin-top:0' }, 'Already used the standalone Subathon Media Player? Pick its folder to bring over the timer, media and prices, uploaded files, goals, settings, TV code and password. This replaces what is here now. (Steez imports it automatically on first launch if it is in Downloads, Desktop or Documents.)'),
      btn('Pick folder and import', safe(async () => {
        if (!confirm('Replace the subathon here with the data from the standalone app?')) return;
        const r = await api.post(A('/import'));
        if (r.cancelled) return;
        toast(`Imported ${r.media} media, ${r.goals} goals and ${r.files} files`);
      }))));
  add(sections.settings, h('div', { class: 'row', style: 'margin-bottom:14px' }, h('div', { class: 'grow muted' }, 'Changes apply live to the TV and viewer page.'), btnSave), settingsWrap);

  function markDirty() {
    settingsDirty = true;
    btnSave.textContent = 'Save settings •';
  }
  const isDirtyTarget = (t) => t.closest('.card') && !t.closest('.smp-danger') && t !== pwNew;
  settingsWrap.addEventListener('input', (e) => isDirtyTarget(e.target) && markDirty());
  settingsWrap.addEventListener('change', (e) => isDirtyTarget(e.target) && markDirty());

  function renderRemote() {
    put(pwState, 
      h('span', { class: 'pill ' + (S.hasPassword ? 'good' : 'warn') }, S.hasPassword ? 'Password set' : 'No password yet'),
      S.remoteAdminUrl ? h('code', { class: 'grow nowrap-text' }, S.remoteAdminUrl) : h('span', { class: 'faint small' }, 'Turn on the TV & viewer server to use it.'),
      S.remoteAdminUrl ? btn('Copy', () => copy(S.remoteAdminUrl), 'sm') : null,
      S.remoteAdminUrl ? btn('Open', () => openUrl(S.remoteAdminUrl), 'sm') : null);
  }

  function fillSettings() {
    const s = S.settings;
    sChannel.value = s.channel || '';
    sChannel.placeholder = S.twitchLogin || 'yourname';
    channelHelp.textContent = S.twitchLogin
      ? `Leave blank to use the account logged into Steez (#${S.twitchLogin}). Chat, subs, resubs, gift subs and bits are read from this channel — no extra login needed.`
      : 'Your Twitch username. Chat, subs, resubs, gift subs and bits are read from this channel — no extra login needed. Or log into Twitch in Steez Settings and leave this blank.';
    sProvider.value = s.donation.provider;
    sSlToken.value = s.donation.provider === 'streamlabs' ? s.donation.token : '';
    sSeToken.value = s.donation.provider === 'streamelements' ? s.donation.token : '';
    sKofiToken.value = s.donation.kofiToken || '';
    for (const [k, el] of Object.entries(timeInputs)) el.value = +((s.time[k] || 0) / 60).toFixed(2);
    sMult.value = s.time.multiplier;
    splitHours(s.time.initialHours, sInitialD, sInitial);
    splitHours(s.time.capHours, sCapD, sCap);
    sAddTime.checked = s.time.eventsAddTime === true;
    showRates();
    sPrefix.value = s.triggerPrefix;
    sCurrency.value = s.currencySymbol;
    sMatch.value = s.matchMode;
    sTitle.value = s.title;
    sAccent.value = s.accent;
    sAccent2.value = s.accent2;
    sShowChat.checked = !!s.tv.showChat;
    sShowGoals.checked = !!s.tv.showGoals;
    sShowFeed.checked = !!s.tv.showFeed;
    sShowNames.checked = s.tv.showNames !== false;
    sAlertSecs.value = s.tv.alertSeconds;
    sVolume.value = s.tv.volume;
    volLbl.textContent = s.tv.volume + '%';
    sIntro.value = s.viewer.intro;
    sShowRecent.checked = !!s.viewer.showRecent;
    sPreviews.checked = s.viewer.previews !== false;
    sTkEnabled.checked = !s.tiktok || s.tiktok.enabled !== false;
    sTkMin.value = s.tiktok ? s.tiktok.alertMinCoins : 1;
    const fx = s.effects || { tiers: [] };
    fxEnabled.checked = fx.enabled !== false;
    fxDonLbl.textContent = 'Donation (' + s.currencySymbol + ')';
    fxRows.forEach((r, i) => {
      const t = fx.tiers[i] || {};
      r.effect.value = t.effect || 'pop';
      for (const k of ['subs', 'bits', 'donation', 'tiktok']) r[k].value = t[k] || 0;
    });
    sPublicUrl.value = s.publicUrl || '';
    perDollarLbl.textContent = 'Per ' + s.currencySymbol + '1 donated';
    showProvider();
    settingsDirty = false;
    btnSave.textContent = 'Save settings';
  }
  btnSave.addEventListener('click', safe(async () => {
    const p = sProvider.value;
    const time = {};
    for (const [k, el] of Object.entries(timeInputs)) time[k] = Math.round(Number(el.value || 0) * 60);
    Object.assign(time, { multiplier: Number(sMult.value || 1), initialHours: joinHours(sInitialD, sInitial), capHours: joinHours(sCapD, sCap), eventsAddTime: sAddTime.checked });
    const body = {
      channel: sChannel.value, title: sTitle.value, accent: sAccent.value, accent2: sAccent2.value,
      triggerPrefix: sPrefix.value, currencySymbol: sCurrency.value, matchMode: sMatch.value, publicUrl: sPublicUrl.value,
      time,
      donation: { provider: p, token: p === 'streamlabs' ? sSlToken.value : p === 'streamelements' ? sSeToken.value : '', kofiToken: sKofiToken.value },
      tv: { showChat: sShowChat.checked, showGoals: sShowGoals.checked, showFeed: sShowFeed.checked, showNames: sShowNames.checked, alertSeconds: Number(sAlertSecs.value), volume: Number(sVolume.value) },
      viewer: { intro: sIntro.value, showRecent: sShowRecent.checked, previews: sPreviews.checked },
      tiktok: { enabled: sTkEnabled.checked, alertMinCoins: Number(sTkMin.value) || 0 },
      effects: { enabled: fxEnabled.checked, tiers: fxRows.map((r) => ({ effect: r.effect.value, subs: Number(r.subs.value) || 0, bits: Number(r.bits.value) || 0, donation: Number(r.donation.value) || 0, tiktok: Number(r.tiktok.value) || 0 })) },
    };
    settingsDirty = false;
    btnSave.textContent = 'Save settings';
    try {
      await api.put(A('/settings'), body);
    } catch (e) {
      markDirty();
      throw e;
    }
    toast('Settings saved');
  }));

  // ═══ Render + live updates ═════════════════════════════════
  function renderAll() {
    renderTimer();
    renderStats();
    renderStatus();
    renderFeed();
    renderChat();
    renderSafe(soundboard, renderSoundboard);
    renderSafe(mediaList, renderMedia);
    S.tiktokRules ||= [];
    renderSafe(tkRules, renderTiktok);
    fillOverlay();
    renderSafe(goalList, renderGoals);
    renderPriceFire();
    renderHow();
    renderQuickMoney();
    if (!settingsDirty) fillSettings();
    kofiUrlCode.textContent = (S.settings.publicUrl || (S.tunnel?.state === 'up' && S.tunnel.url) || lan()[0] || 'http://<your address>') + '/webhook/kofi';
    mediaPaused.checked = !!S.settings.mediaPaused;
    renderBanner();
    renderLanBits();
    renderRemote();
    renderNowPlaying();
  }

  function onMessage(m) {
    if (!alive) return;
    switch (m.t) {
      case 'init':
        if (m.role !== 'admin') return;
        S = m.state;
        S.chat ||= [];
        S.feed ||= [];
        renderAll();
        break;
      case 'timer':
        if (S) {
          S.timer = m.timer;
          renderTimer();
        }
        break;
      case 'ended':
        if (S) toast('The subathon timer has ended');
        break;
      case 'stats':
        if (S) {
          S.stats = m.stats;
          S.goals = m.goals;
          renderStats();
          renderGoalBars();
        }
        break;
      case 'feed':
        if (S) {
          S.feed.unshift(m.item);
          S.feed.length = Math.min(S.feed.length, 100);
          renderFeed();
        }
        break;
      case 'status':
        if (S) {
          S.statuses = m.statuses;
          renderStatus();
        }
        break;
      case 'chat':
        if (S) {
          S.chat.push(m.msg);
          if (S.chat.length > 60) S.chat.shift();
          addChat(m.msg);
        }
        break;
      case 'clear':
        if (S) clearChat(m);
        break;
      case 'nowPlaying':
        nowPlaying = m;
        renderNowPlaying();
        break;
      case 'lan':
        if (S) {
          S.lan = m.lan;
          if (m.lan && Array.isArray(m.lan.urls)) S.lanUrls = m.lan.running ? m.lan.urls : [];
          renderLanBits();
        }
        break;
      case 'tiktok':
        if (S) {
          S.tiktokStatus = m.tiktok;
          renderSafe(tkRules, renderTiktok);
        }
        break;
      case 'tunnel':
        if (S) {
          S.tunnel = m.tunnel;
          renderScreens();
        }
        break;
      case 'hosted':
        if (S) {
          S.hosted = m.hosted;
          renderScreens();
          renderDashScreens();
          renderStatus();
        }
        break;
      default:
        break;
    }
  }

  showTab(lastTab);
  sections[lastTab].prepend(h('div', { class: 'faint smp-loading' }, 'Connecting…'));
  conn = connect(
    (m) => {
      root.querySelectorAll('.smp-loading').forEach((e) => e.remove());
      onMessage(m);
    },
    (ok) => {
      if (!ok && alive && S) headPills.prepend(h('span', { class: 'pill warn' }, 'Reconnecting…'));
    });
  timers.push(setInterval(renderTimer, 250));
  timers.push(setInterval(() => S && renderFeed(), 30000));

  return () => {
    alive = false;
    conn?.close();
    timers.forEach(clearInterval);
    document.removeEventListener('focusout', onFocusOut);
  };
}
