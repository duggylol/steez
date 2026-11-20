import { h, put, fmt, fmtMult, short, stat, field, gameLayout, history, pop, showResult, sfx, tween, ease, css, sleep } from '../ui.js';

// Casino chips shared by roulette and baccarat: same text in both files.
css('chips', `
.chip { --cc: var(--gold); --ci: var(--gold-ink); position: relative; width: var(--cs, 40px); aspect-ratio: 1; border-radius: 50%; flex: none; display: grid; place-items: center; font-family: var(--mono); font-weight: 700; color: var(--ci); font-size: calc(var(--cs, 40px) * .3); letter-spacing: -.04em; line-height: 1;
  background: radial-gradient(circle, var(--cc) 0 57%, transparent 58%), repeating-conic-gradient(from 7.5deg, var(--cc) 0 30deg, rgba(255,255,255,.92) 30deg 45deg);
  box-shadow: inset 0 0 0 calc(var(--cs, 40px) * .045) rgba(0,0,0,.18), 0 calc(var(--cs, 40px) * .06) 0 rgba(0,0,0,.45), 0 4px 10px -2px rgba(0,0,0,.6); }
.chip::after { content: ''; position: absolute; inset: 21%; border-radius: 50%; border: 1.5px dashed rgba(255,255,255,.55); pointer-events: none; }
.chip.c0 { --cc: #eef1f7; --ci: #141a26; }
.chip.c0 { background: radial-gradient(circle, var(--cc) 0 57%, transparent 58%), repeating-conic-gradient(from 7.5deg, var(--cc) 0 30deg, var(--text-3) 30deg 45deg); }
.chip.c0::after { border-color: rgba(20,26,38,.35); }
.chip.c1 { --cc: var(--lose); --ci: #fff; }
.chip.c2 { --cc: var(--win); --ci: #04170d; }
.chip.c3 { --cc: #141a26; --ci: var(--gold-hi); }
.chip.c3 { background: radial-gradient(circle, var(--cc) 0 57%, transparent 58%), repeating-conic-gradient(from 7.5deg, var(--cc) 0 30deg, var(--gold) 30deg 45deg); }
.chip.c4 { --cc: var(--gold); --ci: var(--gold-ink); }
.chip.c5 { --cc: var(--gold-lo); --ci: #fff; }
.chip.c5 { background: radial-gradient(circle, var(--cc) 0 57%, transparent 58%), repeating-conic-gradient(from 7.5deg, var(--cc) 0 30deg, #141a26 30deg 45deg); }
.chip-pick { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; justify-items: center; }
.chip-pick button { --cs: min(44px, 100%); padding: 0; border: 0; background: none; width: 100%; display: grid; place-items: center; transition: transform .15s cubic-bezier(.2,1.6,.4,1), opacity .15s, filter .15s; opacity: .62; }
.chip-pick button:hover:not(:disabled) { opacity: .9; transform: translateY(-2px); }
.chip-pick button.on { opacity: 1; transform: translateY(-4px) scale(1.06); filter: drop-shadow(0 0 10px rgba(245,184,61,.55)); }
.chip-pick button:disabled { cursor: not-allowed; opacity: .3; }
.chip-pick .chip { width: 100%; max-width: 46px; font-size: 11.5px; }
.stack { position: absolute; left: 50%; top: 50%; width: var(--cs); height: var(--cs); transform: translate(-50%, -50%); pointer-events: none; z-index: 3; animation: stackIn .22s cubic-bezier(.2,1.6,.4,1); }
.stack .chip { position: absolute; left: 0; top: calc(var(--k) * var(--cs) * -.1); }
.stack .chip:not(:last-child) { font-size: 0; }
.stack.won .chip:last-child { box-shadow: 0 0 0 2px var(--gold-hi), 0 0 18px rgba(245,184,61,.8); }
.stack.lost { opacity: 0; transform: translate(-50%, -30%) scale(.7); transition: opacity .5s .3s, transform .5s .3s; }
@keyframes stackIn { from { transform: translate(-50%, -90%) scale(.6); opacity: 0; } }
.tbtns { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.tbtns .btn { padding: 0 8px; }
`);

css('roulette', `
.rl { position: absolute; inset: 50px 12px 12px; display: flex; align-items: center; justify-content: center; gap: 14px; }
.rl.stack-v { flex-direction: column; }
.rl-wheel { position: relative; flex: none; }
.rl-wheel canvas { width: 100%; height: 100%; display: block; }
.rl-res { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(.6); width: 22%; aspect-ratio: 1; border-radius: 50%; display: grid; place-items: center; font-family: var(--mono); font-weight: 700; color: #fff; opacity: 0; transition: transform .35s cubic-bezier(.2,1.6,.4,1), opacity .2s; box-shadow: 0 0 0 3px var(--gold), 0 0 40px rgba(245,184,61,.5); pointer-events: none; }
.rl-res.show { transform: translate(-50%, -50%) scale(1); opacity: 1; }
.rl-res.red { background: var(--lose); } .rl-res.black { background: #141a26; } .rl-res.green { background: var(--win); }
.rl-tbl { --u: 40px; flex: none; display: grid; gap: max(2px, calc(var(--u) * .07)); padding: max(5px, calc(var(--u) * .14)); border-radius: max(10px, calc(var(--u) * .3)); user-select: none;
  background: linear-gradient(rgba(13,22,40,.6), rgba(13,22,40,.6)), radial-gradient(120% 90% at 50% 10%, #18243c, #0c1424); box-shadow: inset 0 0 0 1.5px rgba(245,184,61,.55), 0 20px 40px -20px #000; }
.rl-tbl.h { grid-template-columns: repeat(14, minmax(0, 1fr)); grid-template-rows: repeat(3, minmax(0, 1fr)) repeat(2, minmax(0, .8fr)); }
.rl-tbl.v { grid-template-columns: repeat(2, minmax(0, .8fr)) repeat(3, minmax(0, 1fr)); grid-template-rows: minmax(0, 1fr) repeat(12, minmax(0, 1fr)) minmax(0, 1fr); }
.rl-c { position: relative; min-width: 0; min-height: 0; border: 1px solid rgba(245,184,61,.28); border-radius: max(4px, calc(var(--u) * .14)); padding: 0; color: var(--text); font-family: var(--mono); font-weight: 700; font-size: calc(var(--u) * .4); display: grid; place-items: center; background: transparent; transition: background .15s, box-shadow .2s, filter .15s, opacity .3s; }
.rl-c:hover:not(:disabled) { background-color: rgba(245,184,61,.12); filter: brightness(1.2); }
.rl-c:disabled { cursor: default; }
.rl-c .n { width: 74%; max-width: calc(var(--u) * 1.1); aspect-ratio: 1; border-radius: 50%; display: grid; place-items: center; box-shadow: inset 0 1px 0 rgba(255,255,255,.18), 0 2px 4px rgba(0,0,0,.4); }
.rl-tbl.v .rl-c .n { width: auto; height: 82%; }
.rl-c.red .n { background: var(--lose); }
.rl-c.black .n { background: #141a26; border: 1px solid rgba(255,255,255,.08); }
.rl-c.green { background: rgba(34,199,122,.18); }
.rl-c.green .n { background: var(--win); color: #04170d; }
.rl-c.out { font-family: Geist, sans-serif; font-weight: 700; color: var(--gold-hi); font-size: calc(var(--u) * .3); letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
.rl-c.out.mono { font-family: var(--mono); }
.rl-c .dia { width: 52%; max-height: 70%; overflow: visible; }
.rl-c .dia polygon { stroke-width: 1.2; stroke-linejoin: round; }
.rl-c .dia.red polygon { fill: var(--lose); stroke: rgba(255,255,255,.35); } .rl-c .dia.black polygon { fill: #141a26; stroke: var(--gold); }
.rl-tbl.v .rl-c .dia { width: 64%; }
.rl-c.hit { background: rgba(245,184,61,.25); box-shadow: 0 0 0 2px var(--gold-hi), 0 0 26px rgba(245,184,61,.75); z-index: 2; animation: rlHit 1s ease-in-out infinite alternate; }
.rl-c.won { background: rgba(245,184,61,.14); box-shadow: inset 0 0 0 1.5px var(--gold); }
@keyframes rlHit { to { box-shadow: 0 0 0 2px var(--gold-hi), 0 0 40px 4px rgba(245,184,61,.6); } }
.rl-tbl.v .rl-c.vt { writing-mode: vertical-rl; transform: rotate(180deg); }
`);

const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const colorOf = (n) => (n === 0 ? 'green' : RED.includes(n) ? 'red' : 'black');
const HIT = {
  straight: (n, v) => n === v,
  red: (n) => RED.includes(n),
  black: (n) => n > 0 && !RED.includes(n),
  odd: (n) => n > 0 && n % 2 === 1,
  even: (n) => n > 0 && n % 2 === 0,
  low: (n) => n >= 1 && n <= 18,
  high: (n) => n >= 19,
  dozen: (n, v) => n > 0 && Math.ceil(n / 12) === v,
  column: (n, v) => n > 0 && ((n - 1) % 3) + 1 === v,
};

/** Chip denominations for this casino, and a stack of chips for an amount. */
export function chipSet(casino) {
  const base = Math.max(1, casino.minBet);
  return [1, 5, 10, 50, 100, 500].map((x) => x * base).filter((v, i) => i === 0 || !casino.maxBet || v <= casino.maxBet);
}
export function chipEl(value, denoms, size) {
  let i = denoms.length - 1;
  while (i > 0 && denoms[i] > value) i--;
  return h('div', { class: `chip c${i}`, style: size ? { '--cs': size } : null }, short(value));
}
export function stackEl(amount, denoms) {
  const parts = [];
  let left = amount;
  for (let i = denoms.length - 1; i >= 0 && parts.length < 5; i--) while (left >= denoms[i] && parts.length < 5) (parts.push(i), (left -= denoms[i]));
  if (!parts.length) parts.push(0);
  parts.reverse();
  const s = h('div', { class: 'stack' });
  parts.forEach((ci, k) => s.append(h('div', { class: `chip c${ci}`, style: { '--k': k } }, k === parts.length - 1 ? short(amount) : '')));
  return s;
}

export function mount(el, ctx) {
  const denoms = chipSet(ctx.casino);
  let chip = denoms[Math.min(1, denoms.length - 1)];
  const placed = new Map(); // key → { type, value, amount }
  const undo = [];
  let last = []; // the previous spin's chips, for Rebet
  let busy = false;
  let alive = true;
  let wheelAngle = 0;
  let ball = null; // { angle, r } in wheel radii
  let mode = { side: true, o: 'v' };

  // ── Controls ──
  const chipBtns = denoms.map((v) => {
    const b = h('button', { type: 'button', title: fmt(v), onclick: () => ((chip = v), sfx.chip(), drawPick()) }, chipEl(v, denoms));
    b.dataset.v = v;
    return b;
  });
  const drawPick = () => chipBtns.forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === chip));
  const sTotal = stat('Total bet', '0');
  const sLast = stat('Last win', '—');
  const spin = h('button', { class: 'btn lg gold', onclick: play }, 'Spin');
  const undoBtn = h('button', { class: 'btn', onclick: takeBack }, 'Undo');
  const clearBtn = h('button', { class: 'btn', onclick: () => (sfx.click(), clear()) }, 'Clear');
  const rebetBtn = h('button', { class: 'btn', onclick: rebet }, 'Rebet');

  // ── The wheel ──
  const canvas = h('canvas');
  const resEl = h('div', { class: 'rl-res' });
  const wheel = h('div', { class: 'rl-wheel' }, canvas, resEl);
  const g = canvas.getContext('2d');

  // ── The table ──
  const table = h('div', { class: 'rl-tbl v' });
  const cells = new Map(); // key → { el, type, value }
  function cell(key, type, value, cls, label) {
    const b = h('button', { class: `rl-c ${cls}`, type: 'button', onclick: () => place(key, type, value), 'aria-label': `${type} ${value ?? ''}`.trim() }, label);
    cells.set(key, { el: b, type, value });
    return b;
  }
  cell('straight:0', 'straight', 0, 'green', h('span', { class: 'n' }, '0'));
  for (let n = 1; n <= 36; n++) cell(`straight:${n}`, 'straight', n, colorOf(n), h('span', { class: 'n' }, String(n)));
  [1, 2, 3].forEach((c) => cell(`column:${c}`, 'column', c, 'out mono', '2:1'));
  ['1st 12', '2nd 12', '3rd 12'].forEach((t, i) => cell(`dozen:${i + 1}`, 'dozen', i + 1, 'out', t));
  const OUT = [['low', '1–18'], ['even', 'Even'], ['red', null], ['black', null], ['odd', 'Odd'], ['high', '19–36']];
  OUT.forEach(([t, label]) => cell(`${t}:`, t, null, 'out', label ?? h('svg', { class: `dia ${t}`, viewBox: '-1 -1 18 12' }, h('polygon', { points: '8,0 16,5 8,10 0,5' }))));
  table.append(...[...cells.values()].map((c) => c.el));

  /** Place every cell for the horizontal (14 × 5) or vertical (5 × 14) table. */
  function arrange(o) {
    table.className = `rl-tbl ${o}`;
    const at = (key, a) => (cells.get(key).el.style.gridArea = a);
    if (o === 'h') {
      at('straight:0', '1 / 1 / 4 / 2');
      for (let n = 1; n <= 36; n++) {
        const c = Math.ceil(n / 3);
        const r = 3 - ((n - 1) % 3);
        at(`straight:${n}`, `${r} / ${c + 1} / ${r + 1} / ${c + 2}`);
      }
      [3, 2, 1].forEach((col, r) => at(`column:${col}`, `${r + 1} / 14 / ${r + 2} / 15`));
      [1, 2, 3].forEach((d) => at(`dozen:${d}`, `4 / ${2 + (d - 1) * 4} / 5 / ${6 + (d - 1) * 4}`));
      OUT.forEach(([t], i) => at(`${t}:`, `5 / ${2 + i * 2} / 6 / ${4 + i * 2}`));
      cells.forEach((c) => c.el.classList.remove('vt'));
    } else {
      at('straight:0', '1 / 3 / 2 / 6');
      for (let n = 1; n <= 36; n++) {
        const r = Math.ceil(n / 3) + 1;
        const c = ((n - 1) % 3) + 3;
        at(`straight:${n}`, `${r} / ${c} / ${r + 1} / ${c + 1}`);
      }
      [1, 2, 3].forEach((col) => at(`column:${col}`, `14 / ${col + 2} / 15 / ${col + 3}`));
      [1, 2, 3].forEach((d) => {
        at(`dozen:${d}`, `${2 + (d - 1) * 4} / 2 / ${6 + (d - 1) * 4} / 3`);
        cells.get(`dozen:${d}`).el.classList.add('vt');
      });
      OUT.forEach(([t], i) => {
        at(`${t}:`, `${2 + i * 2} / 1 / ${4 + i * 2} / 2`);
        cells.get(`${t}:`).el.classList.toggle('vt', !!OUT[i][1]);
      });
    }
  }

  const root = h('div', { class: 'rl' }, wheel, table);

  /** Fit the wheel and the table to the stage: side by side when it's wide, stacked when it's narrow. */
  function layout() {
    const W = root.clientWidth;
    const H = root.clientHeight;
    if (!W || !H) return;
    const G = 14;
    let D, tw, th, side;
    if (W >= H * 0.95) {
      side = true;
      D = Math.min(H, W * 0.56);
      tw = Math.min(W - D - G, H * 0.72);
      if (tw < 160) (tw = Math.min(W * 0.5, 160)), (D = Math.min(H, W - tw - G));
      const cw = tw / 4.6;
      th = Math.min(H, cw * 14 * 0.9);
      if (th < H && D < H) D = Math.min(H, W - tw - G);
      arrange('v');
      table.style.setProperty('--u', `${Math.min(cw * 0.8, th / 14)}px`);
    } else {
      side = false;
      tw = W;
      const cw = W / 14;
      const ch = Math.min(cw * 1.9, (H * 0.56) / 4.6);
      th = ch * 4.6;
      D = Math.min(W, H - th - G);
      arrange('h');
      table.style.setProperty('--u', `${Math.min(cw * 1.05, ch)}px`);
    }
    mode = { side };
    root.classList.toggle('stack-v', !side);
    wheel.style.width = wheel.style.height = `${Math.floor(D)}px`;
    table.style.width = `${Math.floor(tw)}px`;
    table.style.height = `${Math.floor(th)}px`;
    resEl.style.fontSize = `${Math.max(14, D * 0.085)}px`;
    paint();
  }

  // ── Painting the wheel ──
  const tok = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  let C = null;
  function paint() {
    const S = Math.round(wheel.clientWidth * (window.devicePixelRatio || 1));
    if (!S) return;
    if (canvas.width !== S) canvas.width = canvas.height = S;
    C ||= { red: tok('--lose'), green: tok('--win'), gold: tok('--gold'), hi: tok('--gold-hi'), lo: tok('--gold-lo'), bg: tok('--bg'), s3: tok('--surface-3'), s2: tok('--surface-2'), black: '#141a26' };
    const c = S / 2;
    const R = S / 2 - S * 0.01;
    const n = ORDER.length;
    const step = (2 * Math.PI) / n;
    g.clearRect(0, 0, S, S);
    // outer frame: dark bowl with a gold rim
    let gr = g.createRadialGradient(c, c, R * 0.7, c, c, R);
    gr.addColorStop(0, C.s2);
    gr.addColorStop(1, C.bg);
    g.beginPath();
    g.arc(c, c, R, 0, Math.PI * 2);
    g.fillStyle = gr;
    g.fill();
    g.lineWidth = S * 0.012;
    gr = g.createLinearGradient(0, 0, S, S);
    gr.addColorStop(0, C.hi);
    gr.addColorStop(0.5, C.gold);
    gr.addColorStop(1, C.lo);
    g.strokeStyle = gr;
    g.stroke();
    // ball track
    g.beginPath();
    g.arc(c, c, R * 0.86, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(245,184,61,.25)';
    g.lineWidth = S * 0.004;
    g.stroke();
    g.save();
    g.translate(c, c);
    g.rotate(wheelAngle);
    const r1 = R * 0.8;
    const r0 = R * 0.56;
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + i * step - step / 2;
      g.beginPath();
      g.arc(0, 0, r1, a0, a0 + step);
      g.arc(0, 0, r0, a0 + step, a0, true);
      g.closePath();
      g.fillStyle = C[colorOf(ORDER[i])];
      g.fill();
      g.strokeStyle = gr;
      g.lineWidth = S * 0.0025;
      g.stroke();
      g.save();
      g.rotate(a0 + step / 2 + Math.PI / 2);
      g.fillStyle = '#fff';
      g.font = `700 ${Math.round(S * 0.036)}px "Geist Mono", monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(ORDER[i]), 0, -r1 * 0.88);
      g.restore();
    }
    // pocket frets
    g.beginPath();
    g.arc(0, 0, r0, 0, Math.PI * 2);
    g.lineWidth = S * 0.006;
    g.strokeStyle = gr;
    g.stroke();
    // the cone and turret
    const cone = g.createRadialGradient(-r0 * 0.3, -r0 * 0.3, r0 * 0.05, 0, 0, r0);
    cone.addColorStop(0, C.s3);
    cone.addColorStop(1, C.bg);
    g.beginPath();
    g.arc(0, 0, r0 * 0.97, 0, Math.PI * 2);
    g.fillStyle = cone;
    g.fill();
    g.strokeStyle = gr;
    g.lineWidth = S * 0.007;
    for (let k = 0; k < 4; k++) {
      g.save();
      g.rotate((k * Math.PI) / 2);
      g.beginPath();
      g.moveTo(0, -r0 * 0.12);
      g.lineTo(0, -r0 * 0.62);
      g.stroke();
      g.beginPath();
      g.arc(0, -r0 * 0.66, S * 0.012, 0, Math.PI * 2);
      g.fillStyle = gr;
      g.fill();
      g.restore();
    }
    g.beginPath();
    g.arc(0, 0, r0 * 0.14, 0, Math.PI * 2);
    g.fillStyle = gr;
    g.fill();
    g.restore();
    if (ball) {
      const bx = c + Math.cos(ball.angle) * ball.r * R;
      const by = c + Math.sin(ball.angle) * ball.r * R;
      const br = S * 0.019;
      const bg = g.createRadialGradient(bx - br * 0.35, by - br * 0.35, br * 0.1, bx, by, br);
      bg.addColorStop(0, '#ffffff');
      bg.addColorStop(1, '#a7b0c3');
      g.beginPath();
      g.arc(bx, by, br, 0, Math.PI * 2);
      g.fillStyle = bg;
      g.shadowColor = 'rgba(0,0,0,.7)';
      g.shadowBlur = S * 0.012;
      g.fill();
      g.shadowBlur = 0;
    }
  }

  // ── Chips ──
  const total = () => [...placed.values()].reduce((s, b) => s + b.amount, 0);
  function drawChips() {
    for (const [key, c] of cells) {
      c.el.querySelector('.stack')?.remove();
      const b = placed.get(key);
      if (b) {
        const s = stackEl(b.amount, denoms);
        c.el.append(s);
      }
    }
    const t = total();
    sTotal.set(fmt(t));
    spin.disabled = busy || !placed.size;
    undoBtn.disabled = busy || !undo.length;
    clearBtn.disabled = busy || !placed.size;
    rebetBtn.disabled = busy || !last.length;
    rebetBtn.textContent = placed.size || !last.length ? 'Rebet' : `Rebet ${short(last.reduce((s, b) => s + b.amount, 0))}`;
    chipBtns.forEach((b) => (b.disabled = busy));
    cells.forEach((c) => (c.el.disabled = busy));
    table.style.setProperty('--cs', `calc(var(--u) * .72)`);
  }
  function clearMarks() {
    cells.forEach((c) => c.el.classList.remove('hit', 'won'));
    resEl.classList.remove('show');
  }
  function place(key, type, value) {
    if (busy) return;
    if (ctx.casino.maxBet && total() + chip > ctx.casino.maxBet) return ctx.toast(`The table limit is ${fmt(ctx.casino.maxBet)}.`, true);
    if (total() + chip > ctx.balance()) return ctx.toast('You don’t have enough for another chip.', true);
    clearMarks();
    const b = placed.get(key) || { type, value, amount: 0 };
    b.amount += chip;
    placed.set(key, b);
    undo.push({ key, amount: chip });
    sfx.chip();
    drawChips();
  }
  function takeBack() {
    const u = undo.pop();
    if (!u) return;
    sfx.click();
    const b = placed.get(u.key);
    if (b) {
      b.amount -= u.amount;
      if (b.amount <= 0) placed.delete(u.key);
    }
    drawChips();
  }
  function clear() {
    placed.clear();
    undo.length = 0;
    drawChips();
  }
  function rebet() {
    if (busy || !last.length) return;
    const sum = last.reduce((s, b) => s + b.amount, 0);
    if (sum > ctx.balance()) return ctx.toast('You don’t have enough to rebet.', true);
    if (ctx.casino.maxBet && sum > ctx.casino.maxBet) return ctx.toast(`The table limit is ${fmt(ctx.casino.maxBet)}.`, true);
    clearMarks();
    placed.clear();
    undo.length = 0;
    for (const b of last) {
      const key = `${b.type}:${b.value ?? ''}`;
      placed.set(key, { ...b });
      undo.push({ key, amount: b.amount });
    }
    sfx.chip();
    drawChips();
  }

  // ── A spin ──
  async function play() {
    if (busy || !placed.size) return;
    busy = true;
    clearMarks();
    drawChips();
    const bets = [...placed.values()].map((b) => ({ ...b }));
    const sum = total();
    let res;
    try {
      res = await ctx.bet(sum, { bets }, sum);
    } catch {
      busy = false;
      return drawChips();
    }
    last = bets;
    const d = res.result;
    const n = ORDER.length;
    const step = (2 * Math.PI) / n;
    const idx = ORDER.indexOf(d.number);
    const w0 = wheelAngle;
    const w1 = w0 + Math.PI * 2 * 1.6 + Math.random() * Math.PI * 2;
    const pocket = (w) => -Math.PI / 2 + idx * step + w;
    const b1 = pocket(w1);
    const b0 = b1 - Math.PI * 2 * 5 - Math.random() * 0.6; // the ball runs the other way
    sfx.spin();
    sfx.roll();
    let lastPocket = -1;
    const T = 5200;
    await tween(T, (t) => {
      if (!alive) return;
      wheelAngle = w0 + (w1 - w0) * ease.out(t);
      const eb = 1 - (1 - t) ** 2.6;
      const ang = b0 + (b1 - b0) * eb;
      const drop = Math.max(0, (t - 0.55) / 0.45);
      const bounce = t > 0.55 && t < 0.92 ? Math.abs(Math.sin(drop * 22)) * 0.035 * (1 - drop) : 0;
      ball = { angle: ang, r: 0.9 - 0.22 * ease.out(Math.min(1, drop * 1.4)) + bounce };
      const pk = Math.floor(((ang - wheelAngle + Math.PI / 2 + step / 2) / step) % n);
      if (t > 0.5 && pk !== lastPocket) {
        lastPocket = pk;
        sfx.tick(0.7 + (1 - t) * 0.6);
      }
      paint();
    });
    if (!alive) return ctx.settle(res);
    wheelAngle %= Math.PI * 2;
    ball = { angle: pocket(wheelAngle), r: 0.68 };
    paint();
    sfx.stop();
    // settle: show the number, mark the table
    resEl.textContent = String(d.number);
    resEl.className = `rl-res show ${d.color}`;
    cells.get(`straight:${d.number}`)?.el.classList.add('hit');
    for (const [, c] of cells) if (c.type !== 'straight' && HIT[c.type](d.number, c.value)) c.el.classList.add('won');
    for (const r of d.results) {
      const s = cells.get(`${r.type}:${r.value ?? ''}`)?.el.querySelector('.stack');
      s?.classList.add(r.win ? 'won' : 'lost');
    }
    hist.push(String(d.number), d.color === 'green' ? 'g' : res.payout > res.cost ? true : false);
    sLast.set(res.payout ? `+${fmt(res.payout)}` : '0');
    showResult(p, res);
    ctx.settle(res);
    // keep the ball spinning slowly in its pocket while the result shows
    await sleep(1500);
    if (!alive) return;
    placed.clear();
    undo.length = 0;
    busy = false;
    drawChips();
  }

  // idle drift
  let raf = 0;
  let prev = performance.now();
  const drift = (now) => {
    const dt = Math.min(50, now - prev);
    prev = now;
    if (!busy) {
      wheelAngle += dt * 0.00012;
      if (ball) ball.angle += dt * 0.00012;
      paint();
    }
    raf = requestAnimationFrame(drift);
  };

  const L = gameLayout(el, ctx, {
    controls: [field('Chip value', h('div', { class: 'chip-pick' }, chipBtns), 'tap to pick'), h('div', { class: 'stats' }, sTotal.el, sLast.el), h('div', { class: 'tbtns' }, undoBtn, clearBtn, rebetBtn), h('div', { class: 'note' }, 'Tap the table to stack chips. Numbers pay 36×, dozens and columns 3×, the rest 2×. Zero loses the outside bets.'), h('div', { class: 'spacer' }), spin],
    stage: root,
  });
  const hist = history(L.bar);
  const p = pop(L.body);
  drawPick();
  drawChips();
  const ro = new ResizeObserver(() => layout());
  ro.observe(root);
  layout();
  raf = requestAnimationFrame(drift);
  const key = (e) => e.code === 'Space' && e.target === document.body && (e.preventDefault(), play());
  document.addEventListener('keydown', key);
  return {
    unmount() {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('keydown', key);
    },
  };
}
