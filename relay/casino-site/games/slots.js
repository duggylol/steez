import { h, put, fmt, fmtMult, betBox, field, stat, seg, autoplay, gameLayout, history, pop, showResult, sfx, css, sleep, countUp, load, keep, symbolImg, icon } from '../ui.js';

css('slots', `
.sl { --side: 92px; --cw: min(calc((100cqw - var(--side)) / 5.36), calc((100cqh - 150px) / 3.2), 280px); --ch: min(calc(var(--cw) * 1.2), calc((100cqh - 150px) / 3.2)); --g: calc(var(--cw) * .05); --pad: calc(var(--cw) * .08);
  display: flex; flex-direction: column; align-items: center; gap: 12px; margin-top: 40px; }
@container (max-width: 640px) { .sl { --side: 24px; --ch: min(calc(var(--cw) * 1.6), calc((100cqh - 150px) / 3.2)); } .sl-mk { display: none !important; } }
.sl-cab { position: relative; padding: var(--pad); border-radius: calc(var(--cw) * .16); background: linear-gradient(180deg, #1f2738, #121823 60%, #0e131c); border: 1px solid rgba(245,184,61,.28);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.08), inset 0 0 0 4px rgba(7,9,14,.55), 0 30px 60px -28px #000, 0 0 70px -40px rgba(245,184,61,.6); transition: box-shadow .4s, border-color .4s; }
.sl-cab.fs { border-color: var(--gold); box-shadow: inset 0 1px 0 rgba(255,255,255,.1), inset 0 0 0 4px rgba(7,9,14,.55), 0 30px 60px -28px #000, 0 0 0 4px var(--gold-soft), 0 0 90px -20px rgba(245,184,61,.7); }
.sl-row { display: flex; align-items: stretch; gap: 8px; }
.sl-mk { width: 26px; display: grid; grid-template-rows: repeat(3, var(--ch)); }
.sl-mk > div { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 3px; }
.sl-mk button { width: 24px; height: min(22px, calc(var(--ch) / 4.6)); border-radius: 7px; border: 1px solid var(--line-2); background: var(--surface-3); color: var(--text-3); font: 700 11px var(--mono); padding: 0; display: grid; place-items: center; transition: background .2s, color .2s, box-shadow .2s; }
.sl-mk button:hover { color: var(--text); border-color: rgba(245,184,61,.5); }
.sl-mk button.on { background: var(--gold-grad); color: var(--gold-ink); border-color: #ffd88a; box-shadow: 0 0 14px rgba(245,184,61,.6); }
.sl-reels { position: relative; display: grid; grid-template-columns: repeat(5, var(--cw)); gap: var(--g); }
.sl-reel { position: relative; height: calc(var(--ch) * 3); overflow: hidden; border-radius: calc(var(--cw) * .1); background: linear-gradient(180deg, #0a0d14, #161d2b 50%, #0a0d14);
  box-shadow: inset 0 calc(var(--ch) * .12) calc(var(--ch) * .16) calc(var(--ch) * -.1) #000, inset 0 calc(var(--ch) * -.12) calc(var(--ch) * .16) calc(var(--ch) * -.1) #000, inset 0 0 0 1px rgba(255,255,255,.04); transition: box-shadow .3s; }
.sl-reel::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg, transparent calc(33.33% - .5px), rgba(255,255,255,.035) 33.33%, transparent calc(33.33% + .5px), transparent calc(66.66% - .5px), rgba(255,255,255,.035) 66.66%, transparent calc(66.66% + .5px)); }
.sl-reel.tease { box-shadow: inset 0 0 0 2px var(--gold), inset 0 0 40px rgba(245,184,61,.35), 0 0 30px -4px rgba(245,184,61,.7); animation: slTease .5s ease-in-out infinite alternate; }
@keyframes slTease { to { box-shadow: inset 0 0 0 2px var(--gold-hi), inset 0 0 60px rgba(245,184,61,.5), 0 0 44px 0 rgba(245,184,61,.8); } }
.sl-strip { position: absolute; left: 0; right: 0; top: 0; will-change: transform; }
.sl-reel.spin .sl-strip { filter: blur(2.5px) brightness(.85); }
.sl-cell { height: var(--ch); display: grid; place-items: center; position: relative; border-radius: calc(var(--cw) * .1); transition: opacity .25s, background .25s; }
.sl-cell img, .sl-cell .fb { width: min(calc(var(--cw) * .84), calc(var(--ch) * .84)); height: min(calc(var(--cw) * .84), calc(var(--ch) * .84)); object-fit: contain; filter: drop-shadow(0 6px 8px rgba(0,0,0,.65)); }
.sl-cell .fb { display: grid; place-items: center; font: 800 calc(var(--cw) * .2) var(--mono); color: var(--gold-hi); letter-spacing: -.03em; }
.sl-cell.land img { animation: slLand .35s cubic-bezier(.2,1.6,.4,1); }
.sl-cell.dim { opacity: .28; }
.sl-cell.win { background: radial-gradient(circle at 50% 50%, rgba(245,184,61,.22), transparent 70%); box-shadow: inset 0 0 0 2px rgba(245,184,61,.8), inset 0 0 26px rgba(245,184,61,.25); }
.sl-cell.win img, .sl-cell.win .fb { animation: slWin .9s ease-in-out infinite; }
@keyframes slWin { 50% { transform: scale(1.12); filter: drop-shadow(0 0 16px rgba(255,210,122,.85)); } }
@keyframes slLand { from { transform: scale(.82) translateY(-6%); } }
.sl-lines { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; filter: drop-shadow(0 0 6px rgba(245,184,61,.85)); z-index: 2; }
.sl-lines polyline { fill: none; stroke-linecap: round; stroke-linejoin: round; animation: slDraw .45s ease-out both; }
@keyframes slDraw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
.sl-rib { position: absolute; left: 50%; top: 0; transform: translate(-50%, -55%) scale(.6); opacity: 0; z-index: 3; display: flex; align-items: center; gap: 10px; padding: 6px 16px; border-radius: 999px; background: var(--gold-grad); color: var(--gold-ink); font-weight: 800; font-size: 12.5px; letter-spacing: .12em; text-transform: uppercase; white-space: nowrap; box-shadow: 0 8px 22px -8px rgba(245,184,61,.8), inset 0 1px 0 rgba(255,255,255,.5); transition: transform .35s cubic-bezier(.2,1.5,.4,1), opacity .25s; }
.sl-rib b { font-family: var(--mono); letter-spacing: 0; font-size: 14px; }
.sl-rib.show { transform: translate(-50%, -55%) scale(1); opacity: 1; }
.sl-rib.bump { animation: slBump .5s; }
@keyframes slBump { 40% { transform: translate(-50%, -55%) scale(1.18); } }
.sl-fs { position: absolute; inset: 0; z-index: 5; display: grid; place-items: center; border-radius: inherit; background: radial-gradient(circle at 50% 50%, rgba(27,19,4,.9), rgba(7,9,14,.94) 70%); opacity: 0; pointer-events: none; transition: opacity .3s; }
.sl-fs.show { opacity: 1; }
.sl-fs .in { text-align: center; transform: scale(.6); transition: transform .45s cubic-bezier(.2,1.5,.4,1); }
.sl-fs.show .in { transform: scale(1); }
.sl-fs img { width: clamp(48px, calc(var(--cw) * .7), 120px); margin: 0 auto 4px; filter: drop-shadow(0 0 24px rgba(245,184,61,.7)); animation: slSpinStar 2.4s linear infinite; }
@keyframes slSpinStar { to { transform: rotate(360deg); } }
.sl-fs .big { font: 800 clamp(34px, calc(var(--cw) * .62), 96px)/1 var(--mono); background: var(--gold-grad); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 6px 24px rgba(245,184,61,.45)); }
.sl-fs .t { font-weight: 800; letter-spacing: .3em; text-transform: uppercase; color: var(--gold-hi); font-size: clamp(13px, calc(var(--cw) * .13), 22px); margin-top: 6px; }
.sl-fs .s { color: var(--text-2); font-size: clamp(12px, calc(var(--cw) * .09), 15px); margin-top: 6px; font-weight: 600; }
.sl-meter { width: 100%; display: grid; grid-template-columns: 1fr 1.6fr 1fr; gap: 10px; }
.sl-meter > div { min-width: 0; height: 60px; border-radius: 14px; background: var(--bg-1); border: 1px solid var(--line); box-shadow: inset 0 2px 8px rgba(0,0,0,.45); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0 10px; }
.sl-meter .k { font-size: 10.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.sl-meter .v { font: 700 18px var(--mono); color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.sl-meter .mid { border-color: rgba(245,184,61,.25); }
.sl-meter .mid .v { font-size: 24px; color: var(--gold-hi); }
.sl-meter .mid.lit { border-color: var(--gold); box-shadow: inset 0 2px 8px rgba(0,0,0,.45), 0 0 0 3px var(--gold-soft), 0 0 30px -6px rgba(245,184,61,.6); }
.sl-meter .mid .k.msg { color: var(--text-2); letter-spacing: .02em; text-transform: none; font-size: 12px; font-weight: 600; }
@container (max-width: 640px) { .sl-meter { gap: 6px; } .sl-meter > div { height: 52px; padding: 0 6px; } .sl-meter .v { font-size: 14px; } .sl-meter .mid .v { font-size: 18px; } }
.sl-ptb { height: 28px !important; cursor: pointer; margin-left: 4px; color: var(--text) !important; }
.sl-ptb svg { width: 14px; height: 14px; }
.sl-ptb:hover { border-color: var(--gold) !important; }
@container (max-width: 640px) { .sl-ptb span { display: none; } .sl-ptb { padding: 0 8px !important; } }
.sl-pt { position: absolute; top: 52px; right: 12px; bottom: 12px; width: min(380px, calc(100cqw - 24px)); z-index: 9; display: flex; flex-direction: column; border-radius: 16px; background: rgba(13,17,26,.97); border: 1px solid var(--line-2); box-shadow: 0 30px 60px -20px #000; backdrop-filter: blur(10px); transform: translateX(calc(100% + 24px)); transition: transform .35s cubic-bezier(.2,.9,.3,1); }
.sl-pt.open { transform: none; }
.sl-pt .hd { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 10px; border-bottom: 1px solid var(--line); }
.sl-pt .hd b { font-size: 15px; }
.sl-pt .hd small { display: block; color: var(--text-3); font-size: 12px; font-weight: 500; }
.sl-pt .hd small b { font-family: var(--mono); color: var(--gold); font-size: 12px; }
.sl-pt .bd { overflow-y: auto; padding: 10px 12px 14px; display: grid; gap: 6px; }
.sl-pt .r { display: grid; grid-template-columns: 44px repeat(3, minmax(0, 1fr)); align-items: center; gap: 6px; padding: 4px 6px; border-radius: 10px; background: var(--bg-1); border: 1px solid var(--line); }
.sl-pt .r img, .sl-pt .r .fb { width: 40px; height: 40px; object-fit: contain; font: 800 11px var(--mono); color: var(--gold-hi); display: grid; place-items: center; }
.sl-pt .r span { text-align: right; font: 700 13px var(--mono); color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sl-pt .r span i { display: block; font-style: normal; font-size: 10.5px; color: var(--text-3); font-weight: 600; }
.sl-pt .r.h { background: none; border: 0; padding: 0 6px; }
.sl-pt .r.h span { font-size: 11px; color: var(--text-3); letter-spacing: .08em; }
.sl-pt .r.star { border-color: rgba(245,184,61,.35); background: var(--gold-soft); }
.sl-pt .r.star span { color: var(--gold-hi); }
.sl-pt .txt { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 10px; background: var(--bg-1); border: 1px solid var(--line); font-size: 12.5px; color: var(--text-2); line-height: 1.4; }
.sl-pt .txt img, .sl-pt .txt .fb { width: 40px; height: 40px; flex: none; object-fit: contain; font: 800 11px var(--mono); color: var(--gold-hi); display: grid; place-items: center; }
.sl-pt h4 { margin: 10px 2px 2px; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--text-3); }
.sl-pt .lns { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
.sl-pt .ln { padding: 5px; border-radius: 8px; background: var(--bg-1); border: 1px solid var(--line); }
.sl-pt .ln b { display: block; font: 700 10px var(--mono); color: var(--text-3); margin-bottom: 3px; }
.sl-pt .ln div { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1.5px; }
.sl-pt .ln i { aspect-ratio: 1; border-radius: 2px; background: var(--surface-3); }
.sl-pt .ln i.on { background: var(--gold); }
`);

const ORDER = ['crown', 'gem', 'seven', 'bar', 'bell', 'plum', 'lemon', 'cherry'];
const LABEL = { cherry: 'Cherry', lemon: 'Lemon', plum: 'Plum', bell: 'Bell', bar: 'BAR', seven: 'Seven', gem: 'Gem', crown: 'Crown', wild: 'Wild', star: 'Star' };
const FALLBACK = { cherry: 'CHR', lemon: 'LMN', plum: 'PLM', bell: 'BEL', bar: 'BAR', seven: '7', gem: 'GEM', crown: 'KNG', wild: 'WILD', star: '★' };
// Filler symbols for the blur, weighted roughly like the real strips.
const WEIGHT = { cherry: 7, lemon: 6, plum: 5, bell: 4, bar: 3, seven: 2, gem: 2, crown: 1, wild: 2, star: 1 };
const BAG = Object.entries(WEIGHT).flatMap(([s, n]) => Array(n).fill(s));
const rand = () => BAG[(Math.random() * BAG.length) | 0];

/** Symbol art, with a lettered stand-in if the image hasn't arrived. */
function sym(name) {
  const img = symbolImg(name);
  img.addEventListener('error', () => img.replaceWith(h('div', { class: 'fb' }, FALLBACK[name] || name)), { once: true });
  return img;
}
const cell = (name, land = false) => h('div', { class: `sl-cell${land ? ' land' : ''}`, 'data-s': name }, sym(name));

export function mount(el, ctx) {
  const m = ctx.meta;
  const LINES = m.lines;
  let busy = false;
  let dead = false;
  let turbo = load('casinoSlotsTurbo') === '1';
  let grid = [0, 1, 2, 3, 4].map(() => [rand(), rand(), rand()]);
  let cycle = 0;
  let lastSpin = null;
  // warm the image cache so the first spin doesn't flash empty cells
  Object.keys(WEIGHT).forEach((s) => (new Image().src = symbolImg(s).src));

  // ── Controls ──
  const bet = betBox(ctx);
  const go = h('button', { class: 'btn lg gold' }, 'Spin');
  const auto = autoplay(ctx, { button: go, play, lock: (on) => lockAll(on), label: 'Spin' });
  const speed = seg([{ value: 'normal', label: 'Normal' }, { value: 'turbo', label: 'Turbo' }], turbo ? 'turbo' : 'normal', (v) => ((turbo = v === 'turbo'), keep('casinoSlotsTurbo', turbo ? '1' : '0')));
  const sLast = stat('Last win');
  const sTop = stat('5 crowns pay');
  const ptBtn = h('button', { class: 'btn', onclick: () => togglePt() }, icon('info'), 'Paytable');

  // ── Reels ──
  const reels = [0, 1, 2, 3, 4].map(() => h('div', { class: 'sl-reel' }, h('div', { class: 'sl-strip' })));
  const lines = h('svg', { class: 'sl-lines' });
  const reelBox = h('div', { class: 'sl-reels' }, reels, lines);
  const markers = { l: [[], [], []], r: [[], [], []] };
  const pills = { l: [], r: [] };
  LINES.forEach((rows, i) => {
    markers.l[rows[0]].push(i);
    markers.r[rows[4]].push(i);
  });
  const markCol = (side) =>
    h(
      'div',
      { class: 'sl-mk' },
      markers[side].map((list) =>
        h(
          'div',
          {},
          list.map((i) => {
            const b = h('button', { type: 'button', title: `Line ${i + 1}`, onmouseenter: () => !busy && preview(i), onmouseleave: () => !busy && preview(null) }, i + 1);
            pills[side][i] = b;
            return b;
          }),
        ),
      ),
    );
  const rib = h('div', { class: 'sl-rib' });
  const fsBox = h('div', { class: 'sl-fs' });
  const cab = h('div', { class: 'sl-cab' }, rib, h('div', { class: 'sl-row' }, markCol('l'), reelBox, markCol('r')), fsBox);
  const meterL = { k: h('div', { class: 'k' }, 'Bet'), v: h('div', { class: 'v' }, '') };
  const meterM = { k: h('div', { class: 'k' }, 'Win'), v: h('div', { class: 'v' }, '0') };
  const meterR = { k: h('div', { class: 'k' }, 'Lines'), v: h('div', { class: 'v' }, String(LINES.length)) };
  const midBox = h('div', { class: 'mid' }, meterM.k, meterM.v);
  const meter = h('div', { class: 'sl-meter' }, h('div', {}, meterL.k, meterL.v), midBox, h('div', {}, meterR.k, meterR.v));
  const stageEl = h('div', { class: 'sl' }, cab, meter);

  // ── Paytable drawer ──
  const ptBody = h('div', { class: 'bd' });
  const ptBet = h('b', {}, '');
  const pt = h('div', { class: 'sl-pt', 'aria-hidden': 'true' }, h('div', { class: 'hd' }, h('div', {}, h('b', {}, 'Paytable'), h('small', {}, 'Pays for a bet of ', ptBet)), h('button', { class: 'btn ghost icon sm', title: 'Close', onclick: () => togglePt(false) }, '✕')), ptBody);
  function togglePt(on) {
    const open = on ?? !pt.classList.contains('open');
    pt.classList.toggle('open', open);
    pt.setAttribute('aria-hidden', String(!open));
    sfx.click();
  }
  function drawPays() {
    const b = bet.value;
    const pay = (mult) => fmt(Math.floor(b * mult + 1e-9));
    ptBet.textContent = fmt(b);
    meterL.v.textContent = fmt(b);
    sTop.set(pay(m.pays.crown[2]));
    put(
      ptBody,
      h('div', { class: 'r h' }, h('div'), ['3 in a row', '4 in a row', '5 in a row'].map((t) => h('span', {}, t))),
      ORDER.map((s) => h('div', { class: 'r' }, sym(s), m.pays[s].map((p) => h('span', {}, pay(p))))),
      h('div', { class: 'r star' }, sym('star'), [3, 4, 5].map((k) => h('span', {}, pay(m.scatter[k]), h('i', {}, `+${m.freeSpins[k]} spins`)))),
      h('div', { class: 'txt' }, sym('wild'), h('div', {}, h('b', { style: { color: 'var(--text)' } }, 'Wild'), ' lands on reels 2–5 and stands in for every symbol except the star. Five wilds pay like five crowns.')),
      h('div', { class: 'txt' }, sym('star'), h('div', {}, h('b', { style: { color: 'var(--text)' } }, 'Star'), ` pays anywhere. 3, 4 or 5 start ${m.freeSpins[3]}, ${m.freeSpins[4]} or ${m.freeSpins[5]} free spins where every win is ×${m.freeSpinMult}. Free spins can retrigger.`)),
      h('h4', {}, `${LINES.length} lines · pay left to right`),
      h('div', { class: 'lns' }, LINES.map((rows, i) => h('div', { class: 'ln' }, h('b', {}, i + 1), h('div', {}, [0, 1, 2].flatMap((row) => [0, 1, 2, 3, 4].map((r) => h('i', { class: rows[r] === row ? 'on' : '' }))))))),
    );
  }
  bet.onChange(drawPays);

  // ── Meter ──
  let shown = 0;
  function meterWin(label, amount, { count = false, lit = false } = {}) {
    meterM.k.className = 'k';
    meterM.k.textContent = label;
    midBox.classList.toggle('lit', lit);
    if (count && amount !== shown) countUp(meterM.v, amount, turbo ? 350 : 650, shown);
    else meterM.v.textContent = fmt(amount);
    shown = amount;
  }
  function meterMsg(msg) {
    meterM.k.className = 'k msg';
    meterM.k.textContent = msg;
  }

  // ── Reels: draw, spin, highlight ──
  const cells = () => reels.map((r) => [...r.firstChild.children]);
  function setReel(r, col) {
    put(reels[r].firstChild, col.map((s) => cell(s)));
    reels[r].firstChild.style.transform = 'translateY(0)';
  }

  /** Spin every reel to `next`, stopping left to right. Two stars showing slows the rest down. */
  async function spinTo(next, fast) {
    clearWins();
    const H = reels[0].clientHeight / 3;
    const base = fast ? 380 : 700;
    const gap = fast ? 110 : 200;
    const tease = fast ? 520 : 950;
    let extra = 0;
    let prevStop = 0;
    const stops = reels.map((reel, r) => {
      const strip = reel.firstChild;
      const starsBefore = next.slice(0, r).filter((c) => c.includes('star')).length;
      if (starsBefore >= 2) extra += tease;
      const dur = base + r * gap + extra;
      const filler = Array.from({ length: Math.max(8, Math.round(dur / (fast ? 40 : 48))) }, rand);
      put(strip, [...next[r].map((s) => cell(s)), ...filler.map((s) => cell(s)), ...grid[r].map((s) => cell(s))]);
      const dist = (filler.length + 3) * H;
      strip.style.transform = `translateY(${-dist}px)`;
      reel.classList.add('spin');
      const teaseAt = prevStop;
      prevStop = dur;
      if (starsBefore >= 2) setTimeout(() => !dead && reel.classList.add('tease'), teaseAt);
      setTimeout(() => reel.classList.remove('spin'), dur * 0.82);
      const anim = strip.animate([{ transform: `translateY(${-dist}px)` }, { transform: `translateY(${H * 0.09}px)`, offset: 0.93 }, { transform: 'translateY(0)' }], { duration: dur, easing: 'cubic-bezier(.32,.06,.28,1)' });
      // a hidden tab may never finish the animation: the timer still lands the reel
      return Promise.race([anim.finished.catch(() => {}), sleep(dur + 120)])
        .then(() => {
          anim.cancel();
          reel.classList.remove('spin', 'tease');
          strip.style.transform = 'translateY(0)';
          put(strip, next[r].map((s) => cell(s, true)));
          sfx.stop();
          if (next[r].includes('star')) sfx.gem();
        });
    });
    sfx.spin();
    await Promise.all(stops);
    grid = next;
  }

  function clearWins() {
    clearInterval(cycle);
    cycle = 0;
    lines.replaceChildren();
    cells().flat().forEach((c) => c.classList.remove('win', 'dim'));
    [...pills.l, ...pills.r].forEach((b) => b?.classList.remove('on'));
  }
  /** Draw a payline across the reels, from the left edge to the right. */
  function drawLine(i, part = 5) {
    const box = reelBox.getBoundingClientRect();
    lines.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    const pts = LINES[i].map((row, r) => {
      const rr = reels[r].getBoundingClientRect();
      return [rr.left - box.left + rr.width / 2, rr.top - box.top + ((row + 0.5) * rr.height) / 3];
    });
    pts.unshift([0, pts[0][1]]);
    pts.push([box.width, pts[pts.length - 1][1]]);
    const w = Math.max(2.5, box.width / 260);
    const poly = (stroke, width, op) => h('polyline', { points: pts.map((p) => p.join(',')).join(' '), stroke, 'stroke-width': width, opacity: op, pathLength: 1, 'stroke-dasharray': 1 });
    lines.append(poly('#c98d1c', w * 2.4, 0.55), poly(part ? '#ffd27a' : '#a7b0c3', w, 1));
    pills.l[i]?.classList.add('on');
    pills.r[i]?.classList.add('on');
  }
  /** Light up a spin's wins: every line at once, or just line win `only`. */
  function highlight(spin, only = null) {
    const C = cells();
    lines.replaceChildren();
    C.flat().forEach((c) => c.classList.remove('win', 'dim'));
    [...pills.l, ...pills.r].forEach((b) => b?.classList.remove('on'));
    const wins = only == null ? spin.wins : [spin.wins[only]];
    const stars = only == null && spin.stars >= 3;
    if (!wins.length && !stars) return;
    C.flat().forEach((c) => c.classList.add('dim'));
    for (const w of wins) {
      LINES[w.line].slice(0, w.count).forEach((row, r) => (C[r][row].classList.remove('dim'), C[r][row].classList.add('win')));
      drawLine(w.line);
    }
    if (stars) C.flat().forEach((c) => c.dataset.s === 'star' && (c.classList.remove('dim'), c.classList.add('win')));
  }
  function winText(w, mult) {
    return `Line ${w.line + 1} · ${w.count}× ${LABEL[w.symbol]}${mult > 1 ? ` ×${mult}` : ''} · +${fmt(w.win)}`;
  }
  /** After a manual spin, step through the winning lines one by one until the next spin. */
  function startCycle(spin) {
    const list = spin.wins.map((w, i) => i);
    if (spin.stars >= 3) list.push('stars');
    if (list.length < 2) return;
    let k = 0;
    cycle = setInterval(() => {
      if (dead || busy) return clearInterval(cycle);
      const it = list[k++ % list.length];
      if (it === 'stars') {
        highlight({ wins: [], stars: spin.stars });
        meterMsg(`${spin.stars} stars · +${fmt(spin.scatter)}`);
      } else {
        highlight(spin, it);
        meterMsg(winText(spin.wins[it], spin.free ? m.freeSpinMult : 1));
      }
    }, 1400);
  }
  function preview(i) {
    if (i == null) return lastSpin ? highlight(lastSpin) : clearWins();
    clearWins();
    drawLine(i, 0);
  }

  // ── Free-spin banners ──
  async function banner(content, ms) {
    put(fsBox, h('div', { class: 'in' }, content));
    fsBox.classList.add('show');
    await sleep(ms);
    fsBox.classList.remove('show');
    await sleep(300);
  }
  function ribbon(played, total) {
    put(rib, 'Free spin ', h('b', {}, `${played} / ${total}`), ` · ×${m.freeSpinMult}`);
    rib.classList.add('show');
  }

  function lockAll(on) {
    bet.lock(on);
  }

  // ── One paid spin, with any free spins it starts ──
  async function play() {
    if (busy || dead) return null;
    busy = true;
    if (!auto.running) lockAll(true), (go.disabled = true);
    clearWins();
    lastSpin = null;
    sfx.click();
    let res;
    try {
      res = await ctx.bet(bet.value);
    } catch {
      busy = false;
      if (!auto.running) lockAll(false), (go.disabled = false);
      return null;
    }
    const spins = res.result.spins;
    const fast = turbo;
    shown = 0;
    meterWin('Good luck', 0);
    await spinTo(spins[0].grid, fast);
    let total = spins[0].win;
    if (spins[0].wins.length || spins[0].stars >= 3) {
      highlight(spins[0]);
      meterWin('Win', total, { count: true, lit: true });
      if (spins[0].wins.length === 1 && spins[0].stars < 3) meterMsg(winText(spins[0].wins[0], 1));
      await sleep(spins.length > 1 ? 1000 : fast ? 250 : 500);
    } else meterWin('No win', 0);

    if (spins.length > 1 && !dead) {
      let awarded = spins[0].freeSpins;
      sfx.big();
      await banner([h('img', { src: symbolImg('star').src, alt: '' }), h('div', { class: 'big' }, awarded), h('div', { class: 't' }, 'Free spins'), h('div', { class: 's' }, `Every win ×${m.freeSpinMult}`)], auto.running || fast ? 1300 : 2000);
      cab.classList.add('fs');
      meterR.k.textContent = 'Free spins';
      for (let i = 1; i < spins.length && !dead; i++) {
        const s = spins[i];
        ribbon(i, awarded);
        meterR.v.textContent = `${i} / ${awarded}`;
        meterWin('Total win', total, { lit: true });
        await spinTo(s.grid, true);
        total += s.win;
        if (s.wins.length || s.stars >= 3) {
          highlight(s);
          sfx.win();
          meterWin('Total win', total, { count: true, lit: true });
          if (s.wins.length === 1 && s.stars < 3) meterMsg(winText(s.wins[0], m.freeSpinMult));
        }
        if (s.freeSpins) {
          awarded += s.freeSpins;
          sfx.big();
          ribbon(i, awarded);
          rib.classList.remove('bump');
          void rib.offsetWidth;
          rib.classList.add('bump');
          meterR.v.textContent = `${i} / ${awarded}`;
          meterMsg(`+${s.freeSpins} more free spins!`);
        }
        await sleep(s.win || s.freeSpins ? 850 : 260);
      }
      rib.classList.remove('show');
      await banner([h('div', { class: 't' }, 'Total win'), h('div', { class: 'big' }, `+${fmt(res.payout)}`), h('div', { class: 's' }, `${spins.length - 1} free spins · ${fmtMult(res.payout / res.cost)} your bet`)], auto.running ? 1300 : 1900);
      cab.classList.remove('fs');
      meterR.k.textContent = 'Lines';
      meterR.v.textContent = String(LINES.length);
    }

    const last = spins[spins.length - 1];
    if (res.payout) meterWin(spins.length > 1 ? 'Total win' : 'Win', res.payout, { lit: true });
    sLast.set(res.payout ? fmt(res.payout) : '0');
    const mult = res.cost ? res.payout / res.cost : 0;
    hist.push(fmtMult(mult), mult >= 10 ? 'g' : mult > 1);
    showResult(p, res);
    ctx.settle(res);
    lastSpin = last;
    if (!auto.running && !dead) startCycle(last);
    busy = false;
    if (!auto.running) lockAll(false), (go.disabled = false);
    return res;
  }

  const L = gameLayout(el, ctx, { controls: [auto.mode, bet.el, auto.box, field('Spin speed', speed.el), h('div', { class: 'stats' }, sLast.el, sTop.el), ptBtn, h('div', { class: 'spacer' }), go], stage: stageEl });
  L.body.append(pt);
  L.bar.append(h('button', { class: 'badge sl-ptb', onclick: () => togglePt() }, icon('info'), h('span', {}, 'Paytable')));
  const hist = history(L.bar);
  L.bar.append(L.bar.querySelector('.sl-ptb'));
  const p = pop(L.body);
  reels.forEach((_, r) => setReel(r, grid[r]));
  drawPays();
  const key = (e) => e.code === 'Space' && e.target === document.body && (e.preventDefault(), go.click());
  const esc = (e) => e.key === 'Escape' && pt.classList.contains('open') && togglePt(false);
  document.addEventListener('keydown', key);
  document.addEventListener('keydown', esc);
  return {
    unmount() {
      dead = true;
      clearInterval(cycle);
      document.removeEventListener('keydown', key);
      document.removeEventListener('keydown', esc);
    },
  };
}
