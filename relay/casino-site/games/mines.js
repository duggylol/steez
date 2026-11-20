import { h, put, fmt, fmtMult, betBox, field, stat, seg, gameLayout, history, pop, showResult, sfx, css, load, keep, asset } from '../ui.js';

css('mines', `
.mn { --s: min(calc(100cqh - 90px), calc(100cqw - 40px), 640px); width: var(--s); height: var(--s); display: grid; grid-template-columns: repeat(5, 1fr); gap: calc(var(--s) * .022); margin-top: 26px; }
.mt { position: relative; border: 0; border-radius: calc(var(--s) * .035); padding: 0; background: linear-gradient(180deg, #232c40, #1a2132); box-shadow: 0 calc(var(--s) * .01) 0 #0d121c, inset 0 1px 0 rgba(255,255,255,.06); transition: transform .12s, background .15s, opacity .3s, box-shadow .12s; display: grid; place-items: center; overflow: hidden; }
.mt:hover:not(:disabled) { transform: translateY(-3px); background: linear-gradient(180deg, #2c3750, #20283c); box-shadow: 0 calc(var(--s) * .014) 0 #0d121c, 0 0 0 1px rgba(245,184,61,.35), inset 0 1px 0 rgba(255,255,255,.08); }
.mt:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 2px 0 #0d121c; }
.mt:disabled { cursor: default; }
.mt.idle:disabled { opacity: .6; }
.mt img { width: 70%; height: 70%; object-fit: contain; filter: drop-shadow(0 6px 10px rgba(0,0,0,.6)); }
.mt.gem { background: radial-gradient(circle at 50% 45%, #134a33, #0e2a20); box-shadow: inset 0 0 0 2px rgba(34,199,122,.55), 0 0 30px -8px rgba(34,199,122,.6); }
.mt.gem img { animation: mnPop .45s cubic-bezier(.2,1.6,.4,1); }
.mt.bomb { background: radial-gradient(circle at 50% 45%, #4a1620, #2a0f15); box-shadow: inset 0 0 0 2px rgba(239,75,95,.55); }
.mt.hit { animation: mnShake .45s; background: radial-gradient(circle at 50% 45%, #ef4b5f, #6d1a26); }
.mt.dim { opacity: .38; }
.mt.dim img { animation: none; }
@keyframes mnPop { from { transform: scale(.3) rotate(-20deg); opacity: 0; } }
@keyframes mnShake { 20%, 60% { transform: translateX(-6px); } 40%, 80% { transform: translateX(6px); } }
.mn-count { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
.mn-count button { height: 36px; border-radius: 9px; border: 1px solid var(--line-2); background: var(--bg-1); font-family: var(--mono); font-weight: 700; font-size: 13px; color: var(--text-2); }
.mn-count button.on { border-color: var(--gold); color: var(--gold-hi); background: var(--gold-soft); }
.mn-count button:disabled { opacity: .5; }
`);

const GEM = () => h('img', { src: asset('img/gem.webp'), alt: 'gem', draggable: 'false' });
const BOMB = () => h('img', { src: asset('img/bomb.webp'), alt: 'mine', draggable: 'false' });

export function mount(el, ctx) {
  const R = ctx.casino.returnPercent / 100;
  let mines = Number(load('casinoMines', 3)) || 3;
  let round = ctx.round ? { ...ctx.round.view, staked: ctx.round.staked } : null;
  let busy = false;

  const bet = betBox(ctx);
  const presets = [1, 3, 5, 10, 15, 24].map((n) => h('button', { type: 'button', onclick: () => setMines(n) }, n));
  const custom = h('input', { class: 'inp', inputmode: 'numeric', value: String(mines) });
  custom.addEventListener('change', () => setMines(custom.value));
  const sMult = stat('Multiplier');
  const sNext = stat('Next gem');
  const sProfit = stat('Cash out');
  const sSafe = stat('Gems left');
  const main = h('button', { class: 'btn lg gold', onclick: () => (round ? cashout() : start()) }, 'Bet');
  const random = h('button', { class: 'btn', onclick: pickRandom }, 'Pick a random tile');
  const tiles = [...Array(25)].map((_, i) => h('button', { class: 'mt idle', disabled: true, 'aria-label': `Tile ${i + 1}`, onclick: () => reveal(i) }));
  const grid = h('div', { class: 'mn' }, tiles);

  const firstMult = () => Math.floor(((R * 25) / (25 - mines)) * 10000) / 10000;
  function setMines(n) {
    if (round) return;
    mines = Math.min(24, Math.max(1, Math.floor(Number(n)) || 3));
    keep('casinoMines', mines);
    custom.value = String(mines);
    sfx.click();
    draw();
  }

  function draw() {
    const playing = !!round;
    presets.forEach((b) => (b.classList.toggle('on', Number(b.textContent) === (round?.mines ?? mines)), (b.disabled = playing)));
    custom.disabled = playing;
    bet.lock(playing || busy);
    if (round) {
      const cash = Math.floor(round.staked * round.mult);
      sMult.set(round.mult ? fmtMult(round.mult) : '—');
      sNext.set(round.next ? fmtMult(round.next) : '—');
      sProfit.set(round.mult ? fmt(cash) : '—');
      sSafe.set(String(25 - round.mines - round.picks.length));
      main.textContent = round.picks.length ? `Cash out ${fmt(cash)}` : 'Pick a tile';
      main.className = `btn lg ${round.picks.length ? 'green' : ''}`;
      main.disabled = busy || !round.picks.length;
      random.disabled = busy;
      tiles.forEach((t, i) => {
        if (round.picks.includes(i)) {
          if (!t.classList.contains('gem')) put(t, GEM());
          t.className = 'mt gem';
          t.disabled = true;
        } else {
          t.className = 'mt';
          if (t.firstChild) t.replaceChildren();
          t.disabled = busy;
        }
      });
    } else {
      sMult.set('—');
      sNext.set(fmtMult(firstMult()));
      sProfit.set('—');
      sSafe.set(String(25 - mines));
      main.textContent = 'Bet';
      main.className = 'btn lg gold';
      main.disabled = busy;
      random.disabled = true;
    }
  }

  async function start() {
    if (busy) return;
    busy = true;
    draw();
    sfx.chip();
    try {
      const res = await ctx.bet(bet.value, { mines });
      round = { ...res.view, staked: res.staked };
      tiles.forEach((t) => ((t.className = 'mt'), t.replaceChildren()));
      ctx.settle({ balance: res.balance });
    } catch {
      /* the error is shown */
    }
    busy = false;
    draw();
  }

  async function reveal(i) {
    if (!round || busy || round.picks.includes(i)) return;
    busy = true;
    tiles[i].disabled = true;
    try {
      const res = await ctx.move('reveal', { tile: i });
      if (!res.done) {
        sfx.gem();
        round = { ...res.view, staked: res.staked };
      } else end(res);
    } catch {
      /* the error is shown */
    }
    busy = false;
    draw();
  }

  async function cashout() {
    if (!round || busy) return;
    busy = true;
    draw();
    try {
      end(await ctx.move('cashout'));
    } catch {
      /* the error is shown */
    }
    busy = false;
    draw();
  }

  function pickRandom() {
    if (!round) return;
    const free = tiles.map((_, i) => i).filter((i) => !round.picks.includes(i));
    reveal(free[Math.floor(Math.random() * free.length)]);
  }

  function end(res) {
    const v = res.view;
    round = null;
    ctx.roundOver();
    tiles.forEach((t, i) => {
      t.disabled = true;
      if (v.bombs.includes(i)) {
        t.className = `mt bomb${i === v.hit ? ' hit' : ' dim'}`;
        put(t, BOMB());
      } else {
        t.className = `mt gem${v.picks.includes(i) ? '' : ' dim'}`;
        if (!t.firstChild) t.append(GEM());
      }
    });
    if (res.payout > 0) {
      sfx.cash();
      hist.push(fmtMult(res.payout / res.staked), res.payout / res.staked >= 10 ? 'g' : true);
    } else {
      sfx.boom();
      hist.push('0.00×', false);
    }
    showResult(p, res, { lossText: 'Boom' });
    ctx.settle(res);
  }

  const L = gameLayout(el, ctx, {
    controls: [bet.el, field('Mines', h('div', { style: { display: 'grid', gap: '8px' } }, h('div', { class: 'mn-count' }, presets), custom), '1–24'), h('div', { class: 'stats' }, sMult.el, sNext.el, sProfit.el, sSafe.el), h('div', { class: 'spacer' }), random, main],
    stage: grid,
  });
  const hist = history(L.bar);
  const p = pop(L.body);
  if (round) tiles.forEach((t) => (t.className = 'mt'));
  draw();
}
