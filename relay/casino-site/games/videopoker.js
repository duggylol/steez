import { h, put, fmt, fmtMult, short, betBox, stat, gameLayout, history, pop, showResult, sfx, css, sleep, card, setCard, asset } from '../ui.js';

// The felt every table game shares (blackjack, baccarat, video poker): same text in each file.
css('felt', `
.felt { position: absolute; inset: 52px 12px 12px; border-radius: clamp(18px, 4.5cqmin, 44px); overflow: hidden; isolation: isolate;
  background: radial-gradient(110% 80% at 50% 18%, rgba(110,140,200,.16), transparent 60%), radial-gradient(140% 120% at 50% 50%, transparent 55%, rgba(7,9,14,.6)), linear-gradient(rgba(13,22,40,.58), rgba(13,22,40,.58)), var(--felt) center / cover, #0f1a2e;
  box-shadow: inset 0 0 0 1.5px rgba(245,184,61,.6), inset 0 0 0 7px rgba(7,9,14,.45), inset 0 0 0 8px rgba(245,184,61,.16), inset 0 30px 70px -30px rgba(0,0,0,.6), 0 24px 50px -24px #000; }
.felt-print { color: var(--gold); opacity: .32; font-weight: 800; letter-spacing: .28em; text-transform: uppercase; text-align: center; white-space: nowrap; font-size: clamp(8.5px, 1.7cqmin, 15px); pointer-events: none; }
.felt-print.big { opacity: .22; font-size: clamp(14px, 4.2cqmin, 40px); letter-spacing: .18em; }
.felt-tot { font-family: var(--mono); font-weight: 700; font-size: clamp(12px, 2.2cqmin, 19px); min-width: 3.2em; padding: .28em .8em; border-radius: 99px; text-align: center; background: rgba(7,9,14,.72); border: 1px solid rgba(245,184,61,.32); color: var(--text); box-shadow: 0 6px 16px -8px #000; transition: border-color .2s, color .2s, background .2s; }
.felt-tot.w { border-color: var(--win); color: var(--win); }
.felt-tot.l { border-color: rgba(239,75,95,.6); color: var(--lose); }
.felt-who { font-size: clamp(10px, 1.7cqmin, 14px); font-weight: 800; letter-spacing: .22em; text-transform: uppercase; color: var(--gold-hi); opacity: .75; }
.felt-banner { position: absolute; left: 50%; top: 50%; z-index: 6; transform: translate(-50%, -50%) scale(.8); opacity: 0; pointer-events: none; padding: .55em 1.6em; border-radius: 14px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; white-space: nowrap; font-size: clamp(14px, 3.4cqmin, 30px); background: rgba(7,9,14,.9); border: 1.5px solid var(--gold); color: var(--gold-hi); box-shadow: 0 0 0 6px var(--gold-soft), 0 20px 50px -16px #000; transition: transform .35s cubic-bezier(.2,1.6,.4,1), opacity .2s; }
.felt-banner.show { transform: translate(-50%, -50%) scale(1); opacity: 1; }
.felt-banner.w { border-color: var(--win); color: var(--win); box-shadow: 0 0 0 6px var(--win-soft), 0 20px 50px -16px #000; }
.felt-banner.l { border-color: var(--lose); color: var(--lose); box-shadow: 0 0 0 6px var(--lose-soft), 0 20px 50px -16px #000; }
.felt .pc .f { box-shadow: 0 12px 26px -10px rgba(0,0,0,.95), 0 0 0 1px rgba(0,0,0,.25); }
.felt-keys { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.felt-keys .btn { height: 48px; font-size: 15px; }
.felt-keys .btn kbd { font: 600 11px var(--mono); opacity: .5; margin-left: 2px; }
`);

css('videopoker', `
.vp { height: 100%; display: grid; grid-template-rows: minmax(0, 1fr) auto auto; gap: clamp(8px, 1.8cqh, 20px); padding: clamp(12px, 2.6cqh, 28px) clamp(10px, 2.4cqw, 30px) clamp(14px, 3cqh, 30px); --cw: clamp(44px, min(15.4cqw, 23cqh), 150px); }
.vp-pay { width: 100%; max-width: 1180px; justify-self: center; display: grid; grid-template-columns: minmax(0, 1.5fr) repeat(var(--cols), minmax(0, 1fr)); grid-template-rows: auto repeat(9, minmax(0, 1fr)); border-radius: clamp(10px, 2cqmin, 18px); overflow: hidden; background: rgba(7,9,14,.55); box-shadow: inset 0 0 0 1.5px rgba(245,184,61,.5), 0 18px 40px -22px #000; min-height: 0; }
.vp-pay > div { display: flex; align-items: center; justify-content: flex-end; padding: 0 clamp(6px, 1.4cqw, 16px); font-family: var(--mono); font-weight: 700; font-size: clamp(10px, min(2.1cqw, 2.4cqh), 19px); color: var(--gold-hi); border-top: 1px solid rgba(245,184,61,.12); white-space: nowrap; overflow: hidden; min-height: 0; transition: background .2s, color .2s; }
.vp-pay > .hd { border-top: 0; font-family: Geist, sans-serif; font-size: clamp(9px, 1.5cqmin, 13px); letter-spacing: .1em; text-transform: uppercase; color: var(--text-3); padding-top: .55em; padding-bottom: .55em; cursor: pointer; }
.vp-pay > .hd.nm { cursor: default; justify-content: flex-start; }
.vp-pay > .hd:not(.nm):hover { color: var(--gold-hi); }
.vp-pay > .nm { justify-content: flex-start; font-family: Geist, sans-serif; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--gold); }
.vp-pay > .col { background: rgba(245,184,61,.13); color: var(--gold-hi); }
.vp-pay > .hd.col { color: var(--gold-hi); }
.vp-pay > .now { background: rgba(245,184,61,.1); color: #fff; }
.vp-pay > .nm.now { color: var(--gold-hi); }
.vp-pay > .win { background: var(--gold-grad); color: var(--gold-ink); animation: vpWin .7s ease-in-out infinite alternate; }
.vp-pay > .nm.win { color: var(--gold-ink); }
@keyframes vpWin { to { filter: brightness(1.15); } }
.vp-made { justify-self: center; min-height: 1.6em; font-weight: 800; letter-spacing: .2em; text-transform: uppercase; font-size: clamp(12px, 2.6cqmin, 24px); color: var(--gold-hi); text-shadow: 0 0 24px rgba(245,184,61,.45); transition: opacity .2s; }
.vp-made.dim { color: var(--text-3); text-shadow: none; letter-spacing: .14em; font-size: clamp(10px, 1.8cqmin, 16px); }
.vp-hand { display: flex; justify-content: center; gap: clamp(5px, 1.4cqw, 18px); padding-top: calc(var(--cw) * .2); }
.vp-slot { position: relative; border: 0; background: none; padding: 0; display: flex; flex-direction: column; align-items: center; cursor: pointer; transition: transform .2s cubic-bezier(.2,1.4,.4,1); }
.vp-slot:disabled { cursor: default; }
.vp-slot.held { transform: translateY(calc(var(--cw) * -.12)); }
.vp-slot.held .pc .f { box-shadow: 0 0 0 3px var(--gold), 0 0 30px rgba(245,184,61,.55), 0 12px 26px -10px #000; }
.vp-held { text-transform: uppercase; position: absolute; left: 50%; top: calc(var(--cw) * -.2); transform: translate(-50%, -30%) scale(.6); opacity: 0; padding: .25em .7em; border-radius: 7px; background: var(--gold-grad); color: var(--gold-ink); font-weight: 800; letter-spacing: .14em; font-size: clamp(9px, calc(var(--cw) * .13), 15px); box-shadow: 0 6px 16px -6px rgba(0,0,0,.8); transition: transform .25s cubic-bezier(.2,1.6,.4,1), opacity .15s; pointer-events: none; z-index: 2; }
.vp-slot.held .vp-held { transform: translate(-50%, -30%) scale(1); opacity: 1; }
.vp-slot:hover:not(:disabled):not(.held) { transform: translateY(-3px); }
.vp-slot .pc.dim { opacity: .4; transition: opacity .3s; }
.vp-slot .pc.hl .f { box-shadow: 0 0 0 3px var(--gold-hi), 0 0 34px rgba(245,184,61,.65); }
@container (max-width: 560px) { .vp-pay { grid-template-columns: minmax(0, 2fr) repeat(var(--cols), minmax(0, 1fr)); } .vp-pay > .nm { letter-spacing: 0; text-transform: none; font-size: 11.5px; } .vp-pay > div { padding: 0 6px; } }
@container (max-height: 520px) { .vp-pay > div { font-size: clamp(9px, 2.6cqh, 15px); } .vp-pay > .hd { padding-top: .3em; padding-bottom: .3em; } }
`);

const LADDER = (() => {
  const out = [];
  for (let k = 0; k <= 9; k++) for (const m of [1, 2, 5]) out.push(m * 10 ** k);
  return out;
})();
const ORDERED = ['royal', 'straightflush', 'four', 'fullhouse', 'flush', 'straight', 'three', 'twopair', 'jacks'];

/** Which cards make the hand (for the glow): every card for 5-card hands, the matched ranks otherwise. */
function makers(hand, key) {
  if (!key) return [];
  if (['royal', 'straightflush', 'flush', 'straight', 'fullhouse'].includes(key)) return [0, 1, 2, 3, 4];
  const count = {};
  hand.forEach((c) => (count[c.rank] = (count[c.rank] || 0) + 1));
  return hand.map((c, i) => (count[c.rank] >= 2 ? i : -1)).filter((i) => i >= 0);
}

export function mount(el, ctx) {
  const pays = [...ctx.meta.pays].sort((a, b) => ORDERED.indexOf(a.key) - ORDERED.indexOf(b.key));
  const { minBet, maxBet } = ctx.casino;
  let round = ctx.round ? { ...ctx.round.view, staked: ctx.round.staked } : null;
  let hold = [false, false, false, false, false];
  let busy = false;
  let alive = true;
  let final = null; // the finished hand's made key

  const bet = betBox(ctx);
  const main = h('button', { class: 'btn lg gold', onclick: () => (round ? draw() : start()) }, 'Deal');
  const sHand = stat('Hand');
  const sWin = stat('Last win');

  // ── Pay table ──
  const payEl = h('div', { class: 'vp-pay' });
  let cols = [];
  function levels() {
    const n = payEl.clientWidth && payEl.clientWidth < 520 ? 3 : 5;
    const b = bet.value;
    let list = LADDER.filter((v) => v >= minBet && (!maxBet || v <= maxBet));
    if (!list.includes(b)) list = [...list, b].sort((x, y) => x - y);
    const i = list.indexOf(b);
    const s = Math.max(0, Math.min(list.length - n, i - Math.floor(n / 2)));
    return list.slice(s, s + n);
  }
  function drawPay() {
    cols = levels();
    payEl.style.setProperty('--cols', cols.length);
    const b = bet.value;
    const madeNow = round?.made || null;
    const cells = [h('div', { class: 'hd nm' }, 'Hand')];
    cols.forEach((v) => cells.push(h('div', { class: `hd${v === b ? ' col' : ''}`, title: `Bet ${fmt(v)}`, onclick: () => !round && !busy && ((bet.value = v), sfx.click()) }, short(v))));
    for (const p of pays) {
      const state = final === p.key ? ' win' : !final && madeNow === p.key ? ' now' : '';
      cells.push(h('div', { class: `nm${state}` }, p.label));
      cols.forEach((v) => cells.push(h('div', { class: `${v === b ? 'col' : ''}${state}` }, short(Math.floor(v * p.mult)))));
    }
    put(payEl, cells);
  }
  bet.onChange(drawPay);

  // ── The hand ──
  const W = 'var(--cw)';
  const slots = [...Array(5)].map((_, i) => {
    const s = h('button', { class: 'vp-slot', type: 'button', disabled: true, 'aria-label': `Card ${i + 1}`, onclick: () => toggle(i) }, h('div', { class: 'vp-held' }, 'Held'), card(null, { w: W, deal: false }));
    return s;
  });
  const cardOf = (i) => slots[i].querySelector('.pc');
  const made = h('div', { class: 'vp-made dim' }, 'Jacks or better · hold and draw');
  const table = h('div', { class: 'felt', style: { '--felt': `url(${asset('img/felt.webp')})` } }, h('div', { class: 'vp' }, payEl, made, h('div', { class: 'vp-hand' }, slots)));

  function toggle(i) {
    if (!round || busy) return;
    hold[i] = !hold[i];
    sfx.click();
    drawHold();
  }
  function drawHold() {
    slots.forEach((s, i) => {
      s.classList.toggle('held', !!round && hold[i]);
      s.disabled = !round || busy;
    });
  }
  function controls() {
    main.textContent = round ? 'Draw' : 'Deal';
    main.disabled = busy;
    bet.lock(!!round || busy);
    sHand.set(round?.label || (final ? pays.find((p) => p.key === final)?.label : null) || '—');
    drawHold();
  }
  function showMade(label, dim) {
    made.textContent = label;
    made.className = `vp-made${dim ? ' dim' : ''}`;
  }

  async function start() {
    if (busy || round) return;
    busy = true;
    final = null;
    controls();
    sfx.chip();
    let res;
    try {
      res = await ctx.bet(bet.value);
    } catch {
      busy = false;
      return controls();
    }
    round = { ...res.view, staked: res.staked };
    hold = [false, false, false, false, false];
    showMade('', true);
    drawPay();
    // turn the old cards down, then deal the new five
    slots.forEach((s, i) => {
      const c = cardOf(i);
      c.classList.remove('dim', 'hl');
      setCard(c, null);
    });
    drawHold();
    await sleep(260);
    for (let i = 0; i < 5; i++) {
      if (!alive) break;
      const fresh = card(null, { w: W });
      cardOf(i).replaceWith(fresh);
      sfx.deal();
      await sleep(110);
    }
    await sleep(200);
    for (let i = 0; i < 5; i++) {
      if (!alive) break;
      sfx.flip();
      setCard(cardOf(i), round.hand[i]);
      await sleep(120);
    }
    ctx.settle({ balance: res.balance });
    afterDeal();
    busy = false;
    controls();
  }

  function afterDeal() {
    if (round.made) {
      showMade(round.label, false);
      sfx.gem();
      const mk = makers(round.hand, round.made);
      mk.forEach((i) => cardOf(i).classList.add('hl'));
    } else showMade('Pick the cards to hold', true);
    drawPay();
  }

  async function draw() {
    if (!round || busy) return;
    busy = true;
    controls();
    sfx.click();
    const keep = hold.slice();
    let res;
    try {
      res = await ctx.move('draw', { hold: keep });
    } catch {
      busy = false;
      return controls();
    }
    const v = res.view;
    slots.forEach((_, i) => cardOf(i).classList.remove('hl'));
    // swap the cards that weren't held: face down, then the new ones
    for (let i = 0; i < 5; i++) if (!keep[i]) setCard(cardOf(i), null);
    if (keep.includes(false)) await sleep(300);
    for (let i = 0; i < 5; i++) {
      if (keep[i] || !alive) continue;
      sfx.deal();
      setCard(cardOf(i), v.hand[i]);
      await sleep(170);
    }
    round = null;
    ctx.roundOver();
    final = v.made || 'none';
    hold = [false, false, false, false, false];
    const mk = makers(v.hand, v.made);
    slots.forEach((_, i) => cardOf(i).classList.toggle(mk.includes(i) ? 'hl' : 'dim', true));
    if (v.made) showMade(v.label, false);
    else showMade('No win', true);
    drawPay();
    const m = res.payout / res.staked;
    hist.push(res.payout ? fmtMult(m) : '0×', m >= 10 ? 'g' : res.payout > res.staked ? true : false);
    sWin.set(res.payout ? `+${fmt(res.payout)}` : '0');
    showResult(p, res);
    ctx.settle(res);
    busy = false;
    controls();
  }

  const L = gameLayout(el, ctx, {
    controls: [bet.el, h('div', { class: 'stats' }, sHand.el, sWin.el), h('div', { class: 'note' }, 'Deal five cards, tap the ones to hold, then draw. Jacks or better pays. Keys: 1–5 hold, Space deals and draws.'), h('div', { class: 'spacer' }), main],
    stage: table,
  });
  const hist = history(L.bar);
  const p = pop(L.body);
  if (round) {
    // a hand left open: show it face up and carry on
    slots.forEach((s, i) => setCard(cardOf(i), round.hand[i]));
    afterDeal();
  }
  drawPay();
  controls();
  const ro = new ResizeObserver(() => {
    const n = payEl.clientWidth < 520 ? 3 : 5;
    if (n !== cols.length) drawPay();
  });
  ro.observe(payEl);
  const keys = (e) => {
    if (e.target !== document.body || e.repeat) return;
    if (e.code === 'Space') {
      e.preventDefault();
      main.click();
    } else if (/^[1-5]$/.test(e.key)) toggle(Number(e.key) - 1);
  };
  document.addEventListener('keydown', keys);
  return {
    unmount() {
      alive = false;
      ro.disconnect();
      document.removeEventListener('keydown', keys);
    },
  };
}
