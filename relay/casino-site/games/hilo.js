import { h, fmt, fmtMult, betBox, stat, gameLayout, history, pop, showResult, sfx, css, card, setCard, sleep } from '../ui.js';

css('hilo', `
.hl { --cw: clamp(92px, min(calc((100cqh - 300px) * .714), 30cqw), 320px); --tw: clamp(34px, 7.4cqmin, 74px); width: 100%; height: 100%; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: clamp(8px, 2cqh, 18px); padding: 54px clamp(10px, 3cqw, 32px) clamp(12px, 2.6cqh, 24px); }
.hl-top { text-align: center; }
.hl-top b { display: block; font-family: var(--mono); font-weight: 700; font-size: clamp(28px, 6.4cqmin, 58px); line-height: 1.05; letter-spacing: -.03em; color: var(--text); transition: color .2s; }
.hl-top span { display: block; margin-top: 4px; font-weight: 700; font-size: clamp(11px, 1.8cqmin, 14px); letter-spacing: .14em; text-transform: uppercase; color: var(--text-3); }
.hl-top.w b { color: var(--win); }
.hl-top.w span { color: var(--win); }
.hl-top.l b, .hl-top.l span { color: var(--lose); }
.hl-top.idle b { color: var(--text-3); }
.hl-mid { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: clamp(10px, 3cqw, 44px); min-height: 0; }
.hl-g { justify-self: end; width: clamp(92px, 20cqw, 230px); height: calc(var(--cw) * 1.08); max-height: 100%; border-radius: clamp(12px, 2cqmin, 18px); border: 1px solid var(--line-2); background: linear-gradient(180deg, var(--surface-3), var(--surface-2)); box-shadow: 0 10px 26px -14px #000, inset 0 1px 0 rgba(255,255,255,.05); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: clamp(4px, 1cqh, 10px); padding: 10px 6px; transition: border-color .15s, transform .12s, background .15s, box-shadow .15s, opacity .2s; }
.hl-g.hi { justify-self: start; }
.hl-g:hover:not(:disabled) { border-color: var(--gold); transform: translateY(-3px); background: linear-gradient(180deg, #232c40, #1a2132); box-shadow: 0 16px 30px -14px #000, 0 0 0 1px rgba(245,184,61,.35); }
.hl-g:active:not(:disabled) { transform: translateY(1px); }
.hl-g:disabled { opacity: .4; cursor: not-allowed; }
.hl-g .ar { width: clamp(30px, 6cqmin, 54px); height: clamp(30px, 6cqmin, 54px); border-radius: 50%; display: grid; place-items: center; background: var(--gold-soft); color: var(--gold); box-shadow: inset 0 0 0 1px rgba(245,184,61,.35); }
.hl-g .ar svg { width: 55%; height: 55%; }
.hl-g .lb { font-weight: 700; font-size: clamp(12px, 1.9cqmin, 16px); color: var(--text); text-align: center; line-height: 1.2; }
.hl-g .ch { font-family: var(--mono); font-weight: 600; font-size: clamp(11px, 1.7cqmin, 14px); color: var(--text-3); }
.hl-g .mu { font-family: var(--mono); font-weight: 700; font-size: clamp(14px, 2.8cqmin, 24px); color: var(--gold-hi); letter-spacing: -.02em; }
.hl-deck { position: relative; width: var(--cw); aspect-ratio: 5 / 7; }
.hl-deck .pile { position: absolute; inset: 0; }
.hl-deck .pile .pc { position: absolute; left: 0; top: 0; }
.hl-deck .pile .pc:nth-child(1) { transform: translate(-7px, -8px) rotate(-3deg); opacity: .55; }
.hl-deck .pile .pc:nth-child(2) { transform: translate(-3.5px, -4px) rotate(-1.5deg); opacity: .8; }
.hl-slot { position: absolute; inset: 0; }
.hl-slot .pc { position: absolute; left: 0; top: 0; }
.hl-slot .pc .f { transition: box-shadow .3s; }
.hl-slot .pc.ok .f { box-shadow: 0 0 0 3px var(--win), 0 0 40px rgba(34,199,122,.5), 0 10px 24px -8px rgba(0,0,0,.9); }
.hl-slot .pc.bad .f { box-shadow: 0 0 0 3px var(--lose), 0 0 40px rgba(239,75,95,.5), 0 10px 24px -8px rgba(0,0,0,.9); }
.hl-slot .pc.bad { animation: hlShake .45s .1s; }
@keyframes hlShake { 20%, 60% { transform: translateX(-7px); } 40%, 80% { transform: translateX(7px); } }
.hl-trail { display: flex; justify-content: center; align-items: flex-end; gap: clamp(5px, 1.1cqmin, 10px); min-height: calc(var(--tw) * 1.4 + 10px); overflow: hidden; padding-bottom: 8px; }
.hl-t { position: relative; flex: none; animation: hlIn .4s cubic-bezier(.2,1.4,.4,1); }
.hl-t .pc .f { box-shadow: 0 6px 14px -6px rgba(0,0,0,.9); }
.hl-t i { position: absolute; left: 50%; bottom: -8px; transform: translateX(-50%); width: clamp(18px, 3.2cqmin, 26px); height: clamp(18px, 3.2cqmin, 26px); border-radius: 50%; display: grid; place-items: center; font-style: normal; font-weight: 800; font-size: clamp(9px, 1.6cqmin, 13px); box-shadow: 0 0 0 2px var(--surface); z-index: 2; }
.hl-t i.y { background: var(--win); color: #04170d; }
.hl-t i.n { background: var(--lose); color: #fff; }
.hl-t i.s { background: var(--surface-3); color: var(--text-2); box-shadow: 0 0 0 2px var(--surface), inset 0 0 0 1px var(--line-2); }
@container (max-width: 520px) {
  .hl { --cw: clamp(92px, min(calc((100cqh - 280px) * .714), 38cqw), 300px); }
  .hl-mid { gap: 8px; }
  .hl-g { width: clamp(74px, 24cqw, 120px); }
}
@keyframes hlIn { from { transform: translateY(14px) scale(.6); opacity: 0; } }
`);

const arrow = (up) => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, h('path', { d: up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6' }));
const pct = (c) => `${(c * 100).toFixed(c < 0.1 ? 2 : 1)}%`;

export function mount(el, ctx) {
  let round = ctx.round ? { ...ctx.round.view, staked: ctx.round.staked } : null;
  let busy = false;
  let alive = true;

  const bet = betBox(ctx);
  const sMult = stat('Multiplier');
  const sCash = stat('Cash out');
  const sSteps = stat('Right calls');
  const sCard = stat('Card');
  const skip = h('button', { class: 'btn', onclick: () => go('skip') }, 'Skip card');
  const main = h('button', { class: 'btn lg gold', onclick: () => (round ? go('cashout') : start()) }, 'Bet');

  // ── stage ──
  const gBtn = (dir) => {
    const lb = h('div', { class: 'lb' });
    const ch = h('div', { class: 'ch' });
    const mu = h('div', { class: 'mu' });
    const b = h('button', { class: `hl-g ${dir}`, onclick: () => go(dir) }, h('div', { class: 'ar' }, arrow(dir === 'hi')), lb, ch, mu);
    return { b, lb, ch, mu };
  };
  const HI = gBtn('hi');
  const LO = gBtn('lo');
  const pile = h('div', { class: 'pile' }, card(null, { w: 'var(--cw)', deal: false }), card(null, { w: 'var(--cw)', deal: false }));
  const slot = h('div', { class: 'hl-slot' });
  const deck = h('div', { class: 'hl-deck' }, pile, slot);
  const topB = h('b', {}, '1.00×');
  const topS = h('span', {}, 'Place a bet to draw a card');
  const top = h('div', { class: 'hl-top idle' }, topB, topS);
  const trail = h('div', { class: 'hl-trail' });
  const stage = h('div', { class: 'hl' }, top, h('div', { class: 'hl-mid' }, LO.b, deck, HI.b), trail);

  let cur = null;
  function showCard(c, { instant = false } = {}) {
    const el = card(instant ? c : null, { w: 'var(--cw)', deal: !instant });
    const olds = [...slot.children];
    slot.append(el);
    cur = el;
    if (!instant) {
      sfx.deal();
      setTimeout(() => {
        if (c) setCard(el, c), sfx.flip();
      }, 260);
    }
    setTimeout(() => olds.forEach((o) => o.remove()), 700);
  }
  function addTrail(c, mark) {
    const t = h('div', { class: 'hl-t' }, card(c, { w: 'var(--tw)', deal: false }), h('i', { class: mark.skip ? 's' : mark.win ? 'y' : 'n' }, mark.skip ? '»' : mark.guess === 'hi' ? '▲' : '▼'));
    trail.append(t);
    const w = t.offsetWidth || 40;
    const fit = Math.max(3, Math.floor((trail.clientWidth + 8) / (w + 8)));
    while (trail.children.length > fit) trail.firstChild.remove();
  }

  const labels = (r) => ({
    hi: r === 13 ? 'King only' : r === 1 ? 'Higher' : 'Higher or same',
    lo: r === 1 ? 'Ace only' : r === 13 ? 'Lower' : 'Lower or same',
  });
  function setTop(b, s, kind = '') {
    topB.textContent = b;
    topS.textContent = s;
    top.className = `hl-top ${kind}`;
  }

  function draw() {
    const on = !!round;
    bet.lock(on || busy);
    if (on) {
      const r = round.card.rank;
      const lab = labels(r);
      for (const [g, dir] of [[HI, 'hi'], [LO, 'lo']]) {
        const o = round[dir];
        const sure = o.chance >= 1;
        g.lb.textContent = lab[dir];
        g.ch.textContent = sure ? 'Sure thing' : pct(o.chance);
        g.mu.textContent = sure ? '—' : fmtMult(o.mult);
        g.b.disabled = busy || sure;
      }
      const cash = Math.floor(round.staked * round.mult);
      sMult.set(round.mult ? fmtMult(round.mult) : '—');
      sCash.set(round.mult ? fmt(cash) : '—');
      sSteps.set(String(round.steps));
      sCard.set(cardName(round.card));
      skip.disabled = busy;
      main.textContent = round.steps ? `Cash out ${fmt(cash)}` : 'Make a call';
      main.className = `btn lg ${round.steps ? 'green' : ''}`;
      main.disabled = busy || !round.steps;
    } else {
      for (const [g, dir] of [[HI, 'hi'], [LO, 'lo']]) {
        g.lb.textContent = dir === 'hi' ? 'Higher' : 'Lower';
        g.ch.textContent = '—';
        g.mu.textContent = '—';
        g.b.disabled = true;
      }
      sMult.set('—');
      sCash.set('—');
      sSteps.set('0');
      sCard.set('—');
      skip.disabled = true;
      main.textContent = 'Bet';
      main.className = 'btn lg gold';
      main.disabled = busy;
    }
  }
  const cardName = (c) => `${{ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[c.rank] || c.rank}${c.suit}`;

  async function start() {
    if (busy || round) return;
    busy = true;
    draw();
    sfx.chip();
    try {
      const res = await ctx.bet(bet.value, {});
      round = { ...res.view, staked: res.staked };
      ctx.settle({ balance: res.balance });
      trail.replaceChildren();
      showCard(round.card);
      setTop('1.00×', 'Higher or lower?');
    } catch {
      /* the error is shown */
    }
    busy = false;
    draw();
  }

  async function go(move) {
    if (!round || busy) return;
    if ((move === 'hi' || move === 'lo') && round[move].chance >= 1) return;
    if (move === 'cashout' && !round.steps) return;
    busy = true;
    sfx.click();
    draw();
    let res;
    try {
      res = await ctx.move(move);
    } catch {
      busy = false;
      draw();
      return;
    }
    if (move === 'cashout') {
      end(res);
      busy = false;
      return draw();
    }
    const step = res.view.history[res.view.history.length - 1];
    addTrail(step.from, step);
    showCard(step.card);
    await sleep(760);
    if (!alive) return;
    if (step.skip) {
      round = { ...res.view, staked: res.staked };
      setTop(round.mult ? fmtMult(round.mult) : '1.00×', 'Skipped');
    } else if (step.win) {
      cur.classList.add('ok');
      sfx.gem();
      if (res.done) end(res);
      else {
        round = { ...res.view, staked: res.staked };
        setTop(fmtMult(round.mult), `Right · ${round.steps} in a row`, 'w');
      }
    } else {
      cur.classList.add('bad');
      end(res);
    }
    busy = false;
    draw();
  }

  function end(res) {
    round = null;
    ctx.roundOver();
    const mult = res.payout / res.staked;
    if (res.payout > 0) {
      sfx.cash();
      setTop(fmtMult(mult), `Cashed out · +${fmt(res.payout - res.staked)}`, 'w');
      hist.push(fmtMult(mult), mult >= 10 ? 'g' : true);
    } else {
      setTop('0.00×', 'Wrong call', 'l');
      hist.push('0.00×', false);
    }
    showResult(p, res, { lossText: 'Wrong' });
    ctx.settle(res);
  }

  const L = gameLayout(el, ctx, {
    controls: [bet.el, h('div', { class: 'stats' }, sMult.el, sCash.el, sSteps.el, sCard.el), h('div', { class: 'note' }, 'Aces are low, kings are high. A same-rank card counts as right either way.'), h('div', { class: 'spacer' }), skip, main],
    stage,
  });
  const hist = history(L.bar);
  const p = pop(L.body);

  if (round) {
    (round.history || []).forEach((s) => addTrail(s.from, s));
    showCard(round.card, { instant: true });
    setTop(round.mult ? fmtMult(round.mult) : '1.00×', round.steps ? `${round.steps} in a row` : 'Higher or lower?', round.steps ? 'w' : '');
  } else showCard(null, { instant: true });
  draw();

  const key = (e) => {
    if (e.target !== document.body) return;
    if (e.code === 'Space') e.preventDefault(), main.click();
    else if (e.key === 'ArrowUp') e.preventDefault(), go('hi');
    else if (e.key === 'ArrowDown') e.preventDefault(), go('lo');
    else if (e.key === 's' || e.key === 'S') go('skip');
  };
  document.addEventListener('keydown', key);
  return {
    unmount() {
      alive = false;
      document.removeEventListener('keydown', key);
    },
  };
}
