import { h, fmt, fmtMult, betBox, field, stat, seg, autoplay, gameLayout, history, pop, showResult, sfx, css, load, keep } from '../ui.js';

css('plinko', `
.pk { position: absolute; inset: 0; }
.pk canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.pk-range { display: flex; align-items: center; gap: 12px; height: 46px; padding: 0 14px; border-radius: 12px; background: var(--bg-1); border: 1px solid var(--line-2); }
.pk-range b { font-family: var(--mono); min-width: 22px; text-align: right; font-size: 15px; }
`);

// Palette colours used on the canvas.
const C = { gold: [245, 184, 61], goldHi: '#ffd27a', goldLo: '#c98d1c', lose: [239, 75, 95], ink: '#1b1304', peg: '#a7b0c3', bg1: '#0b0f17' };
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c, k = 1) => `rgb(${c.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))).join(',')})`;
/** Short multiplier label for a slot box. */
const label = (m, tight) => (m >= 1000 ? `${+(m / 1000).toFixed(1)}K` : m >= 100 ? String(Math.round(m)) : m >= 10 ? String(+m.toFixed(1)) : tight ? String(+m.toFixed(1)) : String(+m.toFixed(2)));

export function mount(el, ctx) {
  const boards = ctx.meta.boards;
  let risk = load('casinoPlinkoRisk', 'medium');
  let rows = Number(load('casinoPlinkoRows', 12));
  let balls = Number(load('casinoPlinkoBalls', 1));
  if (!boards[`${risk}-${rows}`]) (risk = 'medium'), (rows = 12);
  balls = Math.min(10, Math.max(1, balls || 1));
  let busy = false;
  let dead = false;

  // ── Controls ──
  const bet = betBox(ctx, { label: 'Bet per ball' });
  const go = h('button', { class: 'btn lg gold' }, 'Drop');
  const auto = autoplay(ctx, { button: go, play, lock: (on) => lockAll(on), label: 'Drop' });
  const riskSeg = seg([{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }], risk, (v) => ((risk = v), keep('casinoPlinkoRisk', v), changed()));
  const rowsIn = h('input', { type: 'range', min: 8, max: 16, step: 1, value: String(rows), 'aria-label': 'Rows' });
  const rowsVal = h('b', {}, rows);
  const ballsIn = h('input', { type: 'range', min: 1, max: 10, step: 1, value: String(balls), 'aria-label': 'Balls' });
  const ballsVal = h('b', {}, balls);
  rowsIn.addEventListener('input', () => ((rows = Number(rowsIn.value)), (rowsVal.textContent = rows), keep('casinoPlinkoRows', rows), sfx.tick(), changed()));
  ballsIn.addEventListener('input', () => ((balls = Number(ballsIn.value)), (ballsVal.textContent = balls), keep('casinoPlinkoBalls', balls), sfx.tick(), changed()));
  const sCost = stat('Total bet');
  const sTop = stat('Edge pays');
  bet.onChange(() => changed());

  const canvas = h('canvas');
  const wrap = h('div', { class: 'pk' }, canvas);
  const g = canvas.getContext('2d');

  // ── Animation state ──
  let live = []; // balls in flight
  let floats = []; // "+2.4×" labels rising from the slots
  const bump = {}; // slot → time it was hit
  const flash = new Map(); // "r,j" → time a peg was hit
  let loop = 0;
  const mults = () => boards[`${risk}-${rows}`];

  function changed() {
    sCost.set(fmt(bet.value * balls));
    sTop.set(fmtMult(mults()[0]));
    paint();
  }

  // ── Geometry: the board fills the stage under the bar ──
  function geo() {
    const r = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    }
    const W = r.width;
    const H = r.height;
    const top0 = 54;
    const availH = H - top0 - 14;
    const s = Math.max(8, Math.min((W - 24) / (rows + 2), availH / (0.87 * (rows - 1) + 2.6)));
    const rowH = Math.min(s * (W < 520 ? 1.65 : 1.35), (availH - 2.6 * s) / (rows - 1));
    const used = (rows - 1) * rowH + 2.6 * s;
    const top = top0 + (availH - used) / 2 + s * 0.9;
    const bh = Math.max(16, Math.min(s * 0.78, 46));
    return { dpr, W, H, s, rowH, top, bh, cx: W / 2, pegR: Math.max(2, s * 0.09), ballR: Math.max(3.5, s * 0.21), slotY: top + (rows - 1) * rowH + s * 0.75 };
  }
  const pegX = (G, r, j) => G.cx + (j - (r + 2) / 2) * G.s;
  const slotX = (G, k) => G.cx + (k - rows / 2) * G.s;

  function paint() {
    if (dead) return;
    const G = geo();
    const now = performance.now();
    g.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    g.clearRect(0, 0, G.W, G.H);

    // pegs
    for (let r = 0; r < rows; r++) {
      for (let j = 0; j < r + 3; j++) {
        const x = pegX(G, r, j);
        const y = G.top + r * G.rowH;
        const f = flash.get(`${r},${j}`);
        const age = f ? (now - f) / 380 : 1;
        if (age < 1) {
          g.beginPath();
          g.arc(x, y, G.pegR * (3.2 - age * 1.6), 0, Math.PI * 2);
          g.fillStyle = `rgba(245,184,61,${0.28 * (1 - age)})`;
          g.fill();
        }
        g.beginPath();
        g.arc(x, y, G.pegR * (age < 1 ? 1.45 - age * 0.45 : 1), 0, Math.PI * 2);
        g.fillStyle = age < 1 ? C.goldHi : C.peg;
        g.globalAlpha = age < 1 ? 1 : 0.82;
        g.fill();
        g.globalAlpha = 1;
      }
    }

    // multiplier boxes: gold in the middle, running to --lose at the edges
    const ms = mults();
    const bw = G.s * 0.9;
    const tight = G.s < 34;
    const fs = Math.max(7, Math.min(14, G.s * (tight ? 0.3 : 0.27)));
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${fs}px "Geist Mono", ui-monospace, monospace`;
    for (let k = 0; k <= rows; k++) {
      const t = Math.min(1, Math.abs(k - rows / 2) / (rows / 2)) ** 0.85;
      const col = mix(C.gold, C.lose, t);
      const x = slotX(G, k) - bw / 2;
      const hit = bump[k] ? (now - bump[k]) / 420 : 1;
      const dy = hit < 1 ? Math.sin(hit * Math.PI) * G.bh * 0.32 : 0;
      const rad = Math.min(8, bw * 0.2);
      // 3D lip
      g.fillStyle = rgb(col, 0.55);
      g.beginPath();
      g.roundRect(x, G.slotY + dy + 3, bw, G.bh, rad);
      g.fill();
      const grad = g.createLinearGradient(0, G.slotY + dy, 0, G.slotY + dy + G.bh);
      grad.addColorStop(0, rgb(col, hit < 1 ? 1.25 : 1.1));
      grad.addColorStop(1, rgb(col, hit < 1 ? 1 : 0.88));
      g.fillStyle = grad;
      g.beginPath();
      g.roundRect(x, G.slotY + dy, bw, G.bh, rad);
      g.fill();
      if (hit < 1) {
        g.save();
        g.shadowColor = rgb(col);
        g.shadowBlur = 22 * (1 - hit);
        g.strokeStyle = `rgba(255,255,255,${0.7 * (1 - hit)})`;
        g.lineWidth = 1.5;
        g.stroke();
        g.restore();
      }
      g.fillStyle = t > 0.72 ? '#fff' : C.ink;
      g.fillText(label(ms[k], tight), x + bw / 2, G.slotY + dy + G.bh / 2 + 1);
    }

    // balls
    for (const b of live) {
      const p = ballPos(G, b, now);
      if (!p) continue;
      const gr = g.createRadialGradient(p.x - G.ballR * 0.35, p.y - G.ballR * 0.4, G.ballR * 0.1, p.x, p.y, G.ballR);
      gr.addColorStop(0, '#fff3cf');
      gr.addColorStop(0.35, C.goldHi);
      gr.addColorStop(0.8, '#f5b83d');
      gr.addColorStop(1, C.goldLo);
      g.save();
      g.shadowColor = 'rgba(245,184,61,.75)';
      g.shadowBlur = G.ballR * 2.2;
      g.beginPath();
      g.arc(p.x, p.y, G.ballR, 0, Math.PI * 2);
      g.fillStyle = gr;
      g.fill();
      g.restore();
    }

    // rising labels
    floats = floats.filter((f) => now - f.t < 1100);
    g.font = `700 ${Math.max(11, Math.min(16, G.s * 0.34))}px "Geist Mono", ui-monospace, monospace`;
    for (const f of floats) {
      const a = (now - f.t) / 1100;
      g.globalAlpha = 1 - a * a;
      g.fillStyle = f.color;
      g.fillText(f.text, slotX(G, f.k), G.slotY - 12 - a * G.s * 1.1);
      g.globalAlpha = 1;
    }
  }

  // ── Ball paths: a hop off each peg, falling under gravity to the next ──
  let STEP = 135;
  const FIRST = 200;
  /** Where the ball touches the peg it meets in row r (r = rows means its slot). */
  function contact(G, b, r) {
    const k = r === 0 ? 0 : b.ks[r - 1];
    if (r >= rows) return { x: slotX(G, b.slot), y: G.slotY + G.bh * 0.15 };
    return { x: G.cx + (k - r / 2) * G.s, y: G.top + r * G.rowH - (G.pegR + G.ballR) * 0.92 };
  }
  function ballPos(G, b, now) {
    const t = now - b.start;
    if (t < 0) return null;
    if (t < FIRST) {
      const c = contact(G, b, 0);
      const f = t / FIRST;
      return { x: c.x, y: c.y - G.rowH * 1.2 * (1 - f * f) };
    }
    const tt = t - FIRST;
    const seg = Math.floor(tt / STEP);
    const f = (tt % STEP) / STEP;
    if (seg >= rows) {
      if (!b.landed) land(G, b);
      return null;
    }
    if (b.lastSeg !== seg) {
      b.lastSeg = seg;
      const k = seg === 0 ? 0 : b.ks[seg - 1];
      flash.set(`${seg},${k + 1}`, now);
      sfx.tick(0.8 + seg / rows / 2);
    }
    const a = contact(G, b, seg);
    const c = contact(G, b, seg + 1);
    const A = G.rowH * 0.55;
    return { x: a.x + (c.x - a.x) * f, y: a.y - A * f + (c.y - a.y + A) * f * f };
  }
  function land(G, b) {
    b.landed = true;
    bump[b.slot] = performance.now();
    if (b.mult >= 1) floats.push({ t: performance.now(), k: b.slot, text: fmtMult(b.mult), color: b.mult >= 10 ? C.goldHi : '#22c77a' });
    (b.mult >= 10 ? sfx.win : b.mult >= 1 ? sfx.gem : sfx.pop)();
    hist.push(fmtMult(b.mult), b.mult >= 10 ? 'g' : b.mult >= 1);
    b.done?.();
  }

  function run() {
    paint();
    const now = performance.now();
    const pending = live.some((b) => !b.landed) || floats.length || Object.values(bump).some((t) => now - t < 450) || [...flash.values()].some((t) => now - t < 400);
    loop = pending && !dead ? requestAnimationFrame(run) : 0;
  }

  function lockAll(on) {
    bet.lock(on);
    riskSeg.lock(on);
    rowsIn.disabled = ballsIn.disabled = on;
  }

  async function play() {
    if (busy || dead) return null;
    busy = true;
    if (!auto.running) lockAll(true), (go.disabled = true);
    sfx.click();
    let res;
    try {
      res = await ctx.bet(bet.value, { risk, rows, balls }, bet.value * balls);
    } catch {
      busy = false;
      if (!auto.running) lockAll(false), (go.disabled = false);
      return null;
    }
    STEP = auto.running ? 110 : 135;
    const now = performance.now();
    const spawn = res.result.drops.length > 5 ? 170 : 230;
    const landed = res.result.drops.map((d, i) => {
      let k = 0;
      const b = { ...d, ks: d.path.map((p) => (k += p)), start: now + i * spawn, landed: false, lastSeg: -1 };
      live.push(b);
      return new Promise((r) => (b.done = r));
    });
    sfx.chip();
    if (!loop) loop = requestAnimationFrame(run);
    await Promise.all(landed);
    live = live.filter((b) => !b.landed);
    showResult(p, res);
    ctx.settle(res);
    busy = false;
    if (!auto.running) lockAll(false), (go.disabled = false);
    return res;
  }

  const L = gameLayout(el, ctx, {
    controls: [auto.mode, bet.el, auto.box, field('Risk', riskSeg.el), field('Rows', h('div', { class: 'pk-range' }, rowsIn, rowsVal), '8–16'), field('Balls', h('div', { class: 'pk-range' }, ballsIn, ballsVal), '1–10'), h('div', { class: 'stats' }, sCost.el, sTop.el), h('div', { class: 'spacer' }), go],
    stage: wrap,
  });
  const hist = history(L.bar);
  const p = pop(L.body);
  changed();
  const ro = new ResizeObserver(() => !loop && paint());
  ro.observe(wrap);
  // Fonts may land after the first paint.
  document.fonts?.ready.then(() => !dead && paint());
  const key = (e) => e.code === 'Space' && e.target === document.body && (e.preventDefault(), go.click());
  document.addEventListener('keydown', key);
  return {
    unmount() {
      dead = true;
      ro.disconnect();
      cancelAnimationFrame(loop);
      live.forEach((b) => b.done?.());
      document.removeEventListener('keydown', key);
    },
  };
}
