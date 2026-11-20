// Steez Casino UI kit: DOM helper, numbers, sound, the shared controls and the game layout.
// Every game builds its screen from these so the whole site looks and behaves the same.

export const BASE = (window.CASINO && window.CASINO.base) || '';
export const asset = (p) => `${BASE}/static/${p}`;

// ── DOM ───────────────────────────────────────────────────
const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'rect', 'text', 'line', 'polyline', 'polygon', 'defs', 'linearGradient', 'radialGradient', 'stop', 'ellipse', 'tspan', 'clipPath', 'mask', 'filter', 'feGaussianBlur']);
export function h(tag, attrs = {}, ...kids) {
  const svg = SVG_TAGS.has(tag);
  const el = svg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) p.startsWith('--') ? el.style.setProperty(p, x) : (el.style[p] = x);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && !svg && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, ...kids);
  return el;
}
export function add(el, ...kids) {
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
export const put = (el, ...kids) => (el.replaceChildren(), add(el, ...kids));
export function css(id, text) {
  if (document.getElementById(`css-${id}`)) return;
  document.head.append(h('style', { id: `css-${id}` }, text));
}

// ── Numbers and time ──────────────────────────────────────
export const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
export const fmtMult = (m) => `${m >= 1000 ? fmt(m) : m >= 100 ? Math.round(m) : Number(m).toFixed(2)}×`;
export const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
export const short = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${+(n / 1e3).toFixed(1)}K` : fmt(n));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const ease = {
  out: (t) => 1 - (1 - t) ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2,
  outQuint: (t) => 1 - (1 - t) ** 5,
};
/** Run fn(t) every frame for `ms`, t from 0 to 1. */
export function tween(ms, fn) {
  return new Promise((done) => {
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      fn(t);
      if (t < 1) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  });
}
/** Count a number up in an element. */
export function countUp(el, to, ms = 900, from = 0) {
  return tween(ms, (t) => (el.textContent = fmt(from + (to - from) * ease.out(t))));
}

// ── Remembered choices (storage can be blocked: then nothing is remembered) ──
export function load(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}
export function keep(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* fine */
  }
}

export function toast(msg, bad = false) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = h('div', { class: `toast${bad ? ' bad' : ''}` }, msg);
  box.append(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => t.remove(), bad ? 4500 : 2600);
}

// ── Sound: recorded effects, with tiny synth blips for rapid ticks ──
const SAMPLES = ['chip', 'deal', 'flip', 'win', 'big', 'lose', 'gem', 'boom', 'cash', 'launch', 'crash', 'dice', 'coin', 'spin', 'stop', 'wheel', 'roll', 'scratch', 'open', 'pop'];
let ac = null;
let master = null;
const buffers = {};
let muted = load('casinoMuted') === '1';
function audio() {
  if (ac) return ac;
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain();
    master.gain.value = 0.7;
    master.connect(ac.destination);
    for (const name of SAMPLES)
      fetch(asset(`sfx/${name}.mp3`))
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((b) => b && ac.decodeAudioData(b))
        .then((buf) => buf && (buffers[name] = buf))
        .catch(() => {});
  } catch {
    ac = null;
  }
  return ac;
}
// Browsers start audio only after the first click or key press.
['pointerdown', 'keydown'].forEach((e) => window.addEventListener(e, () => audio()?.resume?.(), { once: true, passive: true }));
function tone(freq, dur = 0.06, type = 'sine', vol = 0.05, slide = 0) {
  const a = audio();
  if (!a || muted) return;
  const t = a.currentTime;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}
const lastPlayed = {};
function sample(name, { vol = 1, rate = 1, fallback } = {}) {
  const a = audio();
  if (!a || muted) return;
  const buf = buffers[name];
  if (!buf) return fallback?.();
  // the same sound at most every 40 ms, so fast games don't turn into noise
  const now = performance.now();
  if (now - (lastPlayed[name] || 0) < 40) return;
  lastPlayed[name] = now;
  const src = a.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(g).connect(master);
  src.start();
  return src;
}
let lastTick = 0;
export const sfx = {
  get muted() {
    return muted;
  },
  toggle() {
    muted = !muted;
    keep('casinoMuted', muted ? '1' : '0');
    if (!muted) audio()?.resume?.();
    return muted;
  },
  click: () => tone(620, 0.035, 'triangle', 0.04),
  tick: (pitch = 1) => {
    const now = performance.now();
    if (now - lastTick < 28) return;
    lastTick = now;
    tone(1100 * pitch + Math.random() * 120, 0.025, 'square', 0.012);
  },
  chip: () => sample('chip', { vol: 0.8, rate: 0.95 + Math.random() * 0.1, fallback: () => tone(900, 0.04, 'triangle', 0.05) }),
  deal: () => sample('deal', { vol: 0.8, rate: 0.95 + Math.random() * 0.15, fallback: () => tone(300, 0.06, 'triangle', 0.04, 200) }),
  flip: () => sample('flip', { vol: 0.8, fallback: () => tone(300, 0.06, 'triangle', 0.04, 200) }),
  win: () => sample('win', { vol: 0.7, fallback: () => [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.12, 'triangle', 0.05), i * 70)) }),
  big: () => sample('big', { vol: 0.85, fallback: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.06), i * 80)) }),
  lose: () => sample('lose', { vol: 0.55, fallback: () => tone(220, 0.2, 'sine', 0.04, -80) }),
  gem: () => sample('gem', { vol: 0.6, rate: 0.95 + Math.random() * 0.1, fallback: () => tone(1320, 0.1, 'sine', 0.05) }),
  boom: () => sample('boom', { vol: 0.8, fallback: () => tone(120, 0.35, 'sawtooth', 0.07, -80) }),
  cash: () => sample('cash', { vol: 0.7, fallback: () => tone(1500, 0.08, 'square', 0.03) }),
  launch: () => sample('launch', { vol: 0.5 }),
  crash: () => sample('crash', { vol: 0.8, fallback: () => tone(120, 0.35, 'sawtooth', 0.07, -80) }),
  dice: () => sample('dice', { vol: 0.7 }),
  coin: () => sample('coin', { vol: 0.7 }),
  spin: () => sample('spin', { vol: 0.45 }),
  stop: () => sample('stop', { vol: 0.6, rate: 0.95 + Math.random() * 0.1, fallback: () => tone(160, 0.06, 'square', 0.04) }),
  wheel: () => sample('wheel', { vol: 0.6 }),
  roll: () => sample('roll', { vol: 0.6 }),
  scratch: () => sample('scratch', { vol: 0.35, rate: 0.9 + Math.random() * 0.2 }),
  open: () => sample('open', { vol: 0.7 }),
  pop: () => sample('pop', { vol: 0.6, rate: 0.9 + Math.random() * 0.25, fallback: () => tone(700 + Math.random() * 300, 0.05, 'sine', 0.05) }),
};

// ── Icons (stroke, 24px grid) ─────────────────────────────
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  star: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  cards: 'M7 4h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM11 9l1.5 2L11 13l-1.5-2z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  sound: 'M4 9v6h4l5 4V5L8 9zm12.5 0a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12',
  mute: 'M4 9v6h4l5 4V5L8 9zm12 0 5 6m0-6-5 6',
  out: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4',
  back: 'M15 18l-6-6 6-6',
  trophy: 'M8 4h8v4a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 3m8-3h3a3 3 0 0 1-3 3M12 12v4m-4 4h8m-6-4h4',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  check: 'M5 12.5 10 17 19 7',
  coins: 'M8 8a5 2.5 0 1 0 10 0A5 2.5 0 1 0 8 8zm0 0v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V8M4 13v4c0 1.4 2.2 2.5 5 2.5 1.4 0 2.7-.3 3.6-.8M4 13c0-1.4 2.2-2.5 5-2.5',
  dice: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm3.5 4.5h.01m7 0h.01M12 12h.01m-3.5 3.5h.01m7 0h.01',
  info: 'M12 8h.01M11 12h1v5h1M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
};
export const icon = (name, attrs = {}) => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...attrs }, h('path', { d: ICONS[name] || '' }));
export const coin = (cls = 'coin') => h('img', { class: cls, src: asset('img/coin.webp'), alt: '', draggable: 'false' });

// ── Controls ──────────────────────────────────────────────
export const field = (label, el, note) => h('div', { class: 'fld' }, h('div', { class: 'lab' }, h('span', {}, label), note != null ? h('span', {}, note) : null), el);
export function stat(k, v = '—') {
  const val = h('div', { class: 'v' }, v);
  return { el: h('div', { class: 'stat' }, h('div', { class: 'k' }, k), val), set: (x) => (val.textContent = x), val };
}

/** Bet amount: coin, number, ½ 2× Max. Remembers the last bet per game. */
export function betBox(ctx, { label = 'Bet amount', key = ctx.game } = {}) {
  const { minBet, maxBet } = ctx.casino;
  const start = Math.max(minBet, Number(load(`casinoBet:${key}`)) || minBet);
  const input = h('input', { inputmode: 'numeric', value: String(start), 'aria-label': label });
  const clamp = (v) => {
    let n = Math.floor(Number(String(v).replace(/[^\d.]/g, '')) || 0);
    if (maxBet > 0) n = Math.min(n, maxBet);
    return Math.max(minBet, n);
  };
  const listeners = [];
  const set = (v) => {
    input.value = String(clamp(v));
    keep(`casinoBet:${key}`, input.value);
    listeners.forEach((f) => f());
  };
  input.addEventListener('change', () => set(input.value));
  input.addEventListener('input', () => listeners.forEach((f) => f()));
  const btns = [
    h('button', { type: 'button', title: 'Half', onclick: () => (sfx.click(), set(Math.floor(clamp(input.value) / 2))) }, '½'),
    h('button', { type: 'button', title: 'Double', onclick: () => (sfx.click(), set(clamp(input.value) * 2)) }, '2×'),
    h('button', { type: 'button', title: 'Everything you have', onclick: () => (sfx.click(), set(ctx.balance())) }, 'Max'),
  ];
  const note = maxBet ? `${short(minBet)}–${short(maxBet)}` : `min ${short(minBet)}`;
  return {
    el: field(label, h('div', { class: 'amt' }, coin(), input, btns), note),
    get value() {
      return clamp(input.value);
    },
    set value(v) {
      set(v);
    },
    lock(on) {
      input.disabled = on;
      btns.forEach((b) => (b.disabled = on));
    },
    onChange: (f) => listeners.push(f),
  };
}

/** Segmented control. */
export function seg(options, value, onChange) {
  let cur = value;
  const buttons = options.map((o) => {
    const opt = typeof o === 'object' ? o : { value: o, label: o };
    const b = h('button', { type: 'button', class: String(opt.value) === String(cur) ? 'on' : '', onclick: () => api.set(opt.value, true) }, opt.label);
    b.dataset.v = String(opt.value);
    return b;
  });
  const api = {
    el: h('div', { class: 'seg' }, buttons),
    get value() {
      return cur;
    },
    set(v, user) {
      if (user && String(v) !== String(cur)) sfx.click();
      cur = v;
      buttons.forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
      if (user) onChange?.(v);
    },
    lock(on) {
      buttons.forEach((b) => (b.disabled = on));
    },
  };
  return api;
}

/** Manual / Auto play for instant games. `play()` makes one bet and resolves to { cost, payout } or null. */
export function autoplay(ctx, { button, play, lock, label = 'Bet' }) {
  const mode = seg([{ value: 'manual', label: 'Manual' }, { value: 'auto', label: 'Auto' }], 'manual', () => draw());
  const count = h('input', { class: 'inp', inputmode: 'numeric', value: load('casinoAutoCount', '10') });
  const stopWin = h('input', { class: 'inp', inputmode: 'numeric', placeholder: 'off', value: '' });
  const stopLoss = h('input', { class: 'inp', inputmode: 'numeric', placeholder: 'off', value: '' });
  const box = h('div', { class: 'auto hidden' }, field('Number of bets', count, '0 = until stopped'), h('div', { class: 'two' }, field('Stop at profit', stopWin), field('Stop at loss', stopLoss)));
  let running = false;
  let busy = false;
  const draw = () => {
    box.classList.toggle('hidden', mode.value !== 'auto');
    button.textContent = mode.value === 'auto' ? (running ? 'Stop autoplay' : 'Start autoplay') : label;
    button.className = `btn lg ${running ? '' : 'gold'}`;
  };
  async function run() {
    running = true;
    mode.lock(true);
    [count, stopWin, stopLoss].forEach((i) => (i.disabled = true));
    lock?.(true);
    draw();
    keep('casinoAutoCount', count.value);
    const n = Math.max(0, Math.floor(Number(count.value) || 0));
    const win = Number(stopWin.value) || 0;
    const loss = Number(stopLoss.value) || 0;
    let net = 0;
    for (let i = 0; running && (n === 0 || i < n); i++) {
      const r = await play();
      if (!r) break;
      net += r.payout - r.cost;
      if (n) count.value = String(n - i - 1);
      if ((win && net >= win) || (loss && -net >= loss)) break;
      await sleep(250);
    }
    if (n) count.value = String(n);
    running = false;
    mode.lock(false);
    [count, stopWin, stopLoss].forEach((i) => (i.disabled = false));
    lock?.(false);
    draw();
    if (net) ctx.toast(`Autoplay finished: ${signed(net)} ${ctx.casino.currency}`);
  }
  button.addEventListener('click', async () => {
    if (mode.value === 'auto') return running ? ((running = false), draw()) : run();
    if (busy) return;
    busy = true;
    await play();
    busy = false;
  });
  draw();
  return {
    mode: mode.el,
    box,
    get running() {
      return running;
    },
  };
}

// ── Game layout: controls on the left, the board filling the rest ──
export function gameLayout(el, ctx, { controls, stage, stageClass = '' }) {
  const bar = h('div', { class: 'stage-bar' }, h('span', { class: 'badge' }, ctx.meta.name), ctx.meta.fixedOdds ? h('span', { class: 'badge' }, 'Table odds') : h('span', { class: 'badge' }, 'RTP ', h('b', {}, `${ctx.casino.returnPercent}%`)));
  const body = h('div', { class: 'stage-body' }, stage);
  const stageEl = h('div', { class: `panel stage ${stageClass}` }, bar, body);
  put(el, h('div', { class: 'gwrap' }, h('div', { class: 'panel ctl' }, controls), stageEl));
  return { bar, body, stage: stageEl };
}

/** A row of recent results in the stage bar. kind: true (win), 'g' (gold) or false. */
export function history(bar) {
  const el = h('div', { class: 'hist' });
  bar.append(el);
  return {
    push(label, kind) {
      el.append(h('div', { class: `h ${kind === true ? 'w' : kind || ''}` }, label));
      while (el.children.length > 12) el.firstChild.remove();
    },
  };
}

/** The result bubble over a board. */
export function pop(stage) {
  const m = h('div', { class: 'm' });
  const p = h('div', { class: 'p' });
  const el = h('div', { class: 'pop' }, m, p);
  stage.append(el);
  let timer = 0;
  return {
    show(mult, amount, { lose = false, gold = false, text, sub } = {}) {
      m.textContent = text || fmtMult(mult);
      p.textContent = sub ?? (amount == null ? '' : lose ? signed(-amount) : `+${fmt(amount)}`);
      el.className = `pop show${lose ? ' lose' : ''}${gold ? ' gold' : ''}`;
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove('show'), 1700);
    },
    hide: () => el.classList.remove('show'),
  };
}

/** Full-screen confetti and a counting total for big wins. */
export function celebrate(mult, amount, label2 = 'profit') {
  sfx.big();
  const canvas = h('canvas', { class: 'celebrate' });
  const label = mult >= 100 ? 'Mega win' : mult >= 25 ? 'Huge win' : 'Big win';
  const a = h('div', { class: 'a' }, '0');
  const box = h('div', { class: 'bigwin' }, h('div', { class: 'l' }, label), a, h('div', { class: 'x' }, `${fmtMult(mult)} · ${label2}`));
  document.body.append(canvas, box);
  requestAnimationFrame(() => box.classList.add('show'));
  countUp(a, amount, 1400);
  const g = canvas.getContext('2d');
  const dpr = devicePixelRatio || 1;
  const W = (canvas.width = innerWidth * dpr);
  const H = (canvas.height = innerHeight * dpr);
  const colors = ['#f5b83d', '#ffd27a', '#ffffff', '#22c77a', '#c98d1c'];
  const parts = Array.from({ length: 170 }, () => ({ x: W / 2 + (Math.random() - 0.5) * W * 0.2, y: H * 0.45, vx: (Math.random() - 0.5) * 26 * dpr, vy: (-Math.random() * 22 - 6) * dpr, s: (4 + Math.random() * 6) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: colors[(Math.random() * colors.length) | 0] }));
  const t0 = performance.now();
  const step = (now) => {
    const t = now - t0;
    g.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.55 * dpr;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.globalAlpha = Math.max(0, 1 - t / 3200);
      g.fillStyle = p.c;
      g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      g.restore();
    }
    if (t < 3200) requestAnimationFrame(step);
    else canvas.remove();
  };
  requestAnimationFrame(step);
  setTimeout(() => box.classList.remove('show'), 2600);
  setTimeout(() => box.remove(), 3100);
}

/** Show a finished play: bubble for wins, celebration for big ones. Returns the multiplier. */
export function showResult(p, res, { lossText } = {}) {
  const staked = res.cost ?? res.staked ?? 0;
  const payout = res.payout || 0;
  const mult = staked ? payout / staked : 0;
  if (payout > staked) {
    p.show(mult, payout, { gold: mult >= 10 });
    if (mult >= 10) celebrate(mult, payout - staked);
    else sfx.win();
  } else if (payout === staked) {
    p.show(1, null, { text: 'Push', sub: `${fmt(payout)} back` });
    sfx.click();
  } else if (payout > 0) {
    p.show(mult, staked - payout, { lose: true, sub: `${fmt(payout)} back` });
  } else {
    if (lossText) p.show(0, staked, { lose: true, text: lossText });
    sfx.lose();
  }
  return mult;
}

// ── Playing cards ─────────────────────────────────────────
const RANK = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
/** A playing card. c = { rank 1–13, suit } or null (face down). w: px number or a CSS length. */
export function card(c, { w = 84, deal = true } = {}) {
  const el = h('div', { class: `pc${deal ? ' deal' : ''}`, style: { '--w': typeof w === 'number' ? `${w}px` : w } });
  el.append(h('div', { class: 'in' }, h('div', { class: 'f' }), h('div', { class: 'b', style: { backgroundImage: `url(${asset('img/cardback.webp')})` } })));
  setCard(el, c);
  return el;
}
/** Turn a card face up to `c` (or face down with null). */
export function setCard(el, c) {
  const face = el.querySelector('.f');
  el.classList.toggle('down', !c);
  if (!c) return el;
  const r = RANK[c.rank] || String(c.rank);
  el.classList.toggle('red', c.suit === '♥' || c.suit === '♦');
  put(face, h('div', { class: 'c1' }, r, h('i', {}, c.suit)), h('div', { class: 'mid' }, c.suit), h('div', { class: 'c2' }, r, h('i', {}, c.suit)));
  return el;
}

/** Symbol art shared by slots, scratch and cases. */
export const symbolImg = (name, cls = '') => h('img', { class: cls, src: asset(`img/sym-${name}.webp`), alt: name, draggable: 'false' });
