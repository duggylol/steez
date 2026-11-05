/* ============================================================
   Steez TikTok gifts — OBS overlay client
   Shows the biggest gift combo and the top gifter, alternating,
   and jumps to a combo while it's being tapped. Live over /queueup-ws;
   the look comes from the gift overlay's widget style (see /overlay/kit).
   ============================================================ */
'use strict';

const Kit = window.SteezKit;
const $ = (id) => document.getElementById(id);
const els = {
  stage: $('stage'), card: $('card'), panel: $('panel'), titleText: $('titleText'), coinFace: $('coinFace'),
  coinBadge: $('coinBadge'), name: $('name'), statValue: $('statValue'), statLabel: $('statLabel'),
  sub: $('sub'), emptyText: $('emptyText'), sparkles: $('sparkles'), pop: $('pop'),
};

// Shown in the app's previews while there are no gifts yet.
const SAMPLE = {
  topStreak: { login: 'beststreamerever', name: 'BestStreamerEver', giftId: 'rose', giftName: 'Rose', giftGlyph: '🌹', count: 48, diamonds: 48 },
  topGifters: [{ login: 'jeffunderdog', name: 'jeffunderdog', avatar: '', diamonds: 1250, gifts: 31 }],
  liveStreak: null,
};

let cfg = null;
let data = null;              // last gift snapshot from Steez
let demoData = null;          // fake snapshot while a preview animation plays
let view = 'streak';          // what is on screen now
let rotateTimer = null;
let liveHoldUntil = 0;
let lastNum = null;           // the number on screen, for count-ups
let lastKey = '';
let demoTimers = [];

/* ------------------------------------------------------------------ */

function fmt(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(n % 1e3 ? 1 : 0) + 'K';
  return n.toLocaleString();
}

function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function current() {
  if (demoData) return demoData;
  const empty = !data || (!data.topStreak && !(data.topGifters && data.topGifters.length) && !data.liveStreak);
  return empty && Kit.editor ? SAMPLE : data;
}

/* ------------------------------------------------------------------ */
/* config                                                             */
/* ------------------------------------------------------------------ */

function applyConfig(ov) {
  cfg = ov || {};
  const replay = Kit.applyLook(cfg);
  const b = document.body;
  b.classList.toggle('no-title', cfg.showTitle === false);
  b.classList.toggle('no-sub', !cfg.showGiftName && !cfg.showDiamonds);
  els.emptyText.textContent = cfg.emptyText || '';

  if (cfg.mode !== 'both') view = cfg.mode || 'streak';
  scheduleRotate();
  render(replay);
}

function scheduleRotate() {
  clearInterval(rotateTimer);
  rotateTimer = null;
  if (!cfg || cfg.mode !== 'both') return;
  const secs = Math.max(3, Number(cfg.rotateSeconds) || 8);
  rotateTimer = setInterval(() => {
    if (Date.now() < liveHoldUntil || demoData) return; // don't rotate away from a live combo
    const d = current();
    if (!d || (!d.topStreak && !(d.topGifters && d.topGifters.length))) return;
    swapTo(view === 'streak' ? 'gifter' : 'streak');
  }, secs * 1000);
}

let swapping = false;
function swapTo(next) {
  if (next === view || swapping) return;
  swapping = true;
  els.panel.classList.remove('in');
  els.panel.classList.add('out');
  setTimeout(() => {
    view = next;
    els.panel.classList.remove('out');
    render(true); // render(true) plays the entrance itself
    swapping = false;
  }, 300 / Math.max(0.25, Number(cfg && cfg.speed) || 1));
}

/* ------------------------------------------------------------------ */
/* rendering                                                          */
/* ------------------------------------------------------------------ */

function paintFace(url, fallbackText, round, glyph) {
  const face = els.coinFace;
  if (!url) {
    const key = 'none:' + (round ? fallbackText : glyph || '');
    if (face.dataset.src === key) return;
    face.dataset.src = key;
    face.innerHTML = round ? `<span class="letter">${escapeHtml(fallbackText)}</span>` : `<span class="glyph">${escapeHtml(glyph || '🎁')}</span>`;
    face.style.background = round
      ? `linear-gradient(140deg,hsl(${hashHue(fallbackText)} 70% 55%),hsl(${(hashHue(fallbackText) + 40) % 360} 65% 42%))`
      : '';
    return;
  }
  if (face.dataset.src === url) return;
  face.dataset.src = url;
  face.style.background = '';
  face.innerHTML = '';
  const img = new Image();
  img.alt = '';
  img.className = round ? 'round' : '';
  img.onload = () => { if (face.dataset.src === url) img.classList.add('shown'); };
  img.onerror = () => { if (face.dataset.src === url) paintFace('', fallbackText, round, glyph); };
  img.src = url;
  face.appendChild(img);
}

/** Shows the number; on the same view a change counts up and plays the change animation. */
function setValue(n, prefix, sameView) {
  const el = els.statValue;
  const text = prefix + fmt(n);
  const prev = lastNum;
  lastNum = n;
  if (!sameView || prev === null) {
    Kit.stopCount(el);
    el.textContent = text;
    return;
  }
  if (prev === n) return;
  if (cfg.countUp) Kit.countTo(el, prev, n, (v) => prefix + fmt(v), 420);
  else {
    Kit.stopCount(el);
    el.textContent = text;
  }
  els.pop.textContent = n > prev ? '+' + fmt(n - prev) : '';
  Kit.change(els.card);
}

function render(forceEnter) {
  if (!cfg) return;
  const d = current();
  const b = document.body;
  const hasStreak = !!(d && d.topStreak);
  const hasGifter = !!(d && d.topGifters && d.topGifters.length);
  const live = d && d.liveStreak && (cfg.showLiveStreak || d === demoData) ? d.liveStreak : null;

  b.classList.toggle('is-empty', !hasStreak && !hasGifter && !live);
  if (!hasStreak && !hasGifter && !live) return;

  // A combo being tapped takes over the screen, then we return to rotation.
  let showing = view;
  if (live) {
    showing = 'streak';
    liveHoldUntil = Date.now() + 4000;
  } else if (view === 'streak' && !hasStreak) {
    showing = 'gifter';
  } else if (view === 'gifter' && !hasGifter) {
    showing = 'streak';
  }

  b.classList.toggle('mode-gifter', showing === 'gifter');
  els.panel.classList.toggle('live', !!live);

  let key;
  if (showing === 'streak') {
    const s = live || d.topStreak;
    key = 'streak:' + s.login + ':' + s.giftId + ':' + (live ? 'live' : 'top');
    const same = key === lastKey && !forceEnter;
    els.titleText.textContent = cfg.streakTitle || 'TOP STREAK';
    els.coinBadge.textContent = live ? '🔥' : '★';
    paintFace(s.giftImage, s.giftName || 'Gift', false, s.giftGlyph);
    els.name.textContent = s.name || s.login;
    setValue(s.count, 'x', same);
    els.statLabel.textContent = 'Streak';
    const parts = [];
    if (cfg.showGiftName && s.giftName) parts.push(s.giftName);
    if (cfg.showDiamonds && s.diamonds) parts.push('◆ ' + fmt(s.diamonds));
    els.sub.textContent = parts.join('  ·  ');
  } else {
    const g = d.topGifters[0];
    key = 'gifter:' + g.login;
    const same = key === lastKey && !forceEnter;
    els.titleText.textContent = cfg.gifterTitle || 'TOP GIFTER';
    els.coinBadge.textContent = '👑';
    paintFace(cfg.showAvatar ? g.avatar : '', (g.name || g.login || '?').charAt(0).toUpperCase(), true);
    els.name.textContent = g.name || g.login;
    setValue(g.diamonds, '', same);
    els.statLabel.textContent = 'Diamonds';
    els.sub.textContent = cfg.showGiftName ? `${fmt(g.gifts)} gift${g.gifts === 1 ? '' : 's'} this stream` : '';
  }

  if (forceEnter || key !== lastKey) Kit.entrance(els.panel);
  lastKey = key;
}

/* ------------------------------------------------------------------ */
/* preview animation (only ever triggered by the Steez editor)        */
/* ------------------------------------------------------------------ */

/** A fake combo climbing x1 → x18 on top of whatever is showing, then back. */
function playDemo() {
  demoTimers.forEach(clearTimeout);
  const base = current() || SAMPLE;
  const combo = { login: 'demo', name: 'BestStreamerEver', giftId: 'demo-rose', giftName: 'Rose', giftGlyph: '🌹', count: 1, diamonds: 1 };
  const frame = (n) => ({ ...base, liveStreak: { ...combo, count: n, diamonds: n } });
  demoData = frame(1);
  render(true);
  const taps = 18;
  demoTimers = [];
  for (let n = 2; n <= taps; n++) {
    demoTimers.push(setTimeout(() => { demoData = frame(n); render(false); }, 500 + (n - 1) * 150));
  }
  demoTimers.push(setTimeout(() => { demoData = null; liveHoldUntil = 0; lastKey = ''; render(true); }, 500 + taps * 150 + 2200));
}

/* ------------------------------------------------------------------ */
/* boot                                                               */
/* ------------------------------------------------------------------ */

function handle(msg) {
  if (!msg || msg.type !== 'gifts') return;
  data = msg.gifts || null;
  if (msg.giftOverlay) applyConfig(msg.giftOverlay);
  else render(false);
}

Kit.seedSparkles(els.sparkles, 18);
Kit.onDemo(playDemo);
Kit.reportSize(els.stage);

if (Kit.thumb) {
  Kit.loadPreset('gifts', Kit.thumb).then(applyConfig).catch(() => {});
} else {
  fetch('/overlay/gifts/api/state').then((r) => r.json()).then((s) => handle({ type: 'gifts', ...s })).catch(() => {});
  Kit.connect(handle);
}
