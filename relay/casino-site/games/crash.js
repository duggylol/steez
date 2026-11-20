import { h, fmt, fmtMult, betBox, field, stat, gameLayout, history, pop, showResult, sfx, css, load, keep, asset } from '../ui.js';

// The rocket art points up and to the right (like the emoji). Turn this if the art points another way.
const ROCKET_TILT = 45;
const POLL_MS = 700; // the relay allows ~25 requests per 10 s per viewer

css('crash', `
.cr { position: absolute; inset: 0; overflow: hidden; border-radius: inherit; }
.cr-sky { position: absolute; inset: -6%; background: var(--bg) url(${asset('img/stars.webp')}) center / cover no-repeat; transition: transform 1.2s linear; }
.cr-sky::after { content: ''; position: absolute; inset: 0; background: radial-gradient(90% 70% at 50% 115%, rgba(245,184,61,.16), transparent 62%), linear-gradient(180deg, rgba(7,9,14,.5) 0%, rgba(7,9,14,.08) 45%, rgba(7,9,14,.62) 100%); }
.cr-dots { position: absolute; inset: 0; opacity: .75; background-size: 260px 260px; background-image:
  radial-gradient(1.6px 1.6px at 24px 36px, rgba(255,255,255,.7), transparent 70%),
  radial-gradient(1.1px 1.1px at 130px 84px, rgba(255,255,255,.45), transparent 70%),
  radial-gradient(1.4px 1.4px at 210px 170px, rgba(255,210,122,.65), transparent 70%),
  radial-gradient(1px 1px at 70px 214px, rgba(255,255,255,.4), transparent 70%),
  radial-gradient(1.2px 1.2px at 176px 18px, rgba(255,255,255,.5), transparent 70%); }
.cr-cv { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.cr-big { position: absolute; left: 0; right: 0; top: 19%; text-align: center; pointer-events: none; z-index: 3; }
.cr-big .n { font-family: var(--mono); font-weight: 700; font-size: clamp(50px, 15cqmin, 168px); line-height: 1; letter-spacing: -.04em; color: var(--text); text-shadow: 0 6px 40px rgba(0,0,0,.75); font-variant-numeric: tabular-nums; transition: color .2s; }
.cr-big .s { margin-top: clamp(6px, 1.4cqh, 14px); font-weight: 700; font-size: clamp(12px, 2.1cqmin, 17px); letter-spacing: .14em; text-transform: uppercase; color: var(--text-2); text-shadow: 0 2px 12px #000; }
.cr-big.idle .n { color: var(--text-3); }
.cr-big.fly .n { color: var(--text); }
.cr-big.hot .n { color: var(--gold-hi); text-shadow: 0 0 50px rgba(245,184,61,.45), 0 6px 40px rgba(0,0,0,.75); }
.cr-big.w .n { color: var(--win); text-shadow: 0 0 60px rgba(34,199,122,.45), 0 6px 40px rgba(0,0,0,.75); }
.cr-big.w .s { color: var(--win); }
.cr-big.l .n { color: var(--lose); text-shadow: 0 0 60px rgba(239,75,95,.4), 0 6px 40px rgba(0,0,0,.75); }
.cr-big.l .s { color: var(--lose); }
.cr-ship { --rs: clamp(46px, 10cqmin, 104px); position: absolute; left: 0; top: 0; width: var(--rs); height: var(--rs); margin: calc(var(--rs) / -2) 0 0 calc(var(--rs) / -2); z-index: 2; pointer-events: none; will-change: transform; transition: opacity .15s; }
.cr-ship img { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 0 16px rgba(245,184,61,.55)) drop-shadow(0 8px 14px rgba(0,0,0,.6)); }
.cr-ship.fly img { animation: crJit .12s steps(2) infinite; }
.cr-ship.noimg img { display: none; }
.cr-ship.noimg::before { content: ''; position: absolute; inset: 28%; border-radius: 50%; background: var(--gold-grad); box-shadow: 0 0 26px 10px rgba(245,184,61,.55), 0 0 0 3px rgba(255,210,122,.35); }
.cr-ship.gone { opacity: 0; }
@keyframes crJit { 50% { transform: translate(.6px, -.6px); } }
.cr-boom { --bs: clamp(130px, 34cqmin, 340px); position: absolute; left: 0; top: 0; width: var(--bs); height: var(--bs); margin: calc(var(--bs) / -2) 0 0 calc(var(--bs) / -2); z-index: 2; pointer-events: none; display: none; }
.cr-boom.on { display: block; }
.cr-boom i { position: absolute; inset: 0; border-radius: 50%; }
.cr-boom .f { background: radial-gradient(circle, #fff 0, var(--gold-hi) 14%, var(--gold) 30%, rgba(239,75,95,.85) 48%, rgba(239,75,95,0) 68%); animation: crFlash .75s cubic-bezier(.2,.8,.3,1) forwards; }
.cr-boom .r { border: 3px solid var(--gold-hi); box-shadow: 0 0 30px rgba(245,184,61,.7), inset 0 0 20px rgba(239,75,95,.6); animation: crRing .7s cubic-bezier(.2,.8,.3,1) forwards; }
.cr-boom.small { --bs: clamp(70px, 16cqmin, 150px); }
@keyframes crFlash { 0% { transform: scale(.15); opacity: 1; } 60% { opacity: .95; } 100% { transform: scale(1.25); opacity: 0; } }
@keyframes crRing { 0% { transform: scale(.1); opacity: 1; } 100% { transform: scale(1.5); opacity: 0; } }
.cr.shake { animation: crShake .5s; }
@keyframes crShake { 15% { transform: translate(-7px, 4px); } 30% { transform: translate(6px, -5px); } 45% { transform: translate(-5px, -3px); } 60% { transform: translate(4px, 4px); } 80% { transform: translate(-2px, 1px); } }
.cr-cash { display: none !important; pointer-events: auto; margin: clamp(10px, 2.4cqh, 18px) auto 0; width: min(72%, 320px) !important; box-shadow: 0 12px 30px -8px rgba(0,0,0,.8), 0 0 0 4px rgba(34,199,122,.15) !important; }
@media (max-width: 1100px) { .cr.live .cr-cash { display: inline-flex !important; } }
.cr-quick { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-top: 8px; }
.cr-quick button { height: 34px; border-radius: 9px; border: 1px solid var(--line-2); background: var(--bg-1); font-family: var(--mono); font-weight: 700; font-size: 12.5px; color: var(--text-2); padding: 0; }
.cr-quick button:hover:not(:disabled) { border-color: #36415a; color: var(--text); }
.cr-quick button.on { border-color: var(--gold); color: var(--gold-hi); background: var(--gold-soft); }
.cr-quick button:disabled { opacity: .5; cursor: not-allowed; }
`);

const GOLD = '#f5b83d';
const GOLD_HI = '#ffd27a';
const WIN = '#22c77a';
const LOSE = '#ef4b5f';
const TEXT3 = '#6b7589';

function niceStep(span, n) {
  const raw = span / n;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}
const two = (m) => `${Number(m).toFixed(2)}×`;

export function mount(el, ctx) {
  const rate = ctx.meta.rate || 0.0001;
  const R = ctx.casino.returnPercent / 100;
  const tOf = (m) => Math.log(Math.max(1, m)) / rate;

  // ── state ──
  let round = null; // { staked, auto, el, at, ending, cashing, autoPinged }
  let busy = false;
  let phase = 'idle'; // idle | sync | fly | boom | won
  const fl = { t: 0, m: 1, point: 0, cashAt: 0, auto: 0 };
  let ff = null; // after a cash-out: fast-forward the flight to where it would have blown
  let parts = [];
  let pollT = 0;
  let inflight = false;
  let dirty = true;
  let lastWhole = 1;

  // ── controls ──
  const bet = betBox(ctx);
  const autoIn = h('input', { class: 'inp', inputmode: 'decimal', placeholder: 'Off', value: load('casinoCrashAuto', '') });
  const quick = [['Off', 0], ['1.5×', 1.5], ['2×', 2], ['5×', 5], ['10×', 10]].map(([l, v]) => {
    const b = h('button', { type: 'button', onclick: () => (sfx.click(), setAuto(v)) }, l);
    b.dataset.v = String(v);
    return b;
  });
  const sMult = stat('Multiplier', '1.00×');
  const sPay = stat('Payout', '—');
  const sChance = stat('Auto chance', '—');
  const sAutoPay = stat('Auto payout', '—');
  const main = h('button', { class: 'btn lg gold', onclick: () => (round ? cashout() : launch()) }, 'Bet');

  function autoValue() {
    const n = Number(String(autoIn.value).replace(/[^\d.]/g, ''));
    return n >= 1.01 ? Math.min(1000, Math.floor(n * 100) / 100) : 0;
  }
  function setAuto(v) {
    const n = Number(v) >= 1.01 ? Math.min(1000, Math.floor(Number(v) * 100) / 100) : 0;
    autoIn.value = n ? n.toFixed(2) : '';
    keep('casinoCrashAuto', autoIn.value);
    draw();
  }
  autoIn.addEventListener('change', () => setAuto(autoIn.value));
  bet.onChange(() => draw());

  // ── stage ──
  const sky = h('div', { class: 'cr-sky' });
  const dots = h('div', { class: 'cr-dots' });
  const cv = h('canvas', { class: 'cr-cv' });
  const g = cv.getContext('2d');
  const shipImg = h('img', { src: asset('img/rocket.webp'), alt: '', draggable: 'false' });
  const ship = h('div', { class: 'cr-ship' }, shipImg);
  shipImg.addEventListener('error', () => ship.classList.add('noimg'));
  const boom = h('div', { class: 'cr-boom' }, h('i', { class: 'f' }), h('i', { class: 'r' }));
  const bigN = h('div', { class: 'n' }, '1.00×');
  const bigS = h('div', { class: 's' }, 'Place a bet to launch');
  const big = h('div', { class: 'cr-big idle' }, bigN, bigS);
  const cash2 = h('button', { class: 'btn lg green cr-cash', onclick: () => cashout() }, 'Cash out');
  big.append(cash2);
  const scene = h('div', { class: 'cr' }, sky, dots, cv, ship, boom, big);

  // ── drawing ──
  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth;
    const hh = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(hh * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, hh };
  }
  function shownAuto() {
    return round ? round.auto : phase === 'idle' ? autoValue() : fl.auto;
  }
  function scale(w, hh, t, m) {
    const narrow = w < 520;
    const P = { l: narrow ? 44 : 58, r: narrow ? 16 : 26, t: 62, b: narrow ? 30 : 36 };
    const x0 = P.l, x1 = w - P.r, y0 = hh - P.b, y1 = P.t;
    const xMax = Math.max(10000, t / 0.86);
    let top = Math.max(2, 1 + (m - 1) / 0.62);
    const a = shownAuto();
    if (a && a <= 1 + (top - 1) * 1.6) top = Math.max(top, 1 + (a - 1) * 1.12);
    return { x0, x1, y0, y1, xMax, top, X: (ms) => x0 + (ms / xMax) * (x1 - x0), Y: (v) => y0 - ((v - 1) / (top - 1)) * (y0 - y1) };
  }

  function render(dt) {
    const { w, hh } = size();
    if (!w || !hh) return;
    g.clearRect(0, 0, w, hh);
    const t = ff ? ff.t : fl.t;
    const m = Math.exp(rate * t);
    const S = scale(w, hh, t, m);
    const narrow = w < 520;

    // grid
    g.font = `600 ${narrow ? 10.5 : 11.5}px "Geist Mono", ui-monospace, monospace`;
    g.lineWidth = 1;
    const ys = niceStep(S.top - 1, narrow ? 4 : 5);
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (let v = 1; v <= S.top + 1e-9; v += ys) {
      const y = Math.round(S.Y(v)) + 0.5;
      g.strokeStyle = v === 1 ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.055)';
      g.beginPath();
      g.moveTo(S.x0, y);
      g.lineTo(S.x1, y);
      g.stroke();
      g.fillStyle = TEXT3;
      g.fillText(`${+v.toFixed(2)}×`, S.x0 - 8, y);
    }
    const xs = niceStep(S.xMax / 1000, narrow ? 3 : 5);
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (let s = xs; s * 1000 <= S.xMax; s += xs) {
      const x = Math.round(S.X(s * 1000)) + 0.5;
      g.strokeStyle = 'rgba(255,255,255,.04)';
      g.beginPath();
      g.moveTo(x, S.y1);
      g.lineTo(x, S.y0);
      g.stroke();
      g.fillStyle = TEXT3;
      g.fillText(`${+s.toFixed(1)}s`, x, S.y0 + 9);
    }

    // auto cash-out line
    const a = shownAuto();
    if (a) {
      const inRange = a <= S.top;
      const y = inRange ? Math.round(S.Y(a)) + 0.5 : S.y1 - 14;
      g.setLineDash([7, 7]);
      g.strokeStyle = 'rgba(34,199,122,.75)';
      g.lineWidth = 1.5;
      if (inRange) {
        g.beginPath();
        g.moveTo(S.x0, y);
        g.lineTo(S.x1, y);
        g.stroke();
      }
      g.setLineDash([]);
      const label = `${inRange ? '' : '↑ '}Auto ${two(a)}`;
      g.font = `700 ${narrow ? 11 : 12}px "Geist Mono", ui-monospace, monospace`;
      const tw = g.measureText(label).width + 16;
      const lx = S.x1 - tw, ly = y - 11;
      g.fillStyle = 'rgba(11,15,23,.85)';
      roundRect(lx, ly, tw, 22, 7);
      g.fill();
      g.strokeStyle = 'rgba(34,199,122,.55)';
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = WIN;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(label, lx + 8, ly + 11.5);
    }

    // the flight
    if (t > 0) {
      const bust = phase === 'boom';
      const tc = phase === 'won' ? tOf(fl.cashAt) : Infinity;
      const pts = [];
      const N = 96;
      for (let i = 0; i <= N; i++) {
        const s = (t * i) / N;
        pts.push([S.X(s), S.Y(Math.exp(rate * s)), s]);
      }
      // glow fill under the curve
      const fill = g.createLinearGradient(0, S.Y(m), 0, S.y0);
      fill.addColorStop(0, bust ? 'rgba(239,75,95,.30)' : 'rgba(245,184,61,.30)');
      fill.addColorStop(1, bust ? 'rgba(239,75,95,0)' : 'rgba(245,184,61,0)');
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.lineTo(S.X(t), S.y0);
      g.lineTo(S.X(0), S.y0);
      g.closePath();
      g.fillStyle = fill;
      g.fill();
      // the line: solid gold up to the cash-out, faint after it
      const line = (from, to, style, width, glow) => {
        g.beginPath();
        let started = false;
        for (const [x, y, s] of pts) {
          if (s < from || s > to) continue;
          started ? g.lineTo(x, y) : g.moveTo(x, y);
          started = true;
        }
        g.lineWidth = width;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.strokeStyle = style;
        g.shadowColor = glow;
        g.shadowBlur = glow ? 18 : 0;
        g.stroke();
        g.shadowBlur = 0;
      };
      let stroke;
      if (bust) stroke = LOSE;
      else {
        stroke = g.createLinearGradient(S.x0, S.y0, S.X(t), S.Y(m));
        stroke.addColorStop(0, '#dd951b');
        stroke.addColorStop(0.6, GOLD);
        stroke.addColorStop(1, GOLD_HI);
      }
      line(0, Math.min(t, tc), stroke, narrow ? 3.5 : 4.5, bust ? 'rgba(239,75,95,.8)' : 'rgba(245,184,61,.85)');
      if (t > tc) {
        g.setLineDash([2, 7]);
        line(tc, t, 'rgba(245,184,61,.45)', 3, '');
        g.setLineDash([]);
      }
      // cash-out marker
      if (phase === 'won') {
        const cx = S.X(tc), cy = S.Y(fl.cashAt);
        g.beginPath();
        g.arc(cx, cy, 11, 0, Math.PI * 2);
        g.fillStyle = 'rgba(34,199,122,.22)';
        g.fill();
        g.beginPath();
        g.arc(cx, cy, 5.5, 0, Math.PI * 2);
        g.fillStyle = WIN;
        g.fill();
        g.font = `700 ${narrow ? 11 : 12.5}px "Geist Mono", ui-monospace, monospace`;
        const label = `Cashed ${two(fl.cashAt)}`;
        const tw = g.measureText(label).width + 16;
        const lx = Math.min(S.x1 - tw, Math.max(S.x0, cx - tw / 2)), ly = Math.max(S.y1 - 30, cy - 40);
        g.fillStyle = 'rgba(11,15,23,.9)';
        roundRect(lx, ly, tw, 24, 8);
        g.fill();
        g.strokeStyle = 'rgba(34,199,122,.6)';
        g.lineWidth = 1;
        g.stroke();
        g.fillStyle = WIN;
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.fillText(label, lx + 8, ly + 12.5);
      }
    }

    // rocket at the tip, pointing along the curve
    const tx = S.X(t), ty = S.Y(m);
    const slope = (rate * m * (S.y0 - S.y1)) / (S.top - 1) / ((S.x1 - S.x0) / S.xMax);
    const ang = (Math.atan2(-slope, 1) * 180) / Math.PI;
    ship.style.transform = `translate(${tx}px, ${ty}px) rotate(${ang + ROCKET_TILT}deg)`;
    boom.style.transform = `translate(${tx}px, ${ty}px)`;
    tip.x = tx;
    tip.y = ty;

    // sparks
    if (parts.length) {
      const k = dt / 16.7;
      parts = parts.filter((p) => (p.life -= dt) > 0);
      for (const p of parts) {
        p.vy += 0.12 * k;
        p.vx *= 0.985;
        p.x += p.vx * k;
        p.y += p.vy * k;
        g.globalAlpha = Math.max(0, Math.min(1, p.life / 500));
        g.fillStyle = p.c;
        g.beginPath();
        g.arc(p.x, p.y, p.s, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    // the backdrop drifts as the rocket climbs
    sky.style.transform = `scale(${1 + Math.min(0.08, Math.log(m) * 0.02)})`;
    dots.style.backgroundPosition = `${-t * 0.012}px ${t * 0.03}px`;
  }
  const tip = { x: 0, y: 0 };
  function roundRect(x, y, w, hh, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + hh, r);
    g.arcTo(x + w, y + hh, x, y + hh, r);
    g.arcTo(x, y + hh, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function burst(x, y, n, colors, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (1.5 + Math.random() * 5.5) * power;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.5, s: 1 + Math.random() * 2.6, life: 500 + Math.random() * 700, c: colors[(Math.random() * colors.length) | 0] });
    }
  }
  function explode(small = false) {
    ship.classList.add('gone');
    boom.classList.remove('on', 'small');
    void boom.offsetWidth;
    boom.classList.add('on');
    if (small) boom.classList.add('small');
    burst(tip.x, tip.y, small ? 40 : 110, [GOLD, GOLD_HI, LOSE, '#ffffff'], small ? 0.6 : 1);
    if (!small) {
      scene.classList.remove('shake');
      void scene.offsetWidth;
      scene.classList.add('shake');
    }
  }

  // ── the frame loop ──
  let raf = 0;
  let last = performance.now();
  let lastBtn = '';
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(50, now - last);
    last = now;
    if (phase === 'fly' && round) {
      fl.t = Math.max(0, round.el + (now - round.at));
      fl.m = Math.exp(rate * fl.t);
      bigN.textContent = two(fl.m);
      big.className = `cr-big fly${fl.m >= 2 ? ' hot' : ''}`;
      const whole = Math.floor(fl.m);
      if (whole > lastWhole) {
        lastWhole = whole;
        sfx.tick(1 + Math.min(1, whole / 20));
      }
      const pay = Math.floor(round.staked * Math.floor(fl.m * 100) / 100);
      sMult.set(two(fl.m));
      sPay.set(fmt(pay));
      if (!round.cashing && !round.ending) {
        const label = `Cash out ${fmt(pay)}`;
        if (label !== lastBtn) main.textContent = cash2.textContent = lastBtn = label;
      }
      // auto cash-out: ask the server right away instead of waiting for the next poll
      if (round.auto && fl.m >= round.auto && !round.autoPinged) {
        round.autoPinged = true;
        schedule(80);
      }
      dirty = true;
    }
    if (ff) {
      const k = Math.min(1, Math.max(0, (now - ff.t0) / ff.dur));
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      ff.t = ff.from + (ff.to - ff.from) * e;
      if (k >= 1) {
        fl.t = ff.to;
        fl.m = fl.point;
        ff = null;
        explode(true);
        sfx.crash();
      }
      dirty = true;
    }
    if (dirty || parts.length) {
      render(dt);
      dirty = false;
    }
  }
  raf = requestAnimationFrame(frame);
  const ro = new ResizeObserver(() => (dirty = true));
  ro.observe(scene);

  // ── server ──
  function schedule(ms = POLL_MS) {
    clearTimeout(pollT);
    pollT = setTimeout(poll, ms);
  }
  async function poll() {
    if (!round || round.ending) return;
    if (inflight) return schedule(150);
    const r = round;
    inflight = true;
    let res;
    try {
      res = await ctx.move('status', {}, { quiet: true });
    } catch (e) {
      inflight = false;
      if (r !== round || r.ending) return;
      if (/round is over/i.test(e.message)) return vanished();
      return schedule(1500);
    }
    inflight = false;
    if (r !== round || r.ending) return;
    if (res.done) return finish(res);
    const now = performance.now();
    const local = r.el + (now - r.at);
    if (phase === 'sync' || Math.abs(local - res.view.elapsed) > 160) {
      r.el = res.view.elapsed;
      r.at = now;
    }
    if (phase === 'sync') fly();
    schedule();
  }

  async function launch() {
    if (busy || round) return;
    busy = true;
    draw();
    sfx.chip();
    const auto = autoValue();
    let res;
    try {
      res = await ctx.bet(bet.value, auto ? { auto } : {});
    } catch {
      busy = false;
      draw();
      return;
    }
    busy = false;
    ctx.settle({ balance: res.balance });
    round = { staked: res.staked, auto: res.view.auto || 0, el: res.view.elapsed || 0, at: performance.now() };
    fly();
    sfx.launch();
    schedule();
  }

  function reset() {
    ff = null;
    parts = [];
    boom.classList.remove('on', 'small');
    ship.classList.remove('gone');
    scene.classList.remove('shake');
    fl.t = 0;
    fl.m = 1;
    lastWhole = 1;
    lastBtn = '';
    dirty = true;
  }
  function fly() {
    reset();
    phase = 'fly';
    fl.auto = round.auto;
    ship.classList.add('fly');
    big.className = 'cr-big fly';
    bigN.textContent = two(Math.exp(rate * round.el));
    bigS.textContent = round.auto ? `Auto cash-out at ${two(round.auto)}` : 'Cash out before it blows';
    draw();
  }

  async function cashout() {
    if (!round || round.ending || round.cashing || phase !== 'fly') return;
    const r = round;
    r.cashing = true;
    sfx.click();
    draw();
    // read the clock now: frames can lag (a busy or hidden tab), the cash-out shouldn't
    const at = Math.floor(Math.exp(rate * Math.max(0, r.el + (performance.now() - r.at))) * 100) / 100;
    try {
      const res = await ctx.move('cashout', { at }, { quiet: true });
      if (r === round && !r.ending) finish(res);
    } catch (e) {
      if (r !== round || r.ending) return;
      r.cashing = false;
      if (/round is over/i.test(e.message)) return vanished();
      ctx.toast(e.message, true);
      draw();
    }
  }

  function finish(res) {
    const r = round;
    r.ending = true;
    clearTimeout(pollT);
    round = null;
    ctx.roundOver();
    ship.classList.remove('fly');
    const v = res.view;
    fl.point = v.point;
    fl.auto = r.auto;
    const won = res.payout > 0;
    if (won) {
      fl.cashAt = v.cashedAt || Math.floor((res.payout / r.staked) * 100) / 100;
      // the climb stops on screen where the cash-out was paid, then fast-forwards to where it blew
      const tc = tOf(fl.cashAt);
      fl.t = Math.min(Math.max(fl.t, tc), tOf(fl.point));
      phase = 'won';
      big.className = 'cr-big w';
      bigN.textContent = two(fl.cashAt);
      bigS.textContent = `Cashed out · +${fmt(res.payout - r.staked)}`;
      sfx.cash();
      render(0);
      ff = { from: fl.t, to: tOf(fl.point), t: fl.t, t0: performance.now() + 500, dur: Math.min(1600, 500 + (tOf(fl.point) - fl.t) / 20) };
      burst(tip.x, tip.y, 28, [WIN, GOLD_HI, '#ffffff'], 0.55);
    } else {
      phase = 'boom';
      fl.t = tOf(fl.point);
      fl.m = fl.point;
      big.className = 'cr-big l';
      bigN.textContent = two(fl.point);
      bigS.textContent = 'Crashed';
      dirty = true;
      render(0);
      explode();
      sfx.crash();
    }
    sMult.set(two(won ? fl.cashAt : fl.point));
    sPay.set(won ? fmt(res.payout) : '0');
    hist.push(two(fl.point), won ? (fl.cashAt >= 10 ? 'g' : true) : false);
    showResult(p, res);
    ctx.settle(res);
    dirty = true;
    draw();
  }

  // the round ended somewhere else (another tab): tidy up
  function vanished() {
    clearTimeout(pollT);
    round = null;
    ctx.roundOver();
    phase = 'idle';
    reset();
    ship.classList.remove('fly');
    big.className = 'cr-big idle';
    bigN.textContent = '1.00×';
    bigS.textContent = 'That round already ended';
    draw();
  }

  function draw() {
    const live = !!round;
    scene.classList.toggle('live', live && phase === 'fly');
    cash2.disabled = !live || !!round?.cashing || !!round?.ending;
    bet.lock(live || busy);
    autoIn.disabled = live || busy;
    const a = live ? round.auto : autoValue();
    quick.forEach((b) => {
      b.disabled = live || busy;
      b.classList.toggle('on', Number(b.dataset.v) === a);
    });
    sChance.set(a ? `${Math.min(100, (R / a) * 100).toFixed(2)}%` : '—');
    sAutoPay.set(a ? fmt(Math.floor((live ? round.staked : bet.value) * a)) : '—');
    if (!live) {
      main.textContent = 'Bet';
      main.className = 'btn lg gold';
      main.disabled = busy;
      if (phase === 'idle') {
        sMult.set('1.00×');
        sPay.set('—');
      }
    } else if (phase === 'sync') {
      main.className = 'btn lg green';
      main.textContent = 'Catching up…';
      main.disabled = true;
    } else if (round.cashing || round.ending) {
      main.className = 'btn lg green';
      main.textContent = 'Cashing out…';
      main.disabled = true;
    } else {
      main.className = 'btn lg green';
      main.disabled = false;
      main.textContent = cash2.textContent = lastBtn = `Cash out ${fmt(Math.floor(round.staked * fl.m))}`;
    }
    dirty = true;
  }

  const L = gameLayout(el, ctx, {
    controls: [bet.el, field('Auto cash-out', h('div', {}, autoIn, h('div', { class: 'cr-quick' }, quick)), '1.01–1000×'), h('div', { class: 'stats' }, sMult.el, sPay.el, sChance.el, sAutoPay.el), h('div', { class: 'spacer' }), main],
    stage: scene,
  });
  L.body.style.alignItems = 'stretch';
  const hist = history(L.bar);
  const p = pop(L.body);

  // pick up a round left running
  if (ctx.round) {
    const v = ctx.round.view;
    round = { staked: ctx.round.staked, auto: v.auto || 0, el: v.elapsed || 0, at: performance.now() };
    fl.auto = round.auto;
    if (round.auto) setAuto(round.auto);
    phase = 'sync';
    big.className = 'cr-big fly';
    bigN.textContent = '…';
    bigS.textContent = 'Rejoining your flight';
    schedule(0);
  }
  draw();

  const key = (e) => e.code === 'Space' && e.target === document.body && (e.preventDefault(), main.click());
  document.addEventListener('keydown', key);
  return {
    unmount() {
      cancelAnimationFrame(raf);
      clearTimeout(pollT);
      ro.disconnect();
      document.removeEventListener('keydown', key);
      round = null;
    },
  };
}
