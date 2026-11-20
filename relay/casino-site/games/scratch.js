import { h, put, fmt, fmtMult, short, betBox, stat, autoplay, gameLayout, history, pop, showResult, sfx, tween, ease, css, sleep, symbolImg, asset } from '../ui.js';

css('scratch', `
.sc { position: absolute; inset: 52px 14px 14px; display: flex; align-items: center; justify-content: center; }
.sc-t { --pad: clamp(12px, 2.2cqmin, 26px); --hd: clamp(40px, 8.5cqmin, 78px); --TH: calc(100cqh - 66px); --TW: min(calc(100cqw - 28px), calc(var(--TH) * 1.9)); position: relative; width: 100%; height: 100%; max-width: calc((100cqh - 66px) * 1.9);
  border-radius: clamp(14px, 2.6cqmin, 28px); padding: var(--pad); display: grid; gap: var(--pad);
  grid-template-columns: var(--S) minmax(0, 1fr); grid-template-rows: var(--hd) minmax(0, 1fr); grid-template-areas: 'hd hd' 'bd pz';
  --S: min(calc(var(--TH) - var(--pad) * 3 - var(--hd)), calc(var(--TW) * .6));
  background: radial-gradient(90% 70% at 18% 0%, rgba(255,255,255,.38), transparent 55%), repeating-linear-gradient(125deg, rgba(255,255,255,.07) 0 2px, transparent 2px 10px), var(--gold-grad);
  box-shadow: 0 1px 0 rgba(255,255,255,.6) inset, 0 -3px 0 rgba(0,0,0,.18) inset, 0 40px 80px -30px rgba(245,184,61,.45), 0 24px 50px -24px #000;
  -webkit-mask: radial-gradient(circle at left 50%, transparent 11px, #000 12px) left / 51% 100% no-repeat, radial-gradient(circle at right 50%, transparent 11px, #000 12px) right / 51% 100% no-repeat;
  mask: radial-gradient(circle at left 50%, transparent 11px, #000 12px) left / 51% 100% no-repeat, radial-gradient(circle at right 50%, transparent 11px, #000 12px) right / 51% 100% no-repeat; }
.sc-t::before { content: ''; position: absolute; inset: calc(var(--pad) * .45); border: 1.5px dashed rgba(27,19,4,.28); border-radius: clamp(10px, 2cqmin, 22px); pointer-events: none; }
.sc-hd { grid-area: hd; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--gold-ink); min-width: 0; position: relative; }
.sc-hd b { display: block; font-weight: 800; font-size: calc(var(--hd) * .5); letter-spacing: -.03em; line-height: 1; white-space: nowrap; }
.sc-hd small { display: block; font-weight: 700; font-size: clamp(10px, calc(var(--hd) * .22), 16px); letter-spacing: .14em; text-transform: uppercase; opacity: .7; margin-top: 3px; white-space: nowrap; }
.sc-price { text-align: right; flex: none; }
.sc-price .n { font-family: var(--mono); font-weight: 700; font-size: calc(var(--hd) * .42); line-height: 1; display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
.sc-price .n img { width: 1em; height: 1em; }
.sc-bd { grid-area: bd; position: relative; width: var(--S); height: var(--S); align-self: center; border-radius: clamp(10px, 2cqmin, 20px); padding: calc(var(--S) * .035); display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr); gap: calc(var(--S) * .03);
  background: linear-gradient(180deg, #141a26, #0b0f17); box-shadow: inset 0 2px 10px rgba(0,0,0,.7), 0 0 0 2px rgba(27,19,4,.35), 0 1px 0 2px rgba(255,255,255,.35); }
.sc-c { position: relative; border-radius: calc(var(--S) * .03); background: radial-gradient(circle at 50% 40%, var(--surface-3), var(--surface)); display: grid; place-items: center; box-shadow: inset 0 1px 0 rgba(255,255,255,.05); transition: box-shadow .3s, opacity .3s, transform .3s; }
.sc-c img { width: 74%; height: 74%; object-fit: contain; filter: drop-shadow(0 6px 10px rgba(0,0,0,.6)); }
.sc-c .fb { font-family: var(--mono); font-weight: 700; color: var(--gold); font-size: calc(var(--S) * .055); text-transform: uppercase; }
.sc-c.win { background: radial-gradient(circle at 50% 45%, #4a3410, var(--surface)); box-shadow: inset 0 0 0 2px var(--gold), 0 0 34px -4px rgba(245,184,61,.75); animation: scGlow 1.1s ease-in-out infinite alternate; }
.sc-c.win img { animation: scPop .5s cubic-bezier(.2,1.6,.4,1); }
.sc-c.dim { opacity: .42; }
@keyframes scGlow { to { box-shadow: inset 0 0 0 2px var(--gold-hi), 0 0 50px 2px rgba(245,184,61,.6); } }
@keyframes scPop { from { transform: scale(.5); } }
.sc-cv { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair; border-radius: inherit; }
.sc-cv.gone { opacity: 0; transition: opacity .45s ease; pointer-events: none; }
.sc-hint { position: absolute; left: 50%; bottom: calc(var(--S) * -.005); transform: translate(-50%, 50%); padding: 5px 12px; border-radius: 99px; background: var(--gold-ink); color: var(--gold-hi); font-size: clamp(10px, 1.6cqmin, 13px); font-weight: 700; letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; pointer-events: none; transition: opacity .3s; z-index: 2; }
.sc-pz { grid-area: pz; display: grid; grid-template-columns: 1fr; grid-auto-rows: minmax(0, 1fr); gap: calc(var(--pad) * .35); min-height: 0; align-self: stretch; }
.sc-pz .r { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 0 clamp(8px, 1.6cqmin, 16px); border-radius: 12px; background: rgba(27,19,4,.12); color: var(--gold-ink); min-height: 0; transition: background .25s, color .25s, transform .25s; }
.sc-pz .ic { display: flex; height: 100%; max-height: 64px; align-items: center; gap: 0; }
.sc-pz .ic img, .sc-pz .ic .fb { height: min(72%, 44px); aspect-ratio: 1; width: auto; object-fit: contain; margin-right: -8px; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
.sc-pz .ic .fb { display: grid; place-items: center; font-family: var(--mono); font-size: 9px; font-weight: 700; border-radius: 6px; background: rgba(27,19,4,.2); }
.sc-pz .x { font-family: var(--mono); font-weight: 700; font-size: clamp(12px, 2.2cqmin, 20px); opacity: .75; text-align: right; }
.sc-pz .p { font-family: var(--mono); font-weight: 700; font-size: clamp(13px, 2.6cqmin, 24px); text-align: right; min-width: 4ch; }
.sc-pz .r.hit { background: #141a26; color: var(--gold-hi); transform: scale(1.03); box-shadow: 0 0 0 2px var(--gold-ink), 0 10px 24px -10px #000; }
@container (min-width: 1300px) { .sc-pz { grid-template-columns: 1fr 1fr; } }
@container (max-aspect-ratio: 1/1) {
  .sc-t { max-width: none; grid-template-columns: minmax(0, 1fr); grid-template-rows: var(--hd) var(--S) minmax(0, 1fr); grid-template-areas: 'hd' 'bd' 'pz'; --hd: clamp(38px, 7cqmin, 64px);
    --S: min(calc(100cqw - 28px - var(--pad) * 2), calc(var(--TH) - var(--pad) * 4 - var(--hd) - 88px)); }
  .sc-bd { justify-self: center; }
  .sc-pz { grid-template-columns: repeat(4, minmax(0, 1fr)); grid-auto-rows: minmax(0, 1fr); }
  .sc-pz .r { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; justify-items: center; padding: 4px; gap: 0; }
  .sc-pz .ic { height: auto; min-height: 0; justify-content: center; }
  .sc-pz .ic img, .sc-pz .ic .fb { height: auto; width: 34%; margin-right: -9%; }
  .sc-pz .x { display: none; }
  .sc-pz .p { font-size: clamp(11px, 2.6cqmin, 16px); text-align: center; min-width: 0; }
}
`);

const GRID = 56; // the coarse scratch map, per side

/** A symbol picture that falls back to its name while the art is missing. */
function sym(name) {
  const img = symbolImg(name);
  img.addEventListener('error', () => img.replaceWith(h('span', { class: 'fb' }, name)), { once: true });
  return img;
}

export function mount(el, ctx) {
  const prizes = [...ctx.meta.prizes].sort((a, b) => b.mult - a.mult);
  let busy = false;
  let alive = true;
  let ticket = null; // { res, settled, revealed }
  let cleared = new Uint8Array(GRID * GRID);
  let rects = []; // cover rects in CSS px, one per cell
  let drawing = null;
  let lastSound = 0;
  let checkTimer = 0;

  const bet = betBox(ctx, { label: 'Ticket price' });
  const go = h('button', { class: 'btn lg gold' }, 'Buy ticket');
  const revealBtn = h('button', { class: 'btn', disabled: true, onclick: () => revealAll() }, 'Reveal all');
  const auto = autoplay(ctx, { button: go, play, lock: (on) => bet.lock(on), label: 'Buy ticket' });
  const sTop = stat('Top prize');
  const sLast = stat('Last ticket');

  const cells = [...Array(9)].map(() => h('div', { class: 'sc-c' }));
  const canvas = h('canvas', { class: 'sc-cv' });
  const hint = h('div', { class: 'sc-hint' }, 'Scratch here');
  const board = h('div', { class: 'sc-bd' }, cells, canvas, hint);
  const priceN = h('span', {}, fmt(bet.value));
  const rows = prizes.map((p) => {
    const pay = h('div', { class: 'p' });
    const r = h('div', { class: 'r' }, h('div', { class: 'ic' }, sym(p.symbol), sym(p.symbol), sym(p.symbol)), h('div', { class: 'x' }, fmtMult(p.mult)), pay);
    return { p, r, pay };
  });
  const ticketEl = h(
    'div',
    { class: 'sc-t' },
    h('div', { class: 'sc-hd' }, h('div', { style: { minWidth: 0 } }, h('b', {}, 'Steez Scratch'), h('small', {}, 'Match 3 to win')), h('div', { class: 'sc-price' }, h('small', {}, 'Ticket'), h('div', { class: 'n' }, h('img', { src: asset('img/coin.webp'), alt: '' }), priceN))),
    board,
    h('div', { class: 'sc-pz' }, rows.map((x) => x.r)),
  );
  const stageEl = h('div', { class: 'sc' }, ticketEl);
  const g = canvas.getContext('2d');
  const coinImg = new Image();
  coinImg.src = asset('img/coin.webp');
  coinImg.onload = () => ticket?.revealed || paintCovers();

  function drawPrizes() {
    const b = bet.value;
    priceN.textContent = fmt(b);
    rows.forEach((x) => (x.pay.textContent = short(Math.floor(b * x.p.mult))));
    sTop.set(fmt(Math.floor(b * prizes[0].mult)));
  }
  bet.onChange(drawPrizes);

  // ── Covers ──
  function measure() {
    const c = canvas.getBoundingClientRect();
    rects = cells.map((cell) => {
      const r = cell.getBoundingClientRect();
      return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
    });
    return c;
  }
  function roundRect(x, y, w, hh, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + hh, r);
    g.arcTo(x + w, y + hh, x, y + hh, r);
    g.arcTo(x, y + hh, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function paintCovers() {
    const c = measure();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(c.width * dpr);
    const H = Math.round(c.height * dpr);
    if (!W || !H) return;
    canvas.width = W;
    canvas.height = H;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, c.width, c.height);
    for (const r of rects) {
      const rad = Math.min(r.w, r.h) * 0.1;
      const grad = g.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
      grad.addColorStop(0, '#eef1f7');
      grad.addColorStop(0.35, '#a7b0c3');
      grad.addColorStop(0.55, '#d9dee8');
      grad.addColorStop(0.8, '#8a93a6');
      grad.addColorStop(1, '#c4cad6');
      roundRect(r.x, r.y, r.w, r.h, rad);
      g.fillStyle = grad;
      g.fill();
      g.save();
      g.clip();
      // foil grain
      for (let i = 0; i < (r.w * r.h) / 40; i++) {
        g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.35)' : 'rgba(107,117,137,.22)';
        g.fillRect(r.x + Math.random() * r.w, r.y + Math.random() * r.h, 1, 1);
      }
      // sheen band
      const sh = g.createLinearGradient(r.x, r.y + r.h, r.x + r.w, r.y);
      sh.addColorStop(0.35, 'rgba(255,255,255,0)');
      sh.addColorStop(0.5, 'rgba(255,255,255,.45)');
      sh.addColorStop(0.65, 'rgba(255,255,255,0)');
      g.fillStyle = sh;
      g.fillRect(r.x, r.y, r.w, r.h);
      g.restore();
      // emblem
      const s = Math.min(r.w, r.h);
      g.save();
      g.globalAlpha = 0.85;
      if (coinImg.complete && coinImg.naturalWidth) g.drawImage(coinImg, r.x + r.w / 2 - s * 0.19, r.y + r.h / 2 - s * 0.19, s * 0.38, s * 0.38);
      else {
        g.fillStyle = '#6b7589';
        g.font = `800 ${Math.round(s * 0.36)}px Geist, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('?', r.x + r.w / 2, r.y + r.h / 2);
      }
      g.restore();
      g.lineWidth = 1.5;
      g.strokeStyle = 'rgba(255,255,255,.55)';
      roundRect(r.x + 0.75, r.y + 0.75, r.w - 1.5, r.h - 1.5, rad);
      g.stroke();
    }
    // re-apply what was already scratched (after a resize)
    g.globalCompositeOperation = 'destination-out';
    const cw = c.width / GRID;
    const ch = c.height / GRID;
    for (let i = 0; i < cleared.length; i++) if (cleared[i]) g.fillRect((i % GRID) * cw - 1, Math.floor(i / GRID) * ch - 1, cw + 2, ch + 2);
    g.globalCompositeOperation = 'source-over';
  }

  // ── Scratching ──
  const cellOf = (gx, gy) => {
    const x = ((gx + 0.5) / GRID) * canvas.clientWidth;
    const y = ((gy + 0.5) / GRID) * canvas.clientHeight;
    return rects.findIndex((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  };
  let cellMap = null;
  const map = () => (cellMap ||= Array.from({ length: GRID * GRID }, (_, i) => cellOf(i % GRID, Math.floor(i / GRID))));
  function scratchLine(x0, y0, x1, y1) {
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const rad = Math.max(10, Math.min(W, H) * 0.05);
    g.globalCompositeOperation = 'destination-out';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = rad * 2;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1 + 0.01, y1);
    g.stroke();
    g.globalCompositeOperation = 'source-over';
    // mark the coarse map
    const cw = W / GRID;
    const ch = H / GRID;
    const minX = Math.max(0, Math.floor((Math.min(x0, x1) - rad) / cw));
    const maxX = Math.min(GRID - 1, Math.ceil((Math.max(x0, x1) + rad) / cw));
    const minY = Math.max(0, Math.floor((Math.min(y0, y1) - rad) / ch));
    const maxY = Math.min(GRID - 1, Math.ceil((Math.max(y0, y1) + rad) / ch));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1;
    for (let gy = minY; gy <= maxY; gy++)
      for (let gx = minX; gx <= maxX; gx++) {
        const px = (gx + 0.5) * cw;
        const py = (gy + 0.5) * ch;
        const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
        const ex = x0 + t * dx - px;
        const ey = y0 + t * dy - py;
        if (ex * ex + ey * ey <= rad * rad) cleared[gy * GRID + gx] = 1;
      }
  }
  const doneCells = new Set();
  function progress() {
    if (!ticket || ticket.revealed) return;
    const m = map();
    const per = Array(9).fill(0);
    const tot = Array(9).fill(0);
    for (let i = 0; i < m.length; i++) if (m[i] >= 0) (tot[m[i]]++, cleared[i] && per[m[i]]++);
    const all = per.reduce((s, x) => s + x, 0) / Math.max(1, tot.reduce((s, x) => s + x, 0));
    per.forEach((n, i) => {
      if (!doneCells.has(i) && tot[i] && n / tot[i] > 0.5) {
        doneCells.add(i);
        clearCell(i);
      }
    });
    if (all >= 0.6 || doneCells.size === 9) revealAll();
  }
  function clearCell(i) {
    const r = rects[i];
    if (!r) return;
    sfx.pop();
    let last = 0;
    tween(260, (t) => {
      g.globalCompositeOperation = 'destination-out';
      g.globalAlpha = Math.min(1, (t - last) * 2.2 + 0.05);
      last = t;
      g.fillRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }).then(() => {
      if (ticket && !ticket.revealed) {
        g.globalCompositeOperation = 'destination-out';
        g.fillRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
        g.globalCompositeOperation = 'source-over';
      }
    });
  }
  const pt = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!ticket || ticket.revealed) return;
    canvas.setPointerCapture?.(e.pointerId);
    drawing = pt(e);
    hint.style.opacity = 0;
    scratchLine(...drawing, ...drawing);
    sfx.scratch();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing || !ticket || ticket.revealed) return;
    const p = pt(e);
    scratchLine(...drawing, ...p);
    drawing = p;
    const now = performance.now();
    if (now - lastSound > 110) {
      lastSound = now;
      sfx.scratch();
    }
    if (!checkTimer) checkTimer = setTimeout(() => ((checkTimer = 0), progress()), 120);
  });
  const stop = () => {
    if (!drawing) return;
    drawing = null;
    clearTimeout(checkTimer);
    checkTimer = 0;
    progress();
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  // ── A ticket ──
  function freshTicket(res) {
    const d = res.result;
    cleared = new Uint8Array(GRID * GRID);
    cellMap = null;
    doneCells.clear();
    cells.forEach((c, i) => {
      c.className = 'sc-c';
      put(c, sym(d.grid[i]));
    });
    rows.forEach((x) => x.r.classList.remove('hit'));
    canvas.classList.remove('gone');
    paintCovers();
  }

  async function revealAll() {
    if (!ticket || ticket.revealed) return;
    ticket.revealed = true;
    drawing = null;
    revealBtn.disabled = true;
    hint.style.opacity = 0;
    canvas.classList.add('gone');
    await sleep(auto.running ? 250 : 380);
    finish();
  }

  function finish() {
    const t = ticket;
    if (!t || t.settled) return;
    t.settled = true;
    const d = t.res.result;
    if (d.symbol) cells.forEach((c, i) => c.classList.add(d.cells.includes(i) ? 'win' : 'dim'));
    if (d.symbol) rows.find((x) => x.p.symbol === d.symbol)?.r.classList.add('hit');
    hist.push(d.mult ? fmtMult(d.mult) : '0×', d.mult >= 10 ? 'g' : d.mult > 0);
    sLast.set(d.mult ? `+${fmt(t.res.payout)}` : 'No win');
    showResult(p, t.res, { lossText: 'No win' });
    ctx.settle(t.res);
    if (!auto.running) {
      go.disabled = false;
      bet.lock(false);
    }
  }

  async function play() {
    if (busy || (ticket && !ticket.settled)) return null;
    busy = true;
    go.disabled = !auto.running;
    bet.lock(true);
    let res;
    try {
      res = await ctx.bet(bet.value, {});
    } catch {
      busy = false;
      go.disabled = false;
      if (!auto.running) bet.lock(false);
      return null;
    }
    if (!alive) return null;
    sfx.open();
    ticket = { res, settled: false, revealed: false };
    freshTicket(res);
    busy = false;
    if (auto.running) {
      hint.style.opacity = 0;
      await sleep(260);
      await revealAll();
      await sleep(450);
      return res;
    }
    hint.style.opacity = 1;
    revealBtn.disabled = false;
    go.disabled = true;
    return res;
  }

  const L = gameLayout(el, ctx, { controls: [auto.mode, bet.el, auto.box, h('div', { class: 'stats' }, sTop.el, sLast.el), h('div', { class: 'note' }, 'Drag across the silver to scratch. Three matching symbols win the prize shown for them.'), h('div', { class: 'spacer' }), revealBtn, go], stage: stageEl });
  const hist = history(L.bar);
  const p = pop(L.body);
  drawPrizes();
  // an unplayed ticket to start with: covers on, symbols hidden behind them
  cells.forEach((c, i) => put(c, sym(prizes[(i * 5) % prizes.length].symbol)));
  ticket = null;
  hint.style.opacity = 0;
  const ro = new ResizeObserver(() => {
    cellMap = null;
    if (!ticket || !ticket.revealed) paintCovers();
  });
  ro.observe(board);
  paintCovers();
  const key = (e) => e.code === 'Space' && e.target === document.body && (e.preventDefault(), ticket && !ticket.revealed ? revealAll() : go.click());
  document.addEventListener('keydown', key);
  return {
    unmount() {
      alive = false;
      ro.disconnect();
      clearTimeout(checkTimer);
      document.removeEventListener('keydown', key);
      // a ticket bought but not scratched still counts: show the real balance
      if (ticket && !ticket.settled) {
        ticket.settled = true;
        ctx.settle(ticket.res);
      }
    },
  };
}
