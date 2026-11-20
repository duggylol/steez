import { h, put, fmt, fmtMult, betBox, stat, gameLayout, history, pop, showResult, sfx, css, sleep, card, setCard, asset } from '../ui.js';

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

css('blackjack', `
.bj { display: flex; flex-direction: column; justify-content: space-between; align-items: center; height: 100%; padding: clamp(14px, 3cqh, 30px) clamp(10px, 2cqw, 24px) clamp(16px, 3.4cqh, 34px); --cw: clamp(44px, min(18cqw, 16cqh), 168px); }
.bj-zone { display: flex; flex-direction: column; align-items: center; gap: clamp(6px, 1.4cqh, 14px); min-height: calc(var(--cw) * 1.4 + 70px); justify-content: center; }
.bj-cards { display: flex; justify-content: center; min-height: calc(var(--cw) * 1.4); }
.bj-cards .pc + .pc { margin-left: calc(var(--w) * -.52); }
.bj-cards .pc:nth-child(n+2) { transform: translateY(calc(var(--w) * -.04 * var(--i, 1))); }
.bj-mid { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%; }
.bj-arc { width: min(86%, 760px); height: auto; overflow: visible; }
.bj-arc text { fill: var(--gold); font-family: Geist, sans-serif; font-weight: 800; letter-spacing: .26em; }
.bj-hands { display: flex; justify-content: center; align-items: flex-end; gap: clamp(10px, 3cqw, 44px); width: 100%; }
.bj-hand { display: flex; flex-direction: column; align-items: center; gap: clamp(6px, 1.2cqh, 12px); padding: clamp(6px, 1.2cqmin, 12px) clamp(8px, 1.8cqmin, 18px); border-radius: 18px; border: 1.5px solid transparent; transition: border-color .25s, background .25s, opacity .25s, transform .25s; }
.bj-hand.on { border-color: rgba(245,184,61,.7); background: rgba(245,184,61,.06); box-shadow: 0 0 40px -12px rgba(245,184,61,.5); transform: translateY(-4px); }
.bj-hand.wait { opacity: .55; }
.bj-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; }
.bj-bet { display: flex; align-items: center; gap: 5px; font-family: var(--mono); font-weight: 700; font-size: clamp(11px, 1.8cqmin, 15px); color: var(--gold-hi); }
.bj-bet img { width: 1.25em; height: 1.25em; }
.bj-tag { font-size: clamp(10px, 1.7cqmin, 14px); font-weight: 800; padding: .3em .85em; border-radius: 99px; text-transform: uppercase; letter-spacing: .08em; animation: bjTag .4s cubic-bezier(.2,1.6,.4,1); white-space: nowrap; }
.bj-tag.win { background: var(--win); color: #04170d; }
.bj-tag.blackjack { background: var(--gold-grad); color: var(--gold-ink); box-shadow: 0 0 24px rgba(245,184,61,.5); }
.bj-tag.lose, .bj-tag.bust { background: var(--lose); color: #fff; }
.bj-tag.push { background: var(--surface-3); color: var(--text); border: 1px solid var(--line-2); }
@keyframes bjTag { from { transform: scale(.4); opacity: 0; } }
.bj-hands.two .bj-cards .pc + .pc { margin-left: calc(var(--w) * -.6); }
@container (max-height: 470px) { .bj-arc { width: min(70%, 520px); } .bj-mid .felt-print { display: none; } }
`);

const RESULT = { win: 'Win', blackjack: 'Blackjack', lose: 'Lose', bust: 'Bust', push: 'Push' };
const ARC = (id) =>
  `<defs><path id="${id}" d="M 40 30 Q 400 150 760 30" /></defs><text font-size="30" text-anchor="middle"><textPath href="#${id}" startOffset="50%">Blackjack pays 3 to 2</textPath></text>`;

export function mount(el, ctx) {
  let round = ctx.round ? { ...ctx.round.view, staked: ctx.round.staked } : null;
  let busy = false;
  let alive = true;
  let bannerTimer = 0;

  const bet = betBox(ctx);
  const deal = h('button', { class: 'btn lg gold', onclick: start }, 'Deal');
  const key = (k) => h('kbd', {}, k);
  const acts = {
    hit: h('button', { class: 'btn gold', onclick: () => act('hit') }, 'Hit ', key('H')),
    stand: h('button', { class: 'btn', onclick: () => act('stand') }, 'Stand ', key('S')),
    double: h('button', { class: 'btn', onclick: () => act('double') }, 'Double ', key('D')),
    split: h('button', { class: 'btn', onclick: () => act('split') }, 'Split ', key('P')),
  };
  const actBox = h('div', { class: 'felt-keys' }, Object.values(acts));
  const sStake = stat('In play');
  const sLast = stat('Last hand');

  const W = 'var(--cw)';
  const dealerCards = h('div', { class: 'bj-cards' });
  const dealerTot = h('div', { class: 'felt-tot' }, '—');
  const hands = h('div', { class: 'bj-hands' });
  const banner = h('div', { class: 'felt-banner' });
  const arcId = `bjarc${Math.random().toString(36).slice(2, 7)}`;
  const table = h(
    'div',
    { class: 'felt', style: { '--felt': `url(${asset('img/felt.webp')})` } },
    h(
      'div',
      { class: 'bj' },
      h('div', { class: 'bj-zone' }, h('div', { class: 'felt-who' }, 'Dealer'), dealerCards, dealerTot),
      h('div', { class: 'bj-mid' }, h('svg', { class: 'bj-arc', viewBox: '0 0 800 120', html: ARC(arcId), style: { opacity: 0.34 } }), h('div', { class: 'felt-print' }, 'Dealer stands on all 17s')),
      hands,
    ),
    banner,
  );

  const totalText = (t) => (t.soft && t.total < 21 ? `${t.total - 10} / ${t.total}` : String(t.total));
  const mk = (c, animate = true) => card(c, { w: W, deal: animate });

  function flash(text, kind) {
    banner.textContent = text;
    banner.className = `felt-banner show ${kind || ''}`;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => banner.classList.remove('show'), 1600);
  }

  /** Bring a row of cards in line with `cards`: new ones are dealt one by one, a face-down one turns over. */
  async function sync(box, cards, { animate = true, gap = 300 } = {}) {
    const have = box.children.length;
    for (let i = 0; i < cards.length; i++) {
      if (!alive) return;
      const elc = box.children[i];
      if (elc) {
        if (elc.classList.contains('down') && cards[i]) {
          sfx.flip();
          setCard(elc, cards[i]);
          if (animate) await sleep(gap * 0.9);
        }
        continue;
      }
      const c = mk(cards[i], animate);
      c.style.setProperty('--i', i);
      box.append(c);
      if (animate) {
        sfx.deal();
        if (i < cards.length - 1 || i >= have) await sleep(gap);
      }
    }
    while (box.children.length > cards.length) box.lastChild.remove();
  }

  function handEl() {
    return h('div', { class: 'bj-hand' }, h('div', { class: 'bj-cards' }), h('div', { class: 'bj-meta' }, h('div', { class: 'felt-tot' }), h('div', { class: 'bj-bet' }, h('img', { src: asset('img/coin.webp'), alt: '' }), h('span'))), h('div', { class: 'bj-tags' }));
  }

  function drawHandMeta(v, final) {
    hands.classList.toggle('two', v.hands.length > 1);
    v.hands.forEach((x, i) => {
      const box = hands.children[i];
      if (!box) return;
      const multi = v.hands.length > 1;
      box.classList.toggle('on', !!x.active && multi);
      box.classList.toggle('wait', multi && !final && !x.active && !x.done);
      const [, meta, tags] = box.children;
      const tot = meta.children[0];
      tot.textContent = totalText(x.total) + (x.doubled ? ' ×2' : '');
      tot.className = `felt-tot${x.total.total > 21 ? ' l' : x.total.total === 21 ? ' w' : ''}`;
      meta.children[1].lastChild.textContent = fmt(x.bet);
      if (x.result && final) {
        if (!tags.firstChild) tags.append(h('div', { class: `bj-tag ${x.result}` }, RESULT[x.result] + (x.win > x.bet ? ` +${fmt(x.win - x.bet)}` : '')));
      } else tags.replaceChildren();
    });
  }

  /** Show a view. `fresh`: deal the whole table from nothing (player, dealer, player, dealer). */
  async function show(v, { fresh = false, final = false, animate = true } = {}) {
    if (fresh) {
      dealerCards.style.opacity = '';
      dealerTot.style.visibility = '';
      dealerCards.replaceChildren();
      hands.replaceChildren(...v.hands.map(handEl));
      dealerTot.textContent = '—';
      dealerTot.className = 'felt-tot';
      drawHandMeta({ ...v, hands: v.hands.map((x) => ({ ...x, result: null })) }, false);
      hands.querySelectorAll('.felt-tot').forEach((t) => (t.textContent = '—'));
      if (animate) {
        // the classic order, dealer's second card face down
        const p = hands.children[0].firstChild;
        const seq = [[p, v.hands[0].cards[0]], [dealerCards, v.dealer.cards[0]], [p, v.hands[0].cards[1]], [dealerCards, null]];
        for (const [box, c] of seq) {
          if (!alive) return;
          box.append(mk(c));
          box.lastChild.style.setProperty('--i', box.children.length - 1);
          sfx.deal();
          await sleep(300);
        }
      }
    }
    // split: a hand became two
    if (hands.children.length !== v.hands.length) {
      const first = hands.children[0];
      const keep = first ? [...first.firstChild.children].slice(0, 1) : [];
      const moved = first ? [...first.firstChild.children].slice(1, 2) : [];
      hands.replaceChildren(...v.hands.map(handEl));
      if (keep[0]) hands.children[0].firstChild.append(...keep);
      if (moved[0] && hands.children[1]) hands.children[1].firstChild.append(...moved);
      moved.forEach((m) => m.classList.remove('deal'));
      sfx.chip();
      if (animate) await sleep(250);
    }
    for (let i = 0; i < v.hands.length; i++) await sync(hands.children[i].firstChild, v.hands[i].cards, { animate });
    drawHandMeta(v, final);
    // the dealer: hole card turns over, then draws one at a time
    const hidden = v.dealer.cards.includes(null);
    if (final && animate) await sleep(250);
    await sync(dealerCards, v.dealer.cards, { animate, gap: 520 });
    dealerTot.textContent = hidden ? totalText(v.dealer.total) : totalText(v.dealer.total);
    dealerTot.className = `felt-tot${!hidden && v.dealer.total.total > 21 ? ' l' : ''}`;
    if (final) drawHandMeta(v, true);
  }

  function controls() {
    const can = round?.can || [];
    deal.classList.toggle('hidden', !!round);
    actBox.classList.toggle('hidden', !round);
    for (const [m, b] of Object.entries(acts)) b.disabled = busy || !can.includes(m);
    deal.disabled = busy;
    bet.lock(!!round || busy);
    sStake.set(round ? fmt(round.staked) : '—');
  }

  async function start() {
    if (busy || round) return;
    busy = true;
    controls();
    sfx.chip();
    let res;
    try {
      res = await ctx.bet(bet.value);
    } catch {
      busy = false;
      return controls();
    }
    banner.classList.remove('show');
    if (res.done) {
      // a blackjack on the deal (either side) ends it straight away
      await show({ ...res.view, dealer: { ...res.view.dealer, cards: [res.view.dealer.cards[0], null] } }, { fresh: true });
      await show(res.view, { final: true });
      finish(res);
    } else {
      round = { ...res.view, staked: res.staked };
      sStake.set(fmt(res.staked));
      await show(res.view, { fresh: true });
      ctx.settle({ balance: res.balance });
    }
    busy = false;
    controls();
  }

  async function act(move) {
    if (!round || busy || !round.can.includes(move)) return;
    busy = true;
    controls();
    if (move === 'double' || move === 'split') sfx.chip();
    else sfx.click();
    try {
      const res = await ctx.move(move);
      if (res.done) {
        round = null;
        ctx.roundOver();
        await show(res.view, { final: true });
        finish(res);
      } else {
        round = { ...res.view, staked: res.staked };
        if (move === 'double' || move === 'split') ctx.setBalance(res.balance);
        await show(res.view);
      }
    } catch {
      /* the toast is shown */
    }
    busy = false;
    controls();
  }

  function finish(res) {
    if (!alive) return ctx.settle(res);
    const v = res.view;
    const net = res.payout - res.staked;
    const bj = v.hands.some((x) => x.result === 'blackjack');
    const d = v.dealer.total.total;
    if (net > 0) {
      if (bj || d > 21) flash(bj ? 'Blackjack' : 'Dealer busts', 'w');
      setTimeout(() => alive && (banner.classList.remove('show'), showResult(p, res)), bj || d > 21 ? 900 : 150);
    } else if (net === 0 && res.payout > 0) {
      flash('Push');
      sfx.click();
    } else if (res.payout > 0) {
      showResult(p, res);
    } else {
      flash(v.hands.every((x) => x.result === 'bust') ? 'Bust' : d > 21 ? 'Dealer busts' : 'Dealer wins', 'l');
      sfx.lose();
    }
    const m = res.payout / res.staked;
    hist.push(net > 0 ? fmtMult(m) : net === 0 ? 'Push' : '0×', m >= 10 ? 'g' : net > 0 ? true : false);
    sLast.set(net > 0 ? `+${fmt(net)}` : net === 0 ? 'Push' : `−${fmt(-net)}`);
    ctx.settle(res);
  }

  const L = gameLayout(el, ctx, {
    controls: [bet.el, h('div', { class: 'stats' }, sStake.el, sLast.el), h('div', { class: 'note' }, 'Double on your first two cards, split a pair once. Every card comes from a fresh deck.'), h('div', { class: 'spacer' }), actBox, deal],
    stage: table,
  });
  const hist = history(L.bar);
  const p = pop(L.body);
  if (round) show(round, { fresh: true, animate: false });
  else {
    // an empty table waits with two face-down cards each
    hands.replaceChildren(handEl());
    hands.firstChild.firstChild.append(mk(null, false), mk(null, false));
    hands.firstChild.style.opacity = 0.35;
    dealerCards.append(mk(null, false), mk(null, false));
    dealerCards.style.opacity = 0.35;
    hands.firstChild.children[1].style.visibility = 'hidden';
    dealerTot.style.visibility = 'hidden';
  }
  controls();

  const keys = (e) => {
    if (e.target !== document.body || e.repeat) return;
    const k = e.key.toLowerCase();
    if (e.code === 'Space') {
      e.preventDefault();
      if (!round) start();
    } else if (round && { h: 'hit', s: 'stand', d: 'double', p: 'split' }[k]) act({ h: 'hit', s: 'stand', d: 'double', p: 'split' }[k]);
  };
  document.addEventListener('keydown', keys);
  return {
    unmount() {
      alive = false;
      clearTimeout(bannerTimer);
      document.removeEventListener('keydown', keys);
    },
  };
}
