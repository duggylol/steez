import { h, put, fmt, fmtMult, betBox, field, stat, seg, gameLayout, history, pop, showResult, sfx, css, load, keep, asset } from '../ui.js';

css('tower', `
.tw { --th: calc(100cqh - 76px); width: min(calc(100cqw - 28px), calc(var(--th) * 1.15), 1000px); height: var(--th); margin-top: 52px; display: grid; grid-template-rows: repeat(8, minmax(0, 1fr)); gap: clamp(4px, 1cqh, 9px); }
.tw-row { --cols: 3; position: relative; display: grid; grid-template-columns: clamp(58px, 12cqmin, 104px) repeat(var(--cols), minmax(0, 1fr)); gap: clamp(5px, 1.2cqmin, 10px); padding: clamp(3px, .6cqh, 5px); border-radius: clamp(10px, 1.8cqmin, 16px); transition: background .3s, box-shadow .3s; }
.tw-row.cur { background: var(--gold-soft); box-shadow: inset 0 0 0 1px rgba(245,184,61,.5), 0 0 34px -12px rgba(245,184,61,.6); }
.tw-row.flash { animation: twFlash .6s; }
@keyframes twFlash { from { background: rgba(34,199,122,.22); } }
.tw-m { display: grid; place-items: center; border-radius: clamp(8px, 1.4cqmin, 12px); background: var(--bg-1); border: 1px solid var(--line); font-family: var(--mono); font-weight: 700; font-size: clamp(11px, 2.3cqmin, 17px); color: var(--text-3); letter-spacing: -.02em; transition: color .2s, border-color .2s, background .2s; min-width: 0; overflow: hidden; }
.tw-row.cur .tw-m { color: var(--gold-ink); background: var(--gold-grad); border-color: #ffd88a; }
.tw-row.done .tw-m { color: var(--win); border-color: rgba(34,199,122,.35); background: var(--win-soft); }
.tt { position: relative; border: 0; padding: 0; min-width: 0; border-radius: clamp(8px, 1.4cqmin, 12px); background: linear-gradient(180deg, #232c40, #1a2132); box-shadow: 0 clamp(3px, .5cqh, 5px) 0 #0d121c, inset 0 1px 0 rgba(255,255,255,.06); display: grid; place-items: center; overflow: hidden; transition: transform .12s, background .15s, opacity .3s, box-shadow .12s; }
.tt:disabled { cursor: default; }
.tw-row.cur .tt:hover:not(:disabled) { transform: translateY(-3px); background: linear-gradient(180deg, #2c3750, #20283c); box-shadow: 0 6px 0 #0d121c, 0 0 0 1px rgba(245,184,61,.5), inset 0 1px 0 rgba(255,255,255,.08); }
.tw-row.cur .tt:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 1px 0 #0d121c; }
.tw-row.fut .tt, .tw.idle .tt { opacity: .55; }
.tw-row.done .tt:not(.gem) { opacity: .4; }
.tt .pz { position: absolute; inset: 10%; display: grid; place-items: center; }
.tt .pz img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 5px 8px rgba(0,0,0,.6)); }
.tt .pz .fb { display: none; }
.tt .pz img.gone { display: none; }
.tt .pz img.gone + .fb { display: block; }
.tt .fb.g { height: 60%; aspect-ratio: 1; transform: rotate(45deg); border-radius: 18%; background: linear-gradient(135deg, #5af0aa, #22c77a 55%, #12804c); box-shadow: 0 0 18px rgba(34,199,122,.6); }
.tt .fb.b { height: 72%; aspect-ratio: 1; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #4a5570, #141a26 70%); box-shadow: 0 0 0 2px rgba(239,75,95,.6), 0 0 16px rgba(239,75,95,.5); }
.tt.gem { background: radial-gradient(circle at 50% 45%, #134a33, #0e2a20); box-shadow: inset 0 0 0 2px rgba(34,199,122,.55), 0 0 26px -8px rgba(34,199,122,.6); opacity: 1 !important; }
.tt.gem .pz { animation: twPop .45s cubic-bezier(.2,1.6,.4,1); }
.tt.bomb { background: radial-gradient(circle at 50% 45%, #4a1620, #2a0f15); box-shadow: inset 0 0 0 2px rgba(239,75,95,.55); opacity: 1 !important; }
.tt.hit { animation: twShake .45s; background: radial-gradient(circle at 50% 45%, #ef4b5f, #6d1a26); }
.tt.dim { opacity: .38 !important; }
.tt.dim .pz { animation: none; }
@keyframes twPop { from { transform: scale(.3) rotate(-20deg); opacity: 0; } }
@keyframes twShake { 20%, 60% { transform: translateX(-6px); } 40%, 80% { transform: translateX(6px); } }
.tw-lv .seg button { font-size: 12.5px; padding: 0 2px; }
`);

const piece = (kind) =>
  h(
    'span',
    { class: 'pz' },
    h('img', { src: asset(`img/${kind === 'g' ? 'gem' : 'bomb'}.webp`), alt: kind === 'g' ? 'gem' : 'trap', draggable: 'false', onerror: (e) => e.currentTarget.classList.add('gone') }),
    h('i', { class: `fb ${kind}` }),
  );

const LEVELS = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
  { value: 'expert', label: 'Expert' },
  { value: 'master', label: 'Master' },
];

export function mount(el, ctx) {
  const levels = ctx.meta.levels;
  const FLOORS = ctx.meta.floors || 8;
  let level = levels[load('casinoTowerLevel')] ? load('casinoTowerLevel') : 'medium';
  let round = ctx.round ? { ...ctx.round.view, staked: ctx.round.staked } : null;
  let busy = false;
  let shownLevel = null;
  let revealed = false;

  const bet = betBox(ctx);
  const lv = seg(LEVELS, level, (v) => {
    level = v;
    keep('casinoTowerLevel', v);
    revealed = false;
    draw();
  });
  const lvNote = h('span', {});
  const sMult = stat('Multiplier');
  const sNext = stat('Next floor');
  const sCash = stat('Cash out');
  const sFloor = stat('Floor');
  const main = h('button', { class: 'btn lg gold', onclick: () => (round ? cashout() : start()) }, 'Bet');
  const random = h('button', { class: 'btn', onclick: pickRandom }, 'Pick a random tile');

  const board = h('div', { class: 'tw idle' });
  let rows = []; // rows[f] = { el, label, tiles[] } with f = 0 at the bottom

  function build(lvKey) {
    const L = levels[lvKey];
    rows = Array.from({ length: FLOORS }, (_, f) => {
      const label = h('div', { class: 'tw-m' }, fmtMult(L.mults[f]));
      const tiles = Array.from({ length: L.cols }, (_, c) => h('button', { class: 'tt', disabled: true, 'aria-label': `Floor ${f + 1}, tile ${c + 1}`, onclick: () => pick(f, c) }));
      const row = h('div', { class: 'tw-row', style: { '--cols': L.cols } }, label, tiles);
      return { el: row, label, tiles };
    });
    put(board, [...rows].reverse().map((r) => r.el));
    shownLevel = lvKey;
  }

  function draw() {
    const lvKey = round ? round.level : level;
    if (shownLevel !== lvKey || (!round && !revealed && rows.some((r) => r.tiles.some((t) => t.firstChild)))) build(lvKey);
    const L = levels[lvKey];
    const playing = !!round;
    lv.set(lvKey);
    lv.lock(playing || busy);
    bet.lock(playing || busy);
    lvNote.textContent = `${L.cols - L.traps} of ${L.cols} safe`;
    board.classList.toggle('idle', !playing && !revealed);
    if (playing) {
      const at = round.picks.length;
      rows.forEach((r, f) => {
        r.el.className = `tw-row ${f < at ? 'done' : f === at ? 'cur' : 'fut'}`;
        r.tiles.forEach((t, c) => {
          if (f < at && round.picks[f] === c) {
            if (!t.classList.contains('gem')) put(t, piece('g'));
            t.className = 'tt gem';
          } else {
            t.className = 'tt';
            if (t.firstChild) t.replaceChildren();
          }
          t.disabled = busy || f !== at;
        });
      });
      const cash = Math.floor(round.staked * round.mult);
      sMult.set(round.mult ? fmtMult(round.mult) : '—');
      sNext.set(round.next ? fmtMult(round.next) : '—');
      sCash.set(round.mult ? fmt(cash) : '—');
      sFloor.set(`${at} / ${FLOORS}`);
      main.textContent = at ? `Cash out ${fmt(cash)}` : 'Pick a tile';
      main.className = `btn lg ${at ? 'green' : ''}`;
      main.disabled = busy || !at;
      random.disabled = busy;
    } else {
      if (!revealed) rows.forEach((r) => ((r.el.className = 'tw-row'), r.tiles.forEach((t) => (t.disabled = true))));
      sMult.set('—');
      sNext.set(fmtMult(L.mults[0]));
      sCash.set('—');
      sFloor.set(`0 / ${FLOORS}`);
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
      const res = await ctx.bet(bet.value, { level });
      round = { ...res.view, staked: res.staked };
      revealed = false;
      build(round.level);
      ctx.settle({ balance: res.balance });
    } catch {
      /* the error is shown */
    }
    busy = false;
    draw();
  }

  async function pick(f, c) {
    if (!round || busy || f !== round.picks.length) return;
    busy = true;
    draw();
    try {
      const res = await ctx.move('pick', { tile: c });
      if (!res.done) {
        sfx.gem();
        round = { ...res.view, staked: res.staked };
        rows[f].el.classList.remove('flash');
        draw();
        rows[f].el.classList.add('flash');
      } else end(res);
    } catch {
      /* the error is shown */
    }
    busy = false;
    draw();
  }

  function pickRandom() {
    if (!round) return;
    const L = levels[round.level];
    pick(round.picks.length, Math.floor(Math.random() * L.cols));
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

  function end(res) {
    const v = res.view;
    round = null;
    revealed = true;
    ctx.roundOver();
    const climbed = v.picks.length;
    rows.forEach((r, f) => {
      r.el.className = `tw-row${f < climbed ? ' done' : ''}`;
      r.tiles.forEach((t, c) => {
        t.disabled = true;
        const trap = v.traps[f].includes(c);
        const hit = v.hit && v.hit.floor === f && v.hit.tile === c;
        const mine = v.picks[f] === c;
        if (trap) {
          if (!t.classList.contains('bomb')) put(t, piece('b'));
          t.className = `tt bomb${hit ? ' hit' : ' dim'}`;
        } else {
          if (!t.classList.contains('gem')) put(t, piece('g'));
          t.className = `tt gem${mine ? '' : ' dim'}`;
        }
      });
    });
    const mult = res.payout / res.staked;
    if (res.payout > 0) {
      sfx.cash();
      hist.push(fmtMult(mult), mult >= 10 ? 'g' : true);
    } else {
      sfx.boom();
      hist.push('0.00×', false);
    }
    showResult(p, res, { lossText: 'Trapped' });
    ctx.settle(res);
  }

  const L = gameLayout(el, ctx, {
    controls: [bet.el, h('div', { class: 'tw-lv' }, field('Difficulty', lv.el, lvNote)), h('div', { class: 'stats' }, sMult.el, sNext.el, sCash.el, sFloor.el), h('div', { class: 'spacer' }), random, main],
    stage: board,
  });
  const hist = history(L.bar);
  const p = pop(L.body);
  draw();
}
