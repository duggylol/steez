import { h, fmt, fmtMult, short, stat, field, gameLayout, history, pop, showResult, sfx, css, sleep, card, setCard, asset } from '../ui.js';

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

css('baccarat', `
.bc { height: 100%; display: grid; grid-template-rows: minmax(0, 1fr) auto auto; gap: clamp(8px, 2cqh, 22px); padding: clamp(14px, 3cqh, 30px) clamp(12px, 2.6cqw, 34px) clamp(14px, 3cqh, 30px); --cw: clamp(30px, min(11.8cqw, 18cqh), 128px); }
.bc-hands { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: clamp(6px, 2cqw, 28px); min-height: 0; }
.bc-side { display: flex; flex-direction: column; align-items: center; gap: clamp(6px, 1.4cqh, 14px); padding: clamp(6px, 1.4cqmin, 14px); border-radius: 20px; border: 1.5px solid transparent; transition: border-color .3s, background .3s, box-shadow .3s; }
.bc-side.win { border-color: rgba(245,184,61,.75); background: rgba(245,184,61,.06); box-shadow: 0 0 46px -12px rgba(245,184,61,.6); }
.bc-cards { display: flex; align-items: center; justify-content: center; gap: calc(var(--cw) * .1); height: calc(var(--cw) * 1.42); min-width: calc(var(--cw) * 2.2); }
.bc-cards .pc.third { margin: 0 calc(var(--cw) * .2); }
.bc-cards .pc.third .in { transform: rotate(90deg) scale(.92); }
.bc-cards .pc.third.down .in { transform: rotate(90deg) scale(.92) rotateY(180deg); }
.bc-vs { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.bc-vs b { font-size: clamp(16px, 3.4cqmin, 34px); color: var(--gold); opacity: .4; font-weight: 800; letter-spacing: .1em; }
.bc-spots { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, .8fr) minmax(0, 1fr); gap: clamp(8px, 1.6cqw, 20px); height: clamp(78px, 21cqh, 190px); --cs: clamp(26px, 6.4cqmin, 56px); }
.bc-spot { position: relative; border-radius: clamp(14px, 3cqmin, 30px); border: 1.5px solid rgba(245,184,61,.45); background: rgba(7,9,14,.22); display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding: clamp(8px, 1.6cqmin, 16px) 6px; color: var(--gold-hi); transition: background .2s, border-color .2s, box-shadow .25s, transform .12s; overflow: hidden; }
.bc-spot:hover:not(:disabled) { background: rgba(245,184,61,.08); border-color: var(--gold); }
.bc-spot:active:not(:disabled) { transform: scale(.985); }
.bc-spot:disabled { cursor: default; }
.bc-spot .t { font-weight: 800; letter-spacing: .2em; text-transform: uppercase; font-size: clamp(11px, 2.4cqmin, 22px); }
.bc-spot .x { font-family: var(--mono); font-weight: 700; font-size: clamp(10px, 1.8cqmin, 15px); opacity: .6; }
.bc-spot .bc-amt { font-family: var(--mono); font-weight: 700; font-size: clamp(11px, 1.9cqmin, 16px); color: var(--text); min-height: 1.2em; }
.bc-spot.tie { border-color: rgba(34,199,122,.5); color: var(--win); }
.bc-spot.win { background: rgba(245,184,61,.16); border-color: var(--gold-hi); box-shadow: 0 0 0 3px var(--gold-soft), 0 0 40px -6px rgba(245,184,61,.65); animation: bcPulse 1s ease-in-out infinite alternate; }
.bc-spot.tie.win { background: rgba(34,199,122,.16); border-color: var(--win); box-shadow: 0 0 0 3px var(--win-soft), 0 0 40px -6px rgba(34,199,122,.6); }
@keyframes bcPulse { to { box-shadow: 0 0 0 5px var(--gold-soft), 0 0 56px -4px rgba(245,184,61,.6); } }
.bc-spot .stack { top: 60%; }
.bc-spot .x { margin-top: 2px; } .bc-spot .bc-amt { margin-top: auto; }
.bc-print { display: flex; justify-content: center; }
@container (max-width: 560px) { .bc-vs b { font-size: 13px; } .bc-spot .t { letter-spacing: .08em; } .bc-print .felt-print { letter-spacing: .12em; } .bc-side { padding: 6px 2px; } .bc-cards { gap: 3px; } }
@container (max-height: 460px) { .bc-print { display: none; } }
@container (max-aspect-ratio: 4/5) {
  .bc { --cw: clamp(30px, min(17cqw, 13cqh), 100px); }
  .bc-hands { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto minmax(0, 1fr); gap: 4px; }
  .bc-side { display: grid; grid-template-columns: 5.4em minmax(0, 1fr); grid-template-rows: auto auto; column-gap: 10px; row-gap: 8px; align-content: center; justify-items: center; }
  .bc-side .felt-who { grid-column: 1; grid-row: 1; letter-spacing: .14em; }
  .bc-side .felt-tot { grid-column: 1; grid-row: 2; }
  .bc-side .bc-cards { grid-column: 2; grid-row: 1 / 3; justify-content: flex-start; justify-self: stretch; }
  .bc-vs b { font-size: 12px; }
}
`);

const VAL = (c) => (c.rank >= 10 ? 0 : c.rank);
const totalOf = (cards) => cards.reduce((s, c) => s + VAL(c), 0) % 10;
const NAME = { player: 'Player', banker: 'Banker', tie: 'Tie' };

function chipSet(casino) {
  const base = Math.max(1, casino.minBet);
  return [1, 5, 10, 50, 100, 500].map((x) => x * base).filter((v, i) => i === 0 || !casino.maxBet || v <= casino.maxBet);
}
function chipEl(value, denoms) {
  let i = denoms.length - 1;
  while (i > 0 && denoms[i] > value) i--;
  return h('div', { class: `chip c${i}` }, short(value));
}
function stackEl(amount, denoms) {
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
  const pays = ctx.meta.pays || { player: 2, banker: 1.95, tie: 9 };
  const denoms = chipSet(ctx.casino);
  let chip = denoms[Math.min(1, denoms.length - 1)];
  const bets = { player: 0, banker: 0, tie: 0 };
  const undo = [];
  let last = null;
  let busy = false;
  let alive = true;
  let bannerTimer = 0;

  const chipBtns = denoms.map((v) => {
    const b = h('button', { type: 'button', title: fmt(v), onclick: () => ((chip = v), sfx.chip(), drawPick()) }, chipEl(v, denoms));
    b.dataset.v = v;
    return b;
  });
  const drawPick = () => chipBtns.forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === chip));
  const sTotal = stat('Total bet', '0');
  const sLast = stat('Last hand', '—');
  const deal = h('button', { class: 'btn lg gold', onclick: play }, 'Deal');
  const undoBtn = h('button', { class: 'btn', onclick: takeBack }, 'Undo');
  const clearBtn = h('button', { class: 'btn', onclick: () => (sfx.click(), clear()) }, 'Clear');
  const rebetBtn = h('button', { class: 'btn', onclick: rebet }, 'Rebet');

  const W = 'var(--cw)';
  const side = (who) => {
    const cards = h('div', { class: 'bc-cards' });
    const tot = h('div', { class: 'felt-tot' }, '—');
    const el2 = h('div', { class: 'bc-side' }, h('div', { class: 'felt-who' }, NAME[who]), cards, tot);
    return { el: el2, cards, tot };
  };
  const P = side('player');
  const B = side('banker');
  const spots = {};
  for (const on of ['player', 'tie', 'banker']) {
    const amt = h('div', { class: 'bc-amt' });
    const b = h('button', { class: `bc-spot ${on}`, type: 'button', onclick: () => place(on) }, h('div', { class: 't' }, NAME[on]), h('div', { class: 'x' }, `pays ${fmtMult(pays[on])}`), amt);
    spots[on] = { el: b, amt };
  }
  const banner = h('div', { class: 'felt-banner' });
  const table = h(
    'div',
    { class: 'felt', style: { '--felt': `url(${asset('img/felt.webp')})` } },
    h(
      'div',
      { class: 'bc' },
      h('div', { class: 'bc-hands' }, P.el, h('div', { class: 'bc-vs' }, h('b', {}, 'VS')), B.el),
      h('div', { class: 'bc-print' }, h('div', { class: 'felt-print' }, 'Tie pays 9× · bets return on a tie')),
      h('div', { class: 'bc-spots' }, spots.player.el, spots.tie.el, spots.banker.el),
    ),
    banner,
  );

  function flash(text, kind) {
    banner.textContent = text;
    banner.className = `felt-banner show ${kind || ''}`;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => banner.classList.remove('show'), 1900);
  }

  const total = () => bets.player + bets.banker + bets.tie;
  function drawChips() {
    for (const [on, s] of Object.entries(spots)) {
      s.el.querySelector('.stack')?.remove();
      if (bets[on]) s.el.append(stackEl(bets[on], denoms));
      s.amt.textContent = bets[on] ? fmt(bets[on]) : '';
      s.el.disabled = busy;
    }
    sTotal.set(fmt(total()));
    deal.disabled = busy || !total();
    undoBtn.disabled = busy || !undo.length;
    clearBtn.disabled = busy || !total();
    rebetBtn.disabled = busy || !last;
    chipBtns.forEach((b) => (b.disabled = busy));
  }
  function clearMarks() {
    Object.values(spots).forEach((s) => s.el.classList.remove('win'));
    P.el.classList.remove('win');
    B.el.classList.remove('win');
    banner.classList.remove('show');
  }
  function place(on) {
    if (busy) return;
    if (ctx.casino.maxBet && total() + chip > ctx.casino.maxBet) return ctx.toast(`The table limit is ${fmt(ctx.casino.maxBet)}.`, true);
    if (total() + chip > ctx.balance()) return ctx.toast('You don’t have enough for another chip.', true);
    clearMarks();
    bets[on] += chip;
    undo.push({ on, amount: chip });
    sfx.chip();
    drawChips();
  }
  function takeBack() {
    const u = undo.pop();
    if (!u) return;
    sfx.click();
    bets[u.on] = Math.max(0, bets[u.on] - u.amount);
    drawChips();
  }
  function clear() {
    bets.player = bets.banker = bets.tie = 0;
    undo.length = 0;
    drawChips();
  }
  function rebet() {
    if (busy || !last) return;
    const sum = last.player + last.banker + last.tie;
    if (sum > ctx.balance()) return ctx.toast('You don’t have enough to rebet.', true);
    clearMarks();
    Object.assign(bets, last);
    undo.length = 0;
    for (const on of Object.keys(bets)) if (bets[on]) undo.push({ on, amount: bets[on] });
    sfx.chip();
    drawChips();
  }

  async function dealTo(S, c, third = false) {
    const el2 = card(null, { w: W });
    if (third) el2.classList.add('third');
    S.cards.append(el2);
    sfx.deal();
    await sleep(320);
    return { el: el2, c };
  }
  async function flip(x) {
    sfx.flip();
    setCard(x.el, x.c);
    await sleep(380);
  }
  const showTot = (S, cards) => {
    S.tot.textContent = String(totalOf(cards));
    S.tot.className = 'felt-tot';
  };

  async function play() {
    if (busy || !total()) return;
    busy = true;
    clearMarks();
    drawChips();
    const sum = total();
    const list = Object.entries(bets).filter(([, a]) => a > 0).map(([on, amount]) => ({ on, amount }));
    let res;
    try {
      res = await ctx.bet(sum, { bets: list }, sum);
    } catch {
      busy = false;
      return drawChips();
    }
    last = { ...bets };
    const d = res.result;
    P.cards.replaceChildren();
    B.cards.replaceChildren();
    P.tot.textContent = B.tot.textContent = '—';
    P.tot.className = B.tot.className = 'felt-tot';
    // player, banker, player, banker, face down; then turned over side by side
    const p1 = await dealTo(P, d.player[0]);
    const b1 = await dealTo(B, d.banker[0]);
    const p2 = await dealTo(P, d.player[1]);
    const b2 = await dealTo(B, d.banker[1]);
    if (!alive) return ctx.settle(res);
    await flip(p1);
    await flip(p2);
    showTot(P, d.player.slice(0, 2));
    await flip(b1);
    await flip(b2);
    showTot(B, d.banker.slice(0, 2));
    if (d.player.length > 2 || d.banker.length > 2) await sleep(350);
    if (d.player.length > 2) {
      const p3 = await dealTo(P, d.player[2], true);
      await flip(p3);
      showTot(P, d.player);
    }
    if (d.banker.length > 2) {
      const b3 = await dealTo(B, d.banker[2], true);
      await flip(b3);
      showTot(B, d.banker);
    }
    if (!alive) return ctx.settle(res);
    await sleep(250);
    // the outcome
    const w = d.winner;
    spots[w].el.classList.add('win');
    if (w !== 'tie') {
      (w === 'player' ? P : B).el.classList.add('win');
      (w === 'player' ? P : B).tot.className = 'felt-tot w';
    }
    for (const r of d.results) {
      const s = spots[r.on].el.querySelector('.stack');
      if (r.win !== r.amount) s?.classList.add(r.win > r.amount ? 'won' : 'lost');
    }
    const banner2 = w === 'tie' ? `Tie ${d.pt} – ${d.bt}` : `${NAME[w]} wins ${Math.max(d.pt, d.bt)} – ${Math.min(d.pt, d.bt)}`;
    hist.push(w === 'tie' ? 'T' : w === 'player' ? 'P' : 'B', w === 'tie' ? 'g' : res.payout > res.cost);
    sLast.set(res.payout > res.cost ? `+${fmt(res.payout - res.cost)}` : res.payout === res.cost ? 'Push' : `−${fmt(res.cost - res.payout)}`);
    if (res.payout > res.cost) {
      flash(banner2, 'w');
      setTimeout(() => alive && (banner.classList.remove('show'), showResult(p, res)), 1100);
    } else {
      flash(banner2, res.payout ? '' : 'l');
      if (res.payout && res.payout < res.cost) setTimeout(() => alive && (banner.classList.remove('show'), showResult(p, res)), 1100);
      else if (!res.payout) sfx.lose();
    }
    ctx.settle(res);
    await sleep(1400);
    if (!alive) return;
    bets.player = bets.banker = bets.tie = 0;
    undo.length = 0;
    busy = false;
    drawChips();
  }

  const L = gameLayout(el, ctx, {
    controls: [field('Chip value', h('div', { class: 'chip-pick' }, chipBtns), 'tap to pick'), h('div', { class: 'stats' }, sTotal.el, sLast.el), h('div', { class: 'tbtns' }, undoBtn, clearBtn, rebetBtn), h('div', { class: 'note' }, 'Tap Player, Banker or Tie to stack chips, then deal. Banker wins pay 1.95×.'), h('div', { class: 'spacer' }), deal],
    stage: table,
  });
  const hist = history(L.bar);
  const p = pop(L.body);
  // an idle shoe: face-down cards waiting
  for (const S of [P, B]) S.cards.append(card(null, { w: W, deal: false }), card(null, { w: W, deal: false }));
  drawPick();
  drawChips();
  const key = (e) => e.code === 'Space' && e.target === document.body && (e.preventDefault(), play());
  document.addEventListener('keydown', key);
  return {
    unmount() {
      alive = false;
      clearTimeout(bannerTimer);
      document.removeEventListener('keydown', key);
    },
  };
}
