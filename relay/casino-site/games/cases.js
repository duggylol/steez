import { h, put, fmt, fmtMult, betBox, field, stat, autoplay, gameLayout, history, pop, showResult, sfx, css, load, keep, asset, symbolImg, sleep } from '../ui.js';

css('cases', `
.cs { width: 100%; height: 100%; display: grid; grid-template-rows: auto auto minmax(0, 1fr); gap: clamp(10px, 2.2cqh, 22px); padding: 54px clamp(10px, 2.6cqw, 28px) clamp(12px, 2.4cqh, 22px); }
.cs-head { display: flex; align-items: center; gap: clamp(10px, 2cqw, 18px); min-width: 0; }
.cs-chest { width: clamp(46px, 9cqmin, 92px); aspect-ratio: 1; flex: none; display: grid; place-items: center; position: relative; }
.cs-chest::before { content: ''; position: absolute; inset: -12%; border-radius: 50%; background: radial-gradient(circle, rgba(245,184,61,.25), transparent 65%); }
.cs-chest img { position: relative; width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 8px 14px rgba(0,0,0,.6)); }
.cs-chest.open img { animation: csOpen .55s cubic-bezier(.3,1.5,.5,1); }
@keyframes csOpen { 0% { transform: scale(1); } 25% { transform: scale(.88) rotate(-6deg); } 50% { transform: scale(1.12) rotate(5deg); } 75% { transform: rotate(-3deg); } }
.cs-head .t b { display: block; font-size: clamp(16px, 2.8cqmin, 24px); letter-spacing: -.02em; }
.cs-head .t span { color: var(--text-3); font-size: clamp(12px, 1.8cqmin, 14px); font-weight: 600; }
.cs-head .t span em { font-style: normal; color: var(--gold-hi); font-family: var(--mono); }
.cs-reel { --iw: clamp(84px, min(17cqw, 24cqh), 190px); height: calc(var(--iw) * 1.32 + 26px); position: relative; overflow: hidden; border-radius: clamp(12px, 2cqmin, 18px); background: linear-gradient(180deg, var(--bg-1), #0d121c 50%, var(--bg-1)); border: 1px solid var(--line); box-shadow: inset 0 2px 14px rgba(0,0,0,.6); min-height: 0; display: flex; align-items: center; }
.cs-reel::before, .cs-reel::after { content: ''; position: absolute; top: 0; bottom: 0; width: 18%; z-index: 2; pointer-events: none; }
.cs-reel::before { left: 0; background: linear-gradient(90deg, var(--bg-1), transparent); }
.cs-reel::after { right: 0; background: linear-gradient(-90deg, var(--bg-1), transparent); }
.cs-strip { display: flex; gap: 10px; padding: 0 10px; will-change: transform; height: calc(100% - 26px); }
.cs-mark { position: absolute; left: 50%; top: 0; bottom: 0; width: 3px; margin-left: -1.5px; background: var(--gold-grad); z-index: 3; box-shadow: 0 0 16px rgba(245,184,61,.8); pointer-events: none; }
.cs-mark::before, .cs-mark::after { content: ''; position: absolute; left: 50%; margin-left: -9px; border: 9px solid transparent; }
.cs-mark::before { top: 0; border-top-color: var(--gold); }
.cs-mark::after { bottom: 0; border-bottom-color: var(--gold); }
.ci { --c: var(--line-2); --g: transparent; position: relative; flex: none; width: var(--iw); height: 100%; border-radius: clamp(10px, 1.6cqmin, 14px); background: radial-gradient(120% 80% at 50% 0%, var(--g), transparent 70%), linear-gradient(180deg, var(--surface-3), var(--surface-2)); border: 1px solid var(--line-2); box-shadow: inset 0 -3px 0 var(--c), 0 8px 18px -10px #000; display: grid; grid-template-rows: minmax(0, 1fr) auto auto; justify-items: center; align-items: center; padding: calc(var(--iw) * .09) calc(var(--iw) * .06) calc(var(--iw) * .08); overflow: hidden; transition: transform .3s, box-shadow .3s, opacity .3s; }
.ci .ic { width: 62%; height: 100%; max-height: calc(var(--iw) * .62); object-fit: contain; filter: drop-shadow(0 6px 10px rgba(0,0,0,.55)); min-height: 0; }
.ci .ic.gone { visibility: hidden; }
.ci b { font-family: var(--mono); font-weight: 700; font-size: clamp(13px, calc(var(--iw) * .15), 24px); letter-spacing: -.03em; color: var(--text); line-height: 1.1; }
.ci small { font-family: var(--mono); font-weight: 600; font-size: clamp(10px, calc(var(--iw) * .09), 13px); color: var(--text-3); }
.ci.r1 { --c: var(--win); --g: rgba(34,199,122,.18); border-color: rgba(34,199,122,.3); }
.ci.r1 b { color: var(--win); }
.ci.r2 { --c: var(--gold); --g: rgba(245,184,61,.2); border-color: rgba(245,184,61,.35); }
.ci.r2 b { color: var(--gold-hi); }
.ci.r3 { --c: var(--gold-hi); --g: rgba(255,210,122,.34); border-color: rgba(255,210,122,.6); box-shadow: inset 0 -3px 0 var(--c), 0 0 26px -6px rgba(245,184,61,.6), 0 8px 18px -10px #000; }
.ci.r3 b { background: var(--gold-grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
.cs-strip .ci.win { transform: scale(1.08); z-index: 1; box-shadow: inset 0 -3px 0 var(--c), 0 0 0 2px var(--c), 0 0 40px -4px var(--c); }
.cs-strip.done .ci:not(.win) { opacity: .35; }
.cs-items { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); grid-auto-rows: minmax(0, 1fr); gap: clamp(6px, 1.2cqmin, 12px); min-height: 0; }
.cs-items.odd .ci:last-child { grid-column: span 2; }
.cs-items .ci { width: auto; height: auto; min-height: 0; padding: clamp(6px, 1.4cqmin, 14px) 6px clamp(6px, 1.2cqmin, 12px); }
.cs-items .ci .ic { max-height: none; width: 60%; }
.cs-items .ci b { font-size: clamp(12px, 2.4cqmin, 20px); }
.cs-items .ci small { font-size: clamp(10px, 1.6cqmin, 12.5px); }
.cs-items .ci.hit { animation: csHit .9s; }
@keyframes csHit { 30% { transform: translateY(-6px); box-shadow: inset 0 -3px 0 var(--c), 0 0 0 2px var(--c), 0 0 30px -4px var(--c); } }
@container (min-aspect-ratio: 2 / 1) {
  .cs-items { grid-template-columns: repeat(var(--n), minmax(0, 1fr)); }
  .cs-items.odd .ci:last-child { grid-column: auto; }
}
.cs-tiers { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.cs-tiers button { position: relative; border-radius: 12px; border: 1px solid var(--line-2); background: var(--bg-1); padding: 8px 4px 7px; display: grid; justify-items: center; gap: 3px; transition: border-color .15s, background .15s; }
.cs-tiers button:hover:not(:disabled) { border-color: #36415a; }
.cs-tiers button.on { border-color: var(--gold); background: var(--gold-soft); }
.cs-tiers button:disabled { opacity: .5; cursor: not-allowed; }
.cs-tiers img { width: 40px; height: 40px; object-fit: contain; }
.cs-tiers img.gone { display: none; }
.cs-tiers span { font-size: 12px; font-weight: 700; color: var(--text-2); }
.cs-tiers small { font-family: var(--mono); font-size: 11px; font-weight: 700; color: var(--gold-hi); }
`);

const TIERS = ['bronze', 'silver', 'gold', 'diamond'];
const NAME = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', diamond: 'Diamond' };
const SYMS = ['cherry', 'lemon', 'plum', 'bell', 'bar', 'seven', 'gem', 'crown'];
const RARE = ['Common', 'Uncommon', 'Rare', 'Legendary'];
const REEL = 64; // cards on the reel
const WIN_AT = 54; // where the winning card sits

const img = (src, cls) => h('img', { class: cls, src, alt: '', draggable: 'false', onerror: (e) => e.currentTarget.classList.add('gone') });

export function mount(el, ctx) {
  const tiers = ctx.meta.tiers;
  let tier = tiers[load('casinoCaseTier')] ? load('casinoCaseTier') : 'silver';
  let busy = false;
  let alive = true;
  let pos = 0; // the strip's current offset in px
  let restK = Math.floor(REEL / 2) - 6; // the card that sits under the marker at rest

  // rarity look: top two items gold (the very top brighter), paying items green, the rest plain
  const rarity = (items, i) => (i === items.length - 1 ? 3 : i === items.length - 2 ? 2 : items[i].mult >= 1 ? 1 : 0);
  const symFor = (items, i) => SYMS[SYMS.length - items.length + i];
  const odds = (c) => (c >= 0.1 ? `${(c * 100).toFixed(0)}%` : c >= 0.01 ? `${(c * 100).toFixed(1)}%` : c >= 0.001 ? `${(c * 100).toFixed(2)}%` : `${+(c * 100).toFixed(3)}%`);
  function itemCard(items, i, withOdds = false) {
    const it = items[i];
    const icon = symbolImg(symFor(items, i), 'ic');
    icon.addEventListener('error', () => icon.classList.add('gone'));
    return h('div', { class: `ci r${rarity(items, i)}` }, icon, h('b', {}, fmtMult(it.mult)), h('small', {}, withOdds ? odds(it.chance) : RARE[rarity(items, i)]));
  }

  // ── controls ──
  const bet = betBox(ctx);
  const tierBtns = TIERS.map((t) => {
    const items = tiers[t];
    const b = h('button', { type: 'button', onclick: () => setTier(t) }, img(asset(`img/chest-${t}.webp`)), h('span', {}, NAME[t]), h('small', {}, fmtMult(items[items.length - 1].mult)));
    b.dataset.t = t;
    return b;
  });
  const sTop = stat('Top prize');
  const sOdds = stat('Profit chance');
  const go = h('button', { class: 'btn lg gold' }, 'Open case');
  const auto = autoplay(ctx, { button: go, play, lock: (on) => lockAll(on), label: 'Open case' });

  // ── stage ──
  const chestImg = img('', '');
  const chest = h('div', { class: 'cs-chest' }, chestImg);
  const headB = h('b', {});
  const headS = h('span', {});
  const strip = h('div', { class: 'cs-strip' });
  const reel = h('div', { class: 'cs-reel' }, strip, h('div', { class: 'cs-mark' }));
  const itemsEl = h('div', { class: 'cs-items' });
  const stage = h('div', { class: 'cs' }, h('div', { class: 'cs-head' }, chest, h('div', { class: 't' }, headB, headS)), reel, itemsEl);

  // filler for the reel: rarer items show up more often than their real odds, so the reel looks lively
  function filler(items) {
    const w = items.map((x) => Math.sqrt(x.chance));
    const sum = w.reduce((a, b) => a + b, 0);
    let r = Math.random() * sum;
    for (let i = 0; i < w.length; i++) if ((r -= w[i]) <= 0) return i;
    return 0;
  }
  function fillReel(winIndex = null) {
    const items = tiers[tier];
    put(strip, Array.from({ length: REEL }, (_, k) => itemCard(items, k === WIN_AT && winIndex != null ? winIndex : filler(items))));
    strip.classList.remove('done');
  }
  const step = () => {
    const a = strip.children[0];
    const b = strip.children[1];
    return a && b ? b.getBoundingClientRect().left - a.getBoundingClientRect().left : 100;
  };
  // offset that puts card k's centre (plus `jitter` of a card) under the marker
  function offsetFor(k, jitter = 0) {
    const s = step();
    const cw = strip.children[0]?.offsetWidth || 90;
    return reel.clientWidth / 2 - (10 + k * s + cw / 2 + jitter * cw);
  }
  function setPos(x) {
    pos = x;
    strip.style.transform = `translateX(${x}px)`;
  }

  function setTier(t) {
    if (busy || auto.running || t === tier) return;
    sfx.click();
    tier = t;
    keep('casinoCaseTier', t);
    drawTier();
  }
  function drawTier() {
    const items = tiers[tier];
    tierBtns.forEach((b) => b.classList.toggle('on', b.dataset.t === tier));
    chestImg.classList.remove('gone');
    chestImg.src = asset(`img/chest-${tier}.webp`);
    headB.textContent = `${NAME[tier]} case`;
    put(headS, `${items.length} items · top prize `, h('em', {}, fmtMult(items[items.length - 1].mult)));
    sTop.set(fmtMult(items[items.length - 1].mult));
    sOdds.set(odds(items.filter((x) => x.mult > 1).reduce((s, x) => s + x.chance, 0)));
    itemsEl.style.setProperty('--n', items.length);
    itemsEl.classList.toggle('odd', items.length % 2 === 1);
    put(itemsEl, items.map((_, i) => itemCard(items, i, true)));
    fillReel();
    restK = Math.floor(REEL / 2) - 6;
    setPos(offsetFor(restK));
  }

  function lockAll(on) {
    bet.lock(on);
    tierBtns.forEach((b) => (b.disabled = on));
  }

  async function play() {
    if (busy) return null;
    busy = true;
    if (!auto.running) lockAll(true), (go.disabled = true);
    let res;
    try {
      res = await ctx.bet(bet.value, { tier });
    } catch {
      busy = false;
      if (!auto.running) lockAll(false), (go.disabled = false);
      return null;
    }
    const d = res.result;
    // opening
    chest.classList.remove('open');
    void chest.offsetWidth;
    chest.classList.add('open');
    sfx.open();
    // a fresh reel, starting from the left, with the winner placed near the end
    fillReel(d.index);
    setPos(offsetFor(2, Math.random() - 0.5));
    const from = pos;
    const to = offsetFor(WIN_AT, (Math.random() - 0.5) * 0.7);
    const dur = auto.running ? 2600 : 5200;
    const s = step();
    let lastIdx = 0;
    sfx.spin();
    await new Promise((done) => {
      const t0 = performance.now();
      const frame = (now) => {
        if (!alive) return done();
        const k = Math.min(1, (now - t0) / dur);
        const e = 1 - (1 - k) ** 4;
        setPos(from + (to - from) * e);
        const idx = Math.floor((from - pos) / s);
        if (idx !== lastIdx) {
          lastIdx = idx;
          sfx.tick(0.8 + 0.4 * (1 - k));
        }
        if (k < 1) requestAnimationFrame(frame);
        else done();
      };
      requestAnimationFrame(frame);
    });
    if (!alive) return null;
    // settle onto the card's centre
    const exact = offsetFor(WIN_AT);
    const start = pos;
    await new Promise((done) => {
      const t0 = performance.now();
      const frame = (now) => {
        const k = Math.min(1, (now - t0) / 260);
        setPos(start + (exact - start) * (1 - (1 - k) ** 3));
        if (k < 1 && alive) requestAnimationFrame(frame);
        else done();
      };
      requestAnimationFrame(frame);
    });
    sfx.stop();
    restK = WIN_AT;
    strip.children[WIN_AT]?.classList.add('win');
    strip.classList.add('done');
    const hit = itemsEl.children[d.index];
    if (hit) {
      hit.classList.remove('hit');
      void hit.offsetWidth;
      hit.classList.add('hit');
    }
    const mult = d.mult;
    hist.push(fmtMult(mult), mult > 1 ? (mult >= 10 ? 'g' : true) : false);
    showResult(p, res);
    ctx.settle(res);
    if (auto.running) await sleep(500);
    busy = false;
    if (!auto.running) lockAll(false), (go.disabled = false);
    return res;
  }

  const L = gameLayout(el, ctx, {
    controls: [auto.mode, field('Case', h('div', { class: 'cs-tiers' }, tierBtns), 'top prize'), bet.el, auto.box, h('div', { class: 'stats' }, sTop.el, sOdds.el), h('div', { class: 'spacer' }), go],
    stage,
  });
  const hist = history(L.bar);
  const p = pop(L.body);
  drawTier();
  const ro = new ResizeObserver(() => !busy && setPos(offsetFor(restK)));
  ro.observe(reel);
  const key = (e) => e.code === 'Space' && e.target === document.body && (e.preventDefault(), go.click());
  document.addEventListener('keydown', key);
  return {
    unmount() {
      alive = false;
      ro.disconnect();
      document.removeEventListener('keydown', key);
    },
  };
}
