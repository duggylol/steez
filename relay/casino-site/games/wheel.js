import { h, put, fmt, fmtMult, betBox, field, stat, seg, autoplay, gameLayout, history, pop, showResult, sfx, css, tween, ease, load, keep } from '../ui.js';

css('wheel', `
.wh { --s: min(calc(100cqw - 32px), calc(100cqh - 158px)); display: flex; flex-direction: column; align-items: center; gap: 14px; margin-top: 40px; width: 100%; }
.wh-wrap { position: relative; width: var(--s); height: var(--s); flex: none; }
.wh-wrap canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.wh-pin { position: absolute; left: 50%; top: calc(var(--s) * -.035); width: calc(var(--s) * .085); height: calc(var(--s) * .11); margin-left: calc(var(--s) * -.0425); z-index: 3; transform-origin: 50% 22%; transition: transform .14s cubic-bezier(.2,1.6,.4,1); filter: drop-shadow(0 6px 8px rgba(0,0,0,.7)); }
.wh-pin.kick { transform: rotate(-22deg); transition: transform .04s; }
.wh-pin svg { width: 100%; height: 100%; display: block; overflow: visible; }
.wh-hub { position: absolute; left: 50%; top: 50%; width: 32%; height: 32%; transform: translate(-50%, -50%); border-radius: 50%; z-index: 2; display: grid; place-items: center; text-align: center;
  background: radial-gradient(circle at 50% 30%, #232c40, #10151f 70%); box-shadow: 0 0 0 calc(var(--s) * .012) #0b0f17, 0 0 0 calc(var(--s) * .018) rgba(245,184,61,.55), 0 14px 40px rgba(0,0,0,.7), inset 0 2px 0 rgba(255,255,255,.07); transition: box-shadow .3s; }
.wh-hub .m { font: 700 calc(var(--s) * .064)/1 var(--mono); color: var(--text-2); letter-spacing: -.03em; transition: color .2s, transform .3s cubic-bezier(.2,1.6,.4,1); }
.wh-hub .p { font: 600 calc(var(--s) * .026) var(--mono); color: var(--text-3); margin-top: calc(var(--s) * .01); }
.wh-hub.w .m { color: var(--win); }
.wh-hub.g .m { background: var(--gold-grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
.wh-hub.g { box-shadow: 0 0 0 calc(var(--s) * .012) #0b0f17, 0 0 0 calc(var(--s) * .018) var(--gold), 0 0 60px rgba(245,184,61,.55), inset 0 2px 0 rgba(255,255,255,.07); }
.wh-hub.l .m { color: var(--text-3); }
.wh-hub.pop .m { transform: scale(1.18); }
.wh-leg { width: min(100%, calc(100cqw - 32px), 780px); display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 8px; }
.wh-chip { display: flex; align-items: center; gap: 9px; padding: 8px 11px; border-radius: 12px; background: var(--bg-1); border: 1px solid var(--line); min-width: 0; transition: border-color .2s, box-shadow .2s, background .2s; }
.wh-chip i { width: 12px; height: 12px; border-radius: 4px; flex: none; box-shadow: inset 0 1px 0 rgba(255,255,255,.25); }
.wh-chip div { min-width: 0; }
.wh-chip b { display: block; font: 700 14px var(--mono); white-space: nowrap; }
.wh-chip span { display: block; font: 600 11.5px var(--mono); color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wh-chip em { font-style: normal; }
.wh-chip.on { border-color: var(--gold); background: var(--gold-soft); box-shadow: 0 0 22px -6px rgba(245,184,61,.6); }
@container (min-aspect-ratio: 5/4) {
  .wh { width: auto; flex-direction: row; gap: clamp(20px, 4cqw, 64px); --s: min(calc(100cqh - 80px), calc(100cqw - 330px)); margin-top: 34px; }
  .wh-leg { width: 230px; grid-template-columns: 1fr; }
  .wh-chip { padding: 10px 14px; }
  .wh-chip b { font-size: 16px; }
}
@container (max-width: 480px) { .wh-leg { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; } .wh-chip { padding: 6px 8px; gap: 7px; } .wh-chip b { font-size: 12.5px; } .wh-chip span { font-size: 10.5px; } .wh-chip em { display: none; } }
`);

const WIN = [34, 199, 122];
const GOLD = [245, 184, 61];
const ZERO = ['#151b28', '#1b2232'];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c, k = 1) => `rgb(${c.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))).join(',')})`;

/** Segment colour: navy for blanks, emerald → gold as the multiplier grows. */
function palette(segs) {
  const vals = [...new Set(segs.filter((m) => m > 0))].sort((a, b) => a - b);
  const col = {};
  vals.forEach((m, i) => (col[m] = vals.length === 1 ? GOLD : mix(WIN, GOLD, i / (vals.length - 1))));
  return (m, i) => (m > 0 ? col[m] : null) || ZERO[i % 2];
}

export function mount(el, ctx) {
  const wheels = ctx.meta.wheels;
  let risk = load('casinoWheel') || 'medium';
  if (!wheels[risk]) risk = 'medium';
  let busy = false;
  let dead = false;
  let angle = 0; // wheel rotation, radians
  let hi = -1; // winning segment, highlighted
  let hiA = 0; // highlight strength
  let lights = 'idle';
  let raf = 0;
  let disk = null; // pre-rendered wheel face

  // ── Controls ──
  const bet = betBox(ctx);
  const go = h('button', { class: 'btn lg gold' }, 'Spin');
  const auto = autoplay(ctx, { button: go, play, lock: (on) => lockAll(on), label: 'Spin' });
  const riskSeg = seg([{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }], risk, (v) => {
    risk = v;
    keep('casinoWheel', v);
    hi = -1;
    disk = null;
    setHub(null);
    drawLegend();
    frame();
  });
  const sTop = stat('Top prize');
  const sChance = stat('Win chance');
  bet.onChange(() => drawLegend());

  // ── Stage ──
  const canvas = h('canvas');
  const g = canvas.getContext('2d');
  const pin = h(
    'div',
    { class: 'wh-pin' },
    h(
      'svg',
      { viewBox: '0 0 40 52' },
      h('defs', {}, h('linearGradient', { id: 'whPinG', x1: 0, y1: 0, x2: 0, y2: 1 }, h('stop', { offset: 0, 'stop-color': '#ffd88a' }), h('stop', { offset: 0.5, 'stop-color': '#f5b83d' }), h('stop', { offset: 1, 'stop-color': '#c98d1c' }))),
      h('path', { d: 'M20 51 C14 38 3 26 3 16 A17 17 0 0 1 37 16 C37 26 26 38 20 51Z', fill: 'url(#whPinG)', stroke: '#1b1304', 'stroke-width': 2 }),
      h('circle', { cx: 20, cy: 16, r: 6.5, fill: '#1b1304' }),
      h('circle', { cx: 18, cy: 14, r: 2, fill: '#ffd27a' }),
    ),
  );
  const hubM = h('div', { class: 'm' }, 'Spin');
  const hubP = h('div', { class: 'p' }, '');
  const hub = h('div', { class: 'wh-hub' }, h('div', {}, hubM, hubP));
  const wrap = h('div', { class: 'wh-wrap' }, canvas, pin, hub);
  const legend = h('div', { class: 'wh-leg' });
  const stageEl = h('div', { class: 'wh' }, wrap, legend);

  const segs = () => wheels[risk];
  let chips = {};
  function drawLegend() {
    const s = segs();
    const color = palette(s);
    const counts = {};
    s.forEach((m) => (counts[m] = (counts[m] || 0) + 1));
    chips = {};
    put(
      legend,
      Object.keys(counts)
        .map(Number)
        .sort((a, b) => a - b)
        .map((m) => {
          const c = color(m, 1);
          const chance = (counts[m] / s.length) * 100;
          const chip = h('div', { class: 'wh-chip', title: `${counts[m]} of ${s.length} segments` }, h('i', { style: { background: Array.isArray(c) ? rgb(c) : c, border: m ? '' : '1px solid var(--line-2)' } }), h('div', {}, h('b', {}, fmtMult(m)), h('span', {}, `${+chance.toFixed(1)}%`, h('em', {}, ` · ${fmt(Math.floor(bet.value * m + 1e-9))}`))));
          chips[m] = chip;
          return chip;
        }),
    );
    const max = Math.max(...s);
    sTop.set(`${fmt(Math.floor(bet.value * max + 1e-9))}`);
    sChance.set(`${+((s.filter((m) => m > 0).length / s.length) * 100).toFixed(1)}%`);
  }

  function setHub(mult, payout) {
    hub.className = 'wh-hub';
    if (mult == null) {
      hubM.textContent = 'Spin';
      hubP.textContent = '';
      return;
    }
    hubM.textContent = fmtMult(mult);
    hubP.textContent = payout ? `+${fmt(payout)}` : '';
    hub.classList.add(mult >= 10 ? 'g' : mult > 0 ? 'w' : 'l', 'pop');
    setTimeout(() => hub.classList.remove('pop'), 300);
  }

  // ── Drawing ──
  function size() {
    const r = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const S = Math.max(10, Math.round(r.width * dpr));
    if (canvas.width !== S) {
      canvas.width = canvas.height = S;
      disk = null;
    }
    return { S, dpr };
  }
  /** The spinning face, drawn once per size and risk. */
  function buildDisk(S, dpr) {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const d = c.getContext('2d');
    const s = segs();
    const n = s.length;
    const color = palette(s);
    const R = S / 2;
    const Ro = R * 0.9;
    const Ri = R * 0.3;
    const step = (2 * Math.PI) / n;
    const top = Math.max(...s);
    d.translate(R, R);
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + i * step - step / 2;
      const c0 = color(s[i], i);
      const grad = d.createRadialGradient(0, 0, Ri, 0, 0, Ro);
      if (Array.isArray(c0)) {
        const isTop = s[i] === top && s[i] > 0;
        grad.addColorStop(0, rgb(c0, 0.55));
        grad.addColorStop(0.7, rgb(c0, isTop ? 1.05 : 0.95));
        grad.addColorStop(1, isTop ? '#ffd27a' : rgb(c0, 1.12));
      } else {
        grad.addColorStop(0, '#0b0f17');
        grad.addColorStop(1, c0);
      }
      d.beginPath();
      d.moveTo(0, 0);
      d.arc(0, 0, Ro, a0, a0 + step);
      d.closePath();
      d.fillStyle = grad;
      d.fill();
      d.strokeStyle = 'rgba(7,9,14,.85)';
      d.lineWidth = Math.max(1, 1.6 * dpr);
      d.stroke();
    }
    // labels, reading outward
    d.textAlign = 'right';
    d.textBaseline = 'middle';
    d.font = `700 ${Math.round(R * 0.052)}px "Geist Mono", ui-monospace, monospace`;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + i * step;
      d.save();
      d.rotate(a);
      if (s[i] > 0) {
        d.fillStyle = 'rgba(11,15,23,.92)';
        d.fillText(fmtMult(s[i]), Ro - R * 0.045, 0);
      } else {
        d.beginPath();
        d.arc(Ro - R * 0.09, 0, R * 0.012, 0, Math.PI * 2);
        d.fillStyle = '#29334a';
        d.fill();
      }
      d.restore();
    }
    // inner shine
    const shine = d.createRadialGradient(0, -R * 0.3, R * 0.1, 0, 0, Ro);
    shine.addColorStop(0, 'rgba(255,255,255,.06)');
    shine.addColorStop(1, 'rgba(0,0,0,.18)');
    d.beginPath();
    d.arc(0, 0, Ro, 0, Math.PI * 2);
    d.fillStyle = shine;
    d.fill();
    return c;
  }

  function frame() {
    if (dead) return;
    const { S, dpr } = size();
    if (!disk) disk = buildDisk(S, dpr);
    const R = S / 2;
    const n = segs().length;
    const step = (2 * Math.PI) / n;
    const now = performance.now();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, S, S);
    // rim
    const rim = g.createLinearGradient(0, 0, 0, S);
    rim.addColorStop(0, '#29334a');
    rim.addColorStop(0.5, '#10151f');
    rim.addColorStop(1, '#1b2232');
    g.beginPath();
    g.arc(R, R, R - dpr, 0, Math.PI * 2);
    g.fillStyle = rim;
    g.fill();
    g.lineWidth = 1.5 * dpr;
    g.strokeStyle = 'rgba(245,184,61,.45)';
    g.stroke();
    g.beginPath();
    g.arc(R, R, R * 0.905, 0, Math.PI * 2);
    g.lineWidth = 3 * dpr;
    g.strokeStyle = '#07090e';
    g.stroke();
    // face
    g.save();
    g.translate(R, R);
    g.rotate(angle);
    g.drawImage(disk, -R, -R);
    if (hi >= 0 && hiA > 0) {
      const a0 = -Math.PI / 2 + hi * step - step / 2;
      g.beginPath();
      g.arc(0, 0, R * 0.9, 0, Math.PI * 2);
      g.moveTo(0, 0);
      g.arc(0, 0, R * 0.9, a0 + step, a0, true);
      g.closePath();
      g.fillStyle = `rgba(7,9,14,${0.5 * hiA})`;
      g.fill('evenodd');
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, R * 0.9, a0, a0 + step);
      g.closePath();
      g.shadowColor = 'rgba(255,210,122,.9)';
      g.shadowBlur = 18 * dpr * hiA;
      g.strokeStyle = `rgba(255,210,122,${hiA})`;
      g.lineWidth = 2.5 * dpr;
      g.stroke();
    }
    g.restore();
    // bulbs on the frame
    const B = 30;
    const tick = Math.floor(now / 70);
    for (let i = 0; i < B; i++) {
      const a = (i / B) * Math.PI * 2;
      const x = R + Math.cos(a) * R * 0.953;
      const y = R + Math.sin(a) * R * 0.953;
      let on = i % 2 === 0;
      if (lights === 'chase') on = (i + tick) % 4 === 0;
      if (lights === 'blink') on = Math.floor(now / 160) % 2 === 0;
      g.beginPath();
      g.arc(x, y, R * 0.017, 0, Math.PI * 2);
      if (on) {
        g.save();
        g.shadowColor = 'rgba(255,210,122,.95)';
        g.shadowBlur = 10 * dpr;
        g.fillStyle = '#ffd27a';
        g.fill();
        g.restore();
      } else {
        g.fillStyle = '#5a4520';
        g.fill();
      }
    }
  }
  function animate(on) {
    cancelAnimationFrame(raf);
    raf = 0;
    if (!on) return frame();
    const step = () => {
      frame();
      if (!dead) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  function lockAll(on) {
    bet.lock(on);
    riskSeg.lock(on);
  }

  async function play() {
    if (busy || dead) return null;
    busy = true;
    if (!auto.running) lockAll(true), (go.disabled = true);
    sfx.click();
    let res;
    try {
      res = await ctx.bet(bet.value, { risk });
    } catch {
      busy = false;
      if (!auto.running) lockAll(false), (go.disabled = false);
      return null;
    }
    const d = res.result;
    const n = segs().length;
    const step = (2 * Math.PI) / n;
    Object.values(chips).forEach((c) => c.classList.remove('on'));
    setHub(null);
    hubM.textContent = '';
    hi = -1;
    hiA = 0;
    lights = 'chase';
    animate(true);
    sfx.wheel();
    // Land the result under the pointer: a few whole turns, a small random offset, a tiny overshoot.
    const quick = auto.running;
    const jitter = (Math.random() - 0.5) * step * 0.5;
    let target = -d.index * step + jitter;
    while (target < angle + Math.PI * 2 * (quick ? 3 : 5)) target += Math.PI * 2;
    const over = step * 0.16;
    const from = angle;
    let last = Math.floor(angle / step + 0.5);
    const tickCheck = () => {
      const k = Math.floor(angle / step + 0.5);
      if (k !== last) {
        last = k;
        sfx.tick(1.1);
        pin.classList.add('kick');
        setTimeout(() => pin.classList.remove('kick'), 45);
      }
    };
    await tween(quick ? 2300 : 4200, (t) => {
      angle = from + (target + over - from) * ease.outQuint(t);
      tickCheck();
    });
    await tween(420, (t) => {
      angle = target + over - over * ease.inOut(t);
      tickCheck();
    });
    angle = target % (Math.PI * 2);
    sfx.stop();
    hi = d.index;
    lights = d.mult >= 1 ? 'blink' : 'idle';
    setHub(d.mult, res.payout);
    chips[d.mult]?.classList.add('on');
    hist.push(fmtMult(d.mult), d.mult >= 10 ? 'g' : d.mult > 1);
    showResult(p, res);
    ctx.settle(res);
    await tween(300, (t) => (hiA = t));
    setTimeout(() => {
      if (lights === 'blink') lights = 'idle';
      if (!busy) animate(false);
    }, quick ? 300 : 1400);
    busy = false;
    if (!auto.running) lockAll(false), (go.disabled = false);
    return res;
  }

  const L = gameLayout(el, ctx, { controls: [auto.mode, bet.el, auto.box, field('Risk', riskSeg.el), h('div', { class: 'stats' }, sTop.el, sChance.el), h('div', { class: 'spacer' }), go], stage: stageEl });
  const hist = history(L.bar);
  const p = pop(L.body);
  drawLegend();
  const ro = new ResizeObserver(() => !raf && frame());
  ro.observe(wrap);
  document.fonts?.ready.then(() => ((disk = null), !raf && frame()));
  const key = (e) => e.code === 'Space' && e.target === document.body && (e.preventDefault(), go.click());
  document.addEventListener('keydown', key);
  return {
    unmount() {
      dead = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('keydown', key);
    },
  };
}
