import { h, put, fmt, fmtMult, betBox, field, stat, seg, autoplay, gameLayout, history, pop, showResult, sfx, css, sleep, load, keep } from '../ui.js';

css('keno', `
.kn { --cols: 8; --rows: 5; --g: clamp(5px, 1.1cqmin, 12px);
  --tw: min(calc((100cqw - 36px - (var(--cols) - 1) * var(--g)) / var(--cols)), calc((100cqh - 180px - (var(--rows) - 1) * var(--g)) / var(--rows)), 220px);
  --th: min(calc(var(--tw) * 1.35), calc((100cqh - 180px - (var(--rows) - 1) * var(--g)) / var(--rows)));
  display: flex; flex-direction: column; align-items: center; gap: clamp(10px, 2cqh, 18px); margin-top: 40px; }
.kn-board { display: grid; grid-template-columns: repeat(var(--cols), var(--tw)); grid-auto-rows: var(--th); gap: var(--g); }
.kt { position: relative; border: 0; padding: 0; border-radius: calc(min(var(--tw), var(--th)) * .18); font: 700 calc(min(var(--tw), var(--th)) * .34) var(--mono); color: var(--text-2);
  background: linear-gradient(180deg, #232c40, #1a2132); box-shadow: 0 calc(min(var(--tw), var(--th)) * .06) 0 #0d121c, inset 0 1px 0 rgba(255,255,255,.06);
  transition: transform .12s, background .15s, color .15s, box-shadow .15s, opacity .25s; display: grid; place-items: center; overflow: hidden; }
.kt:hover:not(:disabled) { transform: translateY(-2px); background: linear-gradient(180deg, #2c3750, #20283c); color: var(--text); box-shadow: 0 calc(min(var(--tw), var(--th)) * .08) 0 #0d121c, 0 0 0 1px rgba(245,184,61,.35), inset 0 1px 0 rgba(255,255,255,.08); }
.kt:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 2px 0 #0d121c; }
.kt:disabled { cursor: default; }
.kt.pick { background: linear-gradient(180deg, #3a3018, #241d0e); color: var(--gold-hi); box-shadow: 0 calc(min(var(--tw), var(--th)) * .06) 0 #120d03, inset 0 0 0 2px var(--gold), inset 0 0 22px rgba(245,184,61,.18); }
.kt.pick:hover:not(:disabled) { background: linear-gradient(180deg, #46391c, #2b2210); box-shadow: 0 calc(min(var(--tw), var(--th)) * .08) 0 #120d03, inset 0 0 0 2px var(--gold-hi), inset 0 0 26px rgba(245,184,61,.25); }
.kt.in { animation: knIn .3s cubic-bezier(.2,1.6,.4,1); }
.kt.miss { background: var(--bg-1); color: var(--text-3); box-shadow: inset 0 0 0 1px var(--line-2), inset 0 3px 10px rgba(0,0,0,.55); transform: translateY(2px); }
.kt.miss::after { content: ''; position: absolute; left: 50%; top: 50%; width: calc(min(var(--tw), var(--th)) * .62); aspect-ratio: 1; transform: translate(-50%, -50%); border-radius: 50%; border: 2px solid var(--line-2); }
.kt.hit { background: radial-gradient(circle at 50% 40%, #ffe3a3, #f5b83d 55%, #c98d1c); color: var(--gold-ink); box-shadow: 0 calc(min(var(--tw), var(--th)) * .06) 0 #7a520c, 0 0 34px -2px rgba(245,184,61,.75), inset 0 1px 0 rgba(255,255,255,.6); z-index: 1; }
.kt { isolation: isolate; }
.kt.hit::before { content: ''; position: absolute; inset: -40%; z-index: -1; background: conic-gradient(from 0deg, transparent, rgba(255,255,255,.55), transparent 30%); animation: knShine 1.2s linear 1; opacity: 0; }
.kt.hit::after { content: ''; position: absolute; top: 9%; right: 9%; width: 18%; height: 18%; border-radius: 50%; background: var(--win); box-shadow: 0 0 10px var(--win); }
.kt.drawn { animation: knPop .38s cubic-bezier(.2,1.6,.4,1); }
.kt.cold { opacity: .5; }
@keyframes knIn { from { transform: scale(.82); } }
@keyframes knPop { from { transform: scale(.55) rotate(-8deg); } }
@keyframes knShine { 0% { opacity: 1; transform: rotate(0); } 100% { opacity: 0; transform: rotate(270deg); } }
.kn-pay { width: calc(var(--cols) * var(--tw) + (var(--cols) - 1) * var(--g)); max-width: calc(100cqw - 24px); display: flex; gap: 6px; min-height: 58px; }
.kn-pay .c { flex: 1; min-width: 0; overflow: hidden; height: 58px; border-radius: 12px; background: var(--bg-1); border: 1px solid var(--line); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; transition: border-color .2s, background .2s, box-shadow .2s, transform .2s; }
.kn-pay .c b { font: 700 clamp(11px, 1.6cqw, 15px) var(--mono); color: var(--text); white-space: nowrap; }
.kn-pay .c span { font: 600 clamp(9.5px, 1.2cqw, 11.5px) var(--mono); color: var(--text-3); white-space: nowrap; }
.kn-pay .c span em { font-style: normal; }
.kn-pay .c.z b { color: var(--text-3); }
.kn-pay .c.now { border-color: var(--gold); background: var(--gold-soft); transform: translateY(-3px); box-shadow: 0 0 24px -6px rgba(245,184,61,.6); }
.kn-pay .c.now b { color: var(--gold-hi); }
.kn-pay .c.won { border-color: var(--win); background: var(--win-soft); box-shadow: 0 0 24px -6px rgba(34,199,122,.6); }
.kn-pay .c.won b { color: var(--win); }
.kn-pay .empty { flex: 1; height: 58px; border-radius: 12px; border: 1px dashed var(--line-2); display: grid; place-items: center; color: var(--text-3); font-size: 13px; font-weight: 600; }
@container (max-width: 520px) { .kn { --th: min(calc(var(--tw) * 1.5), calc((100cqh - 180px - (var(--rows) - 1) * var(--g)) / var(--rows))); } .kn-pay { gap: 2px; } .kn-pay .c, .kn-pay .empty { height: 50px; border-radius: 9px; } .kn-pay .c b { font-size: 9px; letter-spacing: -.07em; } .kn-pay .c span { font-size: 9px; } .kn-pay .c span em { display: none; } }
.kn-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
`);

/** Short multiplier for the pay row: 0×, 2.4×, 62.2×, 377×, 1.1K×. */
const compact = (m) => `${!m ? 0 : m >= 1000 ? `${+(m / 1000).toFixed(1)}K` : m >= 100 ? Math.round(m) : m >= 10 ? +m.toFixed(1) : +m.toFixed(2)}×`;

export function mount(el, ctx) {
  const tables = ctx.meta.tables;
  let risk = load('casinoKenoRisk', 'medium');
  if (!tables[`${risk}-1`]) risk = 'medium';
  let picks = new Set();
  try {
    JSON.parse(load('casinoKenoPicks', '[]'))
      .map(Number)
      .filter((n) => n >= 1 && n <= 40)
      .slice(0, 10)
      .forEach((n) => picks.add(n));
  } catch {
    /* fresh board */
  }
  let busy = false;
  let dead = false;
  let drawnShown = false;

  // ── Controls ──
  const bet = betBox(ctx);
  const go = h('button', { class: 'btn lg gold' }, 'Bet');
  const auto = autoplay(ctx, { button: go, play, lock: (on) => lockAll(on), label: 'Bet' });
  const riskSeg = seg([{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }], risk, (v) => ((risk = v), keep('casinoKenoRisk', v), draw()));
  const autoBtn = h('button', { class: 'btn', onclick: autoPick }, 'Auto pick');
  const clearBtn = h('button', { class: 'btn', onclick: () => (busy ? null : (sfx.click(), clearDraw(), picks.clear(), save(), draw())) }, 'Clear');
  const sPicks = stat('Picked');
  const sTop = stat('Top pay');
  bet.onChange(() => draw());

  // ── Board ──
  const tiles = Array.from({ length: 40 }, (_, i) => h('button', { class: 'kt', type: 'button', 'aria-label': `Number ${i + 1}`, onclick: () => toggle(i + 1) }, i + 1));
  const payRow = h('div', { class: 'kn-pay' });
  const stageEl = h('div', { class: 'kn' }, h('div', { class: 'kn-board' }, tiles), payRow);
  let payCells = [];

  const table = () => tables[`${risk}-${picks.size}`] || [];
  const save = () => keep('casinoKenoPicks', JSON.stringify([...picks]));

  function draw() {
    tiles.forEach((t, i) => t.classList.toggle('pick', picks.has(i + 1)));
    sPicks.set(`${picks.size} / 10`);
    const tb = table();
    sTop.set(picks.size ? fmt(Math.floor(bet.value * Math.max(...tb) + 1e-9)) : '—');
    if (!picks.size) {
      payCells = [];
      put(payRow, h('div', { class: 'empty' }, 'Pick 1 to 10 numbers'));
      return;
    }
    payCells = tb.map((m, k) => h('div', { class: `c${m ? '' : ' z'}`, title: `${k} hit${k === 1 ? '' : 's'}: ${fmtMult(m)}${m ? ` · ${fmt(Math.floor(bet.value * m + 1e-9))} ${ctx.casino.currency}` : ''}` }, h('b', {}, compact(m)), h('span', {}, k, h('em', {}, k === 1 ? ' hit' : ' hits'))));
    put(payRow, payCells);
  }
  function clearDraw() {
    if (!drawnShown) return;
    drawnShown = false;
    tiles.forEach((t) => t.classList.remove('hit', 'miss', 'drawn', 'cold'));
    payCells.forEach((c) => c.classList.remove('now', 'won'));
  }
  function toggle(n) {
    if (busy || auto.running) return;
    clearDraw();
    if (picks.has(n)) {
      picks.delete(n);
      sfx.click();
    } else {
      if (picks.size >= 10) return ctx.toast('You can pick up to 10 numbers.');
      picks.add(n);
      sfx.tick(1.2);
      const t = tiles[n - 1];
      t.classList.remove('in');
      void t.offsetWidth;
      t.classList.add('in');
    }
    save();
    draw();
  }
  async function autoPick() {
    if (busy || auto.running) return;
    clearDraw();
    const count = picks.size || 10;
    picks.clear();
    draw();
    const pool = Array.from({ length: 40 }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    busy = true;
    lockAll(true);
    go.disabled = true;
    for (const n of pool.slice(0, count)) {
      if (dead) return;
      picks.add(n);
      tiles[n - 1].classList.add('in');
      sfx.tick(1 + picks.size / 10);
      draw();
      await sleep(45);
    }
    tiles.forEach((t) => t.classList.remove('in'));
    save();
    busy = false;
    lockAll(false);
    go.disabled = false;
  }

  function lockAll(on) {
    bet.lock(on);
    riskSeg.lock(on);
    autoBtn.disabled = clearBtn.disabled = on;
    tiles.forEach((t) => (t.disabled = on));
  }

  async function play() {
    if (busy || dead) return null;
    if (!picks.size) {
      ctx.toast('Pick 1 to 10 numbers first.', true);
      return null;
    }
    busy = true;
    if (!auto.running) lockAll(true), (go.disabled = true);
    sfx.click();
    let res;
    try {
      res = await ctx.bet(bet.value, { picks: [...picks], risk });
    } catch {
      busy = false;
      if (!auto.running) lockAll(false), (go.disabled = false);
      return null;
    }
    drawnShown = true;
    tiles.forEach((t) => t.classList.remove('hit', 'miss', 'drawn', 'cold'));
    payCells.forEach((c) => c.classList.remove('now', 'won'));
    const d = res.result;
    const gap = auto.running ? 75 : 150;
    let hits = 0;
    for (const n of d.drawn) {
      if (dead) break;
      const t = tiles[n - 1];
      const hit = picks.has(n);
      t.classList.add('drawn', hit ? 'hit' : 'miss');
      sfx.pop();
      if (hit) {
        hits++;
        sfx.gem();
        payCells.forEach((c, k) => c.classList.toggle('now', k === hits));
      }
      await sleep(gap);
    }
    tiles.forEach((t, i) => picks.has(i + 1) && !d.drawn.includes(i + 1) && t.classList.add('cold'));
    payCells.forEach((c) => c.classList.remove('now'));
    payCells[d.hits.length]?.classList.add(d.mult > 0 ? 'won' : 'now');
    hist.push(fmtMult(d.mult), d.mult >= 10 ? 'g' : d.mult > 1);
    showResult(p, res);
    ctx.settle(res);
    busy = false;
    if (!auto.running) lockAll(false), (go.disabled = false);
    return res;
  }

  const L = gameLayout(el, ctx, {
    controls: [auto.mode, bet.el, auto.box, field('Risk', riskSeg.el), h('div', { class: 'kn-btns' }, autoBtn, clearBtn), h('div', { class: 'stats' }, sPicks.el, sTop.el), h('div', { class: 'spacer' }), go],
    stage: stageEl,
  });
  const hist = history(L.bar);
  const p = pop(L.body);
  draw();
  const key = (e) => e.code === 'Space' && e.target === document.body && (e.preventDefault(), go.click());
  document.addEventListener('keydown', key);
  return {
    unmount() {
      dead = true;
      document.removeEventListener('keydown', key);
    },
  };
}
