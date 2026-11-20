import { h, put, fmt, fmtMult, betBox, field, stat, gameLayout, history, pop, showResult, sfx, css, asset } from '../ui.js';

css('coinflip', `
.cf { width: 100%; height: 100%; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: clamp(8px, 2cqh, 20px); padding: 56px clamp(12px, 3cqw, 32px) clamp(12px, 2.6cqh, 24px); }
.cf-lad { --fl: #000; --fr: #000; position: relative; height: clamp(52px, 9.5cqh, 78px); overflow: hidden; -webkit-mask-image: linear-gradient(90deg, var(--fl), #000 40px, #000 calc(100% - 40px), var(--fr)); mask-image: linear-gradient(90deg, var(--fl), #000 40px, #000 calc(100% - 40px), var(--fr)); }
.cf-lad.fl { --fl: transparent; }
.cf-lad.fr { --fr: transparent; }
.cf-track { position: absolute; left: 0; top: 0; bottom: 0; display: flex; gap: 8px; transition: transform .55s cubic-bezier(.2,.9,.3,1); }
.cf-step { flex: none; width: clamp(66px, 12cqmin, 104px); border-radius: 12px; background: var(--bg-1); border: 1px solid var(--line); display: grid; place-items: center; align-content: center; gap: 1px; transition: background .25s, border-color .25s, box-shadow .25s, transform .25s; }
.cf-step b { font-family: var(--mono); font-size: clamp(13px, 2.5cqmin, 18px); color: var(--text-2); letter-spacing: -.02em; }
.cf-step small { font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: var(--text-3); font-weight: 700; }
.cf-step.done { background: var(--win-soft); border-color: rgba(34,199,122,.4); }
.cf-step.done b { color: var(--win); }
.cf-step.cur { background: var(--gold-soft); border-color: var(--gold); box-shadow: 0 0 26px -8px rgba(245,184,61,.7), inset 0 1px 0 rgba(255,255,255,.06); }
.cf-step.cur b { color: var(--gold-hi); }
.cf-mid { position: relative; display: grid; place-items: center; align-content: center; min-height: 0; }
.cf-arena { --cs: clamp(130px, min(calc(100cqh - 300px), 58cqw), 420px); position: relative; width: var(--cs); height: var(--cs); perspective: 1400px; }
.cf-halo { position: absolute; inset: -22%; border-radius: 50%; background: radial-gradient(circle, rgba(245,184,61,.22), transparent 62%); transition: background .35s, opacity .35s; }
.cf-halo.w { background: radial-gradient(circle, rgba(34,199,122,.38), transparent 62%); }
.cf-halo.l { background: radial-gradient(circle, rgba(239,75,95,.34), transparent 62%); }
.cf-shadow { position: absolute; left: 14%; right: 14%; bottom: -9%; height: 9%; border-radius: 50%; background: radial-gradient(closest-side, rgba(0,0,0,.75), transparent); }
.cf-toss { position: absolute; inset: 0; will-change: transform; }
.cf-toss.land { animation: cfLand .38s cubic-bezier(.3,1.6,.5,1); }
@keyframes cfLand { 30% { transform: translateY(0) scale(1.05, .94); } }
.cf-coin { position: absolute; inset: 0; transform-style: preserve-3d; will-change: transform; }
.cf-face { position: absolute; inset: 0; border-radius: 50%; backface-visibility: hidden; -webkit-backface-visibility: hidden; display: grid; place-items: center; }
.cf-face.h { transform: translateZ(calc(var(--cs) * .03)); }
.cf-face.t { transform: rotateX(180deg) translateZ(calc(var(--cs) * .03)); }
.cf-edge { position: absolute; left: 1.5%; right: 1.5%; top: 50%; height: calc(var(--cs) * .06); margin-top: calc(var(--cs) * -.03); border-radius: 6px; background: linear-gradient(90deg, var(--gold-lo), #dd951b 18%, var(--gold-hi) 50%, #dd951b 82%, var(--gold-lo)); transform: rotateX(90deg); }
.cf-face img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 14px 22px rgba(0,0,0,.55)); }
.cf-face .fb { display: none; font-family: var(--mono); font-weight: 800; font-size: calc(var(--cs) * .34); color: var(--gold-ink); }
.cf-face.noimg { background: radial-gradient(circle at 35% 30%, #ffe3a3, #f5b83d 45%, #c98d1c 80%); box-shadow: inset 0 0 0 calc(var(--cs) * .045) #dd951b, inset 0 0 0 calc(var(--cs) * .065) #ffd88a, 0 14px 30px rgba(0,0,0,.55); }
.cf-face.noimg img { display: none; }
.cf-face.noimg .fb { display: block; }
.cf-say { margin-top: clamp(14px, 3.4cqh, 34px); text-align: center; min-height: 2.6em; }
.cf-say b { display: block; font-family: var(--mono); font-weight: 700; font-size: clamp(24px, 5.6cqmin, 48px); line-height: 1.05; letter-spacing: -.03em; color: var(--text); }
.cf-say span { display: block; margin-top: 4px; font-weight: 700; font-size: clamp(11px, 1.8cqmin, 14px); letter-spacing: .14em; text-transform: uppercase; color: var(--text-3); }
.cf-say.w b, .cf-say.w span { color: var(--win); }
.cf-say.l b, .cf-say.l span { color: var(--lose); }
.cf-past { display: flex; justify-content: center; gap: clamp(5px, 1cqmin, 9px); min-height: clamp(30px, 5cqmin, 42px); overflow: hidden; }
.cf-p { --ps: clamp(30px, 5cqmin, 42px); flex: none; width: var(--ps); height: var(--ps); border-radius: 50%; position: relative; display: grid; place-items: center; box-shadow: 0 0 0 2px var(--line-2); animation: cfIn .35s cubic-bezier(.2,1.5,.4,1); background: var(--surface-3); }
.cf-p img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; border-radius: 50%; }
.cf-p .fb { display: none; font-family: var(--mono); font-weight: 800; font-size: calc(var(--ps) * .44); color: var(--gold-ink); }
.cf-p.noimg { background: var(--gold-grad); }
.cf-p.noimg img { display: none; }
.cf-p.noimg .fb { display: block; }
.cf-p.w { box-shadow: 0 0 0 2px var(--win), 0 0 14px -2px rgba(34,199,122,.6); }
.cf-p.l { box-shadow: 0 0 0 2px var(--lose), 0 0 14px -2px rgba(239,75,95,.6); }
@keyframes cfIn { from { transform: scale(.3); opacity: 0; } }
.cf-pick { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.cf-pick button { height: 62px; border-radius: 12px; border: 1px solid var(--line-2); background: var(--bg-1); display: flex; align-items: center; justify-content: center; gap: 10px; font-weight: 700; font-size: 15px; transition: border-color .15s, background .15s, transform .08s; }
.cf-pick button:hover:not(:disabled) { border-color: var(--gold); background: var(--gold-soft); }
.cf-pick button:active:not(:disabled) { transform: translateY(1px); }
.cf-pick button:disabled { opacity: .45; cursor: not-allowed; }
.cf-pick button.on { border-color: var(--gold); box-shadow: inset 0 0 0 1px var(--gold); }
.cf-pick .ic { width: 34px; height: 34px; border-radius: 50%; position: relative; display: grid; place-items: center; flex: none; }
.cf-pick .ic img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.cf-pick .ic .fb { display: none; font-family: var(--mono); font-weight: 800; font-size: 15px; color: var(--gold-ink); }
.cf-pick .ic.noimg { background: var(--gold-grad); }
.cf-pick .ic.noimg img { display: none; }
.cf-pick .ic.noimg .fb { display: block; }
`);

const SIDE = { heads: 'H', tails: 'T' };
const cap = (s) => s[0].toUpperCase() + s.slice(1);
/** A coin picture with a drawn fallback until the art arrives. */
function coinPic(side, cls) {
  const img = h('img', { src: asset(`img/coin-${side}.webp`), alt: side, draggable: 'false' });
  const box = h('div', { class: cls }, img, h('span', { class: 'fb' }, SIDE[side]));
  img.addEventListener('error', () => box.classList.add('noimg'));
  return box;
}

export function mount(el, ctx) {
  const mults = ctx.meta.mults || [];
  const MAX = ctx.meta.max || mults.length || 20;
  let round = ctx.round ? { ...ctx.round.view, staked: ctx.round.staked } : null;
  let busy = false;
  let alive = true;

  const bet = betBox(ctx);
  const headsBtn = h('button', { type: 'button', onclick: () => call('heads') }, coinPic('heads', 'ic'), 'Heads');
  const tailsBtn = h('button', { type: 'button', onclick: () => call('tails') }, coinPic('tails', 'ic'), 'Tails');
  const sStreak = stat('Streak');
  const sMult = stat('Multiplier');
  const sNext = stat('Next win');
  const sCash = stat('Cash out');
  const main = h('button', { class: 'btn lg gold', onclick: () => (round ? cashout() : start()) }, 'Bet');

  // ── stage ──
  const steps = mults.map((m, i) => h('div', { class: 'cf-step' }, h('small', {}, `${i + 1} in a row`), h('b', {}, fmtMult(m))));
  const track = h('div', { class: 'cf-track' }, steps);
  const ladder = h('div', { class: 'cf-lad' }, track);
  const coinEl = h('div', { class: 'cf-coin' }, h('div', { class: 'cf-edge' }), coinPic('heads', 'cf-face h'), coinPic('tails', 'cf-face t'));
  const toss = h('div', { class: 'cf-toss' }, coinEl);
  const halo = h('div', { class: 'cf-halo' });
  const shadow = h('div', { class: 'cf-shadow' });
  const arena = h('div', { class: 'cf-arena' }, halo, shadow, toss);
  const sayB = h('b', {}, 'Heads or tails?');
  const sayS = h('span', {}, 'Every right call doubles it');
  const say = h('div', { class: 'cf-say' }, sayB, sayS);
  const pastEl = h('div', { class: 'cf-past' });
  const stage = h('div', { class: 'cf' }, ladder, h('div', { class: 'cf-mid' }, arena, say), pastEl);

  // ── the coin ──
  let rot = 0; // degrees around X: 0 shows heads, 180 tails
  let lift = 0; // 0 on the table, 1 at the top of the toss
  let anim = null;
  let raf = 0;
  const SPEED = 1.9; // degrees per ms while spinning
  function paintCoin() {
    const A = arena.clientHeight * 0.42;
    coinEl.style.transform = `rotateX(${rot}deg)`;
    toss.style.transform = `translateY(${-A * lift}px) scale(${1 + 0.14 * lift})`;
    shadow.style.transform = `scale(${1 - 0.45 * lift})`;
    shadow.style.opacity = String(1 - 0.6 * lift);
  }
  function loop(now) {
    raf = 0;
    if (!anim) return;
    const dt = Math.min(50, now - anim.last);
    anim.last = now;
    if (anim.mode === 'spin') {
      rot += SPEED * dt;
      lift = Math.min(1, (now - anim.t0) / 320);
      lift = 1 - (1 - lift) ** 2;
      if (anim.land && now - anim.t0 >= 320) startLand(now);
    } else if (anim.mode === 'land') {
      const k = Math.min(1, (now - anim.t0) / anim.T);
      rot = anim.from + (anim.to - anim.from) * (1 - (1 - k) ** 2);
      lift = 1 - k * k;
      if (k >= 1) {
        rot = anim.to % 360;
        lift = 0;
        const done = anim.done;
        anim = null;
        paintCoin();
        toss.classList.remove('land');
        void toss.offsetWidth;
        toss.classList.add('land');
        sfx.coin();
        return done();
      }
    }
    paintCoin();
    raf = requestAnimationFrame(loop);
  }
  function spin() {
    toss.classList.remove('land');
    anim = { mode: 'spin', t0: performance.now(), last: performance.now() };
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function startLand(now) {
    const base = anim.land.side === 'heads' ? 0 : 180;
    const to = base + 360 * Math.ceil((rot + 720 - base) / 360);
    anim = { mode: 'land', from: rot, to, T: (2 * (to - rot)) / SPEED, t0: now, last: now, done: anim.land.done };
  }
  /** Let the spinning coin come down on `side`. */
  const land = (side) =>
    new Promise((done) => {
      if (!anim || !alive) {
        rot = side === 'heads' ? 0 : 180;
        paintCoin();
        return done();
      }
      anim.land = { side, done };
    });

  // ── drawing ──
  function placeLadder() {
    const at = round ? Math.min(round.streak, MAX - 1) : 0;
    steps.forEach((s, i) => (s.className = `cf-step${round && i < round.streak ? ' done' : ''}${i === at ? ' cur' : ''}`));
    const w = steps[0]?.offsetWidth || 80;
    const gap = 8;
    const view = ladder.clientWidth;
    const full = steps.length * (w + gap) - gap;
    let tx = view / 2 - (at * (w + gap) + w / 2);
    tx = Math.min(0, Math.max(view - full, tx));
    if (full < view) tx = (view - full) / 2;
    track.style.transform = `translateX(${tx}px)`;
    ladder.classList.toggle('fl', tx < -1);
    ladder.classList.toggle('fr', tx > view - full + 1);
  }
  function draw() {
    const playing = !!round;
    bet.lock(playing || busy);
    headsBtn.disabled = tailsBtn.disabled = busy;
    if (playing) {
      const cash = Math.floor(round.staked * round.mult);
      sStreak.set(`${round.streak} / ${MAX}`);
      sMult.set(round.mult ? fmtMult(round.mult) : '—');
      sNext.set(fmtMult(round.next));
      sCash.set(round.mult ? fmt(cash) : '—');
      main.textContent = round.streak ? `Cash out ${fmt(cash)}` : 'Call heads or tails';
      main.className = `btn lg ${round.streak ? 'green' : ''}`;
      main.disabled = busy || !round.streak;
    } else {
      sStreak.set(`0 / ${MAX}`);
      sMult.set('—');
      sNext.set(fmtMult(mults[0] || 0));
      sCash.set('—');
      main.textContent = 'Bet';
      main.className = 'btn lg gold';
      main.disabled = busy;
    }
    placeLadder();
  }
  function addPast(side, win) {
    const c = coinPic(side, `cf-p ${win ? 'w' : 'l'}`);
    pastEl.append(c);
    const fit = Math.max(4, Math.floor((pastEl.clientWidth + 8) / ((c.offsetWidth || 36) + 8)));
    while (pastEl.children.length > Math.min(16, fit)) pastEl.firstChild.remove();
  }
  function setSay(b, s, kind = '') {
    sayB.textContent = b;
    sayS.textContent = s;
    say.className = `cf-say ${kind}`;
  }

  // ── play ──
  async function start() {
    if (busy || round) return !!round;
    busy = true;
    draw();
    sfx.chip();
    try {
      const res = await ctx.bet(bet.value, {});
      round = { ...res.view, staked: res.staked };
      ctx.settle({ balance: res.balance });
      halo.className = 'cf-halo';
      setSay('1.00×', 'Call it');
    } catch {
      /* the error is shown */
    }
    busy = false;
    draw();
    return !!round;
  }

  async function call(side) {
    if (busy) return;
    if (!round && !(await start())) return;
    busy = true;
    headsBtn.classList.toggle('on', side === 'heads');
    tailsBtn.classList.toggle('on', side === 'tails');
    draw();
    halo.className = 'cf-halo';
    setSay('…', `You called ${side}`);
    sfx.flip();
    spin();
    let res;
    try {
      res = await ctx.move(side);
    } catch {
      await land(rot % 360 < 90 || rot % 360 > 270 ? 'heads' : 'tails');
      busy = false;
      draw();
      return;
    }
    const last = res.view.flips[res.view.flips.length - 1];
    await land(last.side);
    if (!alive) return;
    addPast(last.side, last.win);
    halo.className = `cf-halo ${last.win ? 'w' : 'l'}`;
    if (!res.done) {
      round = { ...res.view, staked: res.staked };
      sfx.gem();
      setSay(fmtMult(round.mult), `${last.side} · ${round.streak} in a row`, 'w');
    } else end(res, last);
    busy = false;
    draw();
  }

  async function cashout() {
    if (!round || busy || !round.streak) return;
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

  function end(res, last) {
    round = null;
    ctx.roundOver();
    const mult = res.payout / res.staked;
    if (res.payout > 0) {
      sfx.cash();
      setSay(fmtMult(mult), `Cashed out · +${fmt(res.payout - res.staked)}`, 'w');
      hist.push(fmtMult(mult), mult >= 10 ? 'g' : true);
    } else {
      setSay(last ? cap(last.side) : 'Lost', 'Wrong call', 'l');
      hist.push('0.00×', false);
    }
    showResult(p, res, { lossText: 'Wrong call' });
    ctx.settle(res);
  }

  const L = gameLayout(el, ctx, {
    controls: [bet.el, field('Your call', h('div', { class: 'cf-pick' }, headsBtn, tailsBtn)), h('div', { class: 'stats' }, sStreak.el, sMult.el, sNext.el, sCash.el), h('div', { class: 'spacer' }), main],
    stage,
  });
  const hist = history(L.bar);
  const p = pop(L.body);
  if (round) {
    const lastFlip = round.flips[round.flips.length - 1];
    round.flips.forEach((f) => addPast(f.side, f.win));
    if (lastFlip) rot = lastFlip.side === 'heads' ? 0 : 180;
    setSay(round.mult ? fmtMult(round.mult) : '1.00×', round.streak ? `${round.streak} in a row` : 'Call it', round.streak ? 'w' : '');
  }
  paintCoin();
  draw();
  const ro = new ResizeObserver(() => (placeLadder(), paintCoin()));
  ro.observe(stage);
  const key = (e) => {
    if (e.target !== document.body) return;
    if (e.code === 'Space') e.preventDefault(), main.click();
    else if (e.key === 'h' || e.key === 'H') call('heads');
    else if (e.key === 't' || e.key === 'T') call('tails');
  };
  document.addEventListener('keydown', key);
  return {
    unmount() {
      alive = false;
      anim = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('keydown', key);
    },
  };
}
