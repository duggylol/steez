/* ============================================================
   Steez TikTok gifts — OBS overlay client
   Shows the biggest gift combo and the top gifter, alternating,
   and jumps to a combo while it's being tapped. Live over /queueup-ws.
   ============================================================ */
'use strict';

const $ = id => document.getElementById(id);
const els = {
  panel: $('panel'), titleText: $('titleText'), medallion: $('medallion'), coinFace: $('coinFace'),
  coinBadge: $('coinBadge'), name: $('name'), statValue: $('statValue'), statLabel: $('statLabel'),
  sub: $('sub'), emptyText: $('emptyText'), sparkles: $('sparkles')
};

let cfg = null;
let data = null;
let view = 'streak';          // what is on screen now
let rotateTimer = null;
let liveHoldUntil = 0;
let lastShownValue = null;
let lastKey = '';

/* ------------------------------------------------------------------ */

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
  return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : '11, 13, 20';
}

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

function seedSparkles() {
  const box = els.sparkles;
  box.innerHTML = '';
  for (let i = 0; i < 18; i++) {
    const s = document.createElement('i');
    if (i % 5 === 0) s.className = 'big';
    s.style.left = (4 + Math.random() * 92) + '%';
    s.style.top = (10 + Math.random() * 85) + '%';
    s.style.setProperty('--dur', (4 + Math.random() * 5).toFixed(2) + 's');
    s.style.setProperty('--delay', (-Math.random() * 8).toFixed(2) + 's');
    box.appendChild(s);
  }
}

/* ------------------------------------------------------------------ */
/* config                                                             */
/* ------------------------------------------------------------------ */

function applyConfig(ov) {
  cfg = ov;
  const r = document.documentElement.style;
  r.setProperty('--accent', ov.accent);
  r.setProperty('--accent2', ov.accent2);
  r.setProperty('--text', ov.textColor);
  r.setProperty('--bg', hexToRgb(ov.bg));
  r.setProperty('--bg-opacity', ov.bgOpacity);
  r.setProperty('--radius', ov.radius + 'px');
  r.setProperty('--width', ov.width + 'px');
  r.setProperty('--scale', ov.scale);
  r.setProperty('--font', `"${ov.fontFamily}", Inter, "Segoe UI", system-ui, sans-serif`);

  const b = document.body;
  b.classList.toggle('has-bg', Number(ov.bgOpacity) > 0.02);
  b.classList.toggle('no-title', !ov.showTitle);
  b.classList.toggle('ring', !!ov.ring);
  b.classList.toggle('particles', !!ov.particles);
  b.classList.toggle('glow', !!ov.glow);
  b.classList.toggle('no-sub', !ov.showGiftName && !ov.showDiamonds);

  els.emptyText.textContent = ov.emptyText || '';

  if (ov.mode !== 'both') view = ov.mode;
  scheduleRotate();
  render(true);
}

function scheduleRotate() {
  clearInterval(rotateTimer);
  rotateTimer = null;
  if (!cfg || cfg.mode !== 'both') return;
  const secs = Math.max(3, Number(cfg.rotateSeconds) || 8);
  rotateTimer = setInterval(() => {
    if (Date.now() < liveHoldUntil) return;      // don't rotate away from a live combo
    if (!data || (!data.topStreak && !data.topGifters?.length)) return;
    swapTo(view === 'streak' ? 'gifter' : 'streak');
  }, secs * 1000);
}

let swapping = false;
function swapTo(next) {
  if (next === view || swapping) return;
  swapping = true;
  els.panel.classList.remove('enter');
  els.panel.classList.add('out');
  setTimeout(() => {
    view = next;
    els.panel.classList.remove('out');
    render(true);          // render(true) restarts the entry animation itself
    swapping = false;
  }, 300);
}

/* ------------------------------------------------------------------ */
/* rendering                                                          */
/* ------------------------------------------------------------------ */

function paintFace(url, fallbackText, round) {
  const face = els.coinFace;
  if (!url) {
    face.innerHTML = round
      ? `<span class="letter">${escapeHtml(fallbackText)}</span>`
      : '<span class="glyph">🎁</span>';
    face.style.background = round
      ? `linear-gradient(140deg,hsl(${hashHue(fallbackText)} 70% 55%),hsl(${(hashHue(fallbackText) + 40) % 360} 65% 42%))`
      : '';
    face.dataset.src = '';
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
  img.onerror = () => { if (face.dataset.src === url) paintFace('', fallbackText, round); };
  img.src = url;
  face.appendChild(img);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setValue(text) {
  const el = els.statValue;
  if (el.textContent === text) return;
  el.textContent = text;
  if (lastShownValue !== null) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
  lastShownValue = text;
}

function render(forceEnter) {
  if (!cfg) return;
  const b = document.body;
  const hasStreak = !!(data && data.topStreak);
  const hasGifter = !!(data && data.topGifters && data.topGifters.length);
  const live = data && data.liveStreak && cfg.showLiveStreak ? data.liveStreak : null;

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
    const s = live || data.topStreak;
    els.titleText.textContent = cfg.streakTitle || 'TOP STREAK';
    els.coinBadge.textContent = live ? '🔥' : '★';
    paintFace(s.giftImage, s.giftName || 'Gift', false);
    els.name.textContent = s.name || s.login;
    setValue('x' + fmt(s.count));
    els.statLabel.textContent = 'Streak';
    const parts = [];
    if (cfg.showGiftName && s.giftName) parts.push(s.giftName);
    if (cfg.showDiamonds && s.diamonds) parts.push('◆ ' + fmt(s.diamonds));
    els.sub.textContent = parts.join('  ·  ');
    key = 'streak:' + s.login + ':' + s.giftId + ':' + (live ? 'live' : 'top');
    if (live && lastKey === key) {
      els.medallion.classList.remove('punch');
      void els.medallion.offsetWidth;
      els.medallion.classList.add('punch');
    }
  } else {
    const g = data.topGifters[0];
    els.titleText.textContent = cfg.gifterTitle || 'TOP GIFTER';
    els.coinBadge.textContent = '👑';
    paintFace(cfg.showAvatar ? g.avatar : '', (g.name || g.login || '?').charAt(0).toUpperCase(), true);
    els.name.textContent = g.name || g.login;
    setValue(fmt(g.diamonds));
    els.statLabel.textContent = 'Diamonds';
    els.sub.textContent = cfg.showGiftName ? `${fmt(g.gifts)} gift${g.gifts === 1 ? '' : 's'} this stream` : '';
    key = 'gifter:' + g.login;
  }

  if (forceEnter || key !== lastKey) {
    lastShownValue = null;
    els.panel.classList.remove('enter');
    void els.panel.offsetWidth;
    els.panel.classList.add('enter');
    setTimeout(() => els.panel.classList.remove('enter'), 520);
  }
  lastKey = key;
}

/* ------------------------------------------------------------------ */
/* live connection                                                    */
/* ------------------------------------------------------------------ */

let ws = null;
let retry = 0;

function handle(msg) {
  if (!msg || msg.type !== 'gifts') return;
  data = msg.gifts || null;
  if (msg.giftOverlay) applyConfig(msg.giftOverlay);
  else render(false);
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/queueup-ws`);
  ws.onopen = () => { retry = 0; };
  ws.onmessage = ev => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    handle(msg);
  };
  ws.onclose = () => {
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, Math.min(500 * Math.pow(2, retry - 1), 8000));
  };
  ws.onerror = () => { try { ws.close(); } catch (_) {} };
}

seedSparkles();
fetch('/overlay/gifts/api/state').then(r => r.json()).then(s => handle({ type: 'gifts', ...s })).catch(() => {});
connect();
