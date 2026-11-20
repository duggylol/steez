import { h, put, fmt, fmtMult, betBox, field, stat, seg, autoplay, gameLayout, history, pop, showResult, sfx, tween, ease, css, load, keep } from '../ui.js';

css('dice', `
.dc { width: min(92cqw, 900px); display: flex; flex-direction: column; gap: clamp(22px, 5cqh, 48px); padding-top: 40px; }
.dc-big { text-align: center; font-family: var(--mono); font-weight: 700; font-size: clamp(56px, 16cqmin, 150px); line-height: 1; letter-spacing: -.04em; color: var(--text-3); transition: color .2s, text-shadow .2s; }
.dc-big.w { color: var(--win); text-shadow: 0 0 60px rgba(34,199,122,.35); }
.dc-big.l { color: var(--lose); }
.dc-rail { position: relative; padding: 18px; border-radius: 999px; background: var(--bg-1); border: 1px solid var(--line); box-shadow: inset 0 2px 8px rgba(0,0,0,.5); }
.dc-track { position: relative; height: 12px; border-radius: 99px; background: var(--lose); cursor: pointer; }
.dc-zone { position: absolute; top: 0; bottom: 0; background: var(--win); border-radius: 99px; }
.dc-knob { position: absolute; top: 50%; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 9px; background: var(--gold-grad); box-shadow: 0 0 0 4px var(--bg-1), 0 6px 14px rgba(0,0,0,.6); cursor: grab; touch-action: none; display: grid; place-items: center; }
.dc-knob::before { content: ''; width: 10px; height: 2px; background: var(--gold-ink); box-shadow: 0 -4px 0 var(--gold-ink), 0 4px 0 var(--gold-ink); border-radius: 2px; }
.dc-mark { position: absolute; bottom: calc(100% + 16px); transform: translateX(-50%); transition: opacity .2s; pointer-events: none; }
.dc-mark .d { width: 54px; height: 54px; border-radius: 14px; display: grid; place-items: center; background: #fff; color: #10151f; font-family: var(--mono); font-weight: 700; font-size: 15px; box-shadow: 0 10px 24px rgba(0,0,0,.6); transform: rotate(45deg); }
.dc-mark .d span { transform: rotate(-45deg); }
.dc-mark.w .d { background: var(--win); color: #04170d; }
.dc-mark.l .d { background: var(--lose); color: #fff; }
.dc-scale { display: flex; justify-content: space-between; margin: 14px 4px 0; font-family: var(--mono); font-size: 12.5px; color: var(--text-3); font-weight: 600; }
.dc-nums { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.dc-nums .inp { text-align: center; }
.dc-flip { width: 100%; height: 46px; border-radius: 12px; background: var(--bg-1); border: 1px solid var(--line-2); font-family: var(--mono); font-weight: 700; font-size: 15px; display: flex; align-items: center; justify-content: center; gap: 8px; }
.dc-flip:hover { border-color: var(--gold); }
@container (max-height: 420px) { .dc { gap: 16px; padding-top: 30px; } .dc-big { font-size: 15cqmin; } }
`);

export function mount(el, ctx) {
  const R = ctx.casino.returnPercent / 100;
  let chance = Number(load('casinoDiceChance', 49.5)) || 49.5;
  let over = load('casinoDiceOver') === '1';
  let busy = false;
  let markAt = 50;

  const bet = betBox(ctx);
  const sProfit = stat('Profit on win');
  const go = h('button', { class: 'btn lg gold' }, 'Bet');
  const auto = autoplay(ctx, { button: go, play, lock: (on) => lockAll(on) });

  const big = h('div', { class: 'dc-big' }, '50.00');
  const zone = h('div', { class: 'dc-zone' });
  const knob = h('div', { class: 'dc-knob', role: 'slider', 'aria-label': 'Win chance' });
  const markD = h('div', { class: 'd' }, h('span', {}, '50.00'));
  const mark = h('div', { class: 'dc-mark', style: { left: '50%', opacity: 0 } }, markD);
  const track = h('div', { class: 'dc-track' }, zone, knob, mark);
  const multIn = h('input', { class: 'inp', inputmode: 'decimal' });
  const chanceIn = h('input', { class: 'inp', inputmode: 'decimal' });
  const flipBtn = h('button', { class: 'dc-flip', onclick: () => ((over = !over), keep('casinoDiceOver', over ? '1' : '0'), sfx.click(), draw()) });
  const flipField = field('Roll under', flipBtn);
  const flipLabel = flipField.querySelector('.lab span');
  const stageEl = h(
    'div',
    { class: 'dc' },
    big,
    h('div', {}, h('div', { class: 'dc-rail' }, track), h('div', { class: 'dc-scale' }, ['0', '25', '50', '75', '100'].map((x) => h('span', {}, x)))),
    h('div', { class: 'dc-nums' }, field('Multiplier', multIn), flipField, field('Win chance', chanceIn, '%')),
  );

  const mult = () => Math.floor(((R * 100) / chance) * 10000) / 10000;
  const line = () => (over ? 100 - chance : chance);
  function setChance(v) {
    chance = Math.min(95, Math.max(1, Math.round(Number(v) * 100) / 100 || 1));
    keep('casinoDiceChance', chance);
    draw();
  }
  function draw() {
    const l = line();
    zone.style.left = over ? `${l}%` : '0%';
    zone.style.width = `${chance}%`;
    knob.style.left = `${l}%`;
    multIn.value = mult().toFixed(4);
    chanceIn.value = chance.toFixed(2);
    flipBtn.textContent = `${l.toFixed(2)} ⇅`;
    flipLabel.textContent = over ? 'Roll over' : 'Roll under';
    sProfit.set(fmt(Math.floor(bet.value * mult()) - bet.value));
  }
  chanceIn.addEventListener('change', () => setChance(chanceIn.value));
  multIn.addEventListener('change', () => setChance((R * 100) / Math.max(1.0102, Number(multIn.value) || 2)));
  bet.onChange(draw);
  // drag the knob (or click the track) to set the line
  const fromX = (x) => {
    const r = track.getBoundingClientRect();
    const p = Math.min(98, Math.max(2, ((x - r.left) / r.width) * 100));
    setChance(over ? 100 - p : p);
    sfx.tick();
  };
  track.addEventListener('pointerdown', (e) => {
    if (busy) return;
    fromX(e.clientX);
    const move = (ev) => fromX(ev.clientX);
    const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up));
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  function lockAll(on) {
    bet.lock(on);
    multIn.disabled = chanceIn.disabled = flipBtn.disabled = on;
  }

  async function play() {
    if (busy) return null;
    busy = true;
    if (!auto.running) lockAll(true), (go.disabled = true);
    let res;
    try {
      res = await ctx.bet(bet.value, { chance, over });
    } catch {
      busy = false;
      if (!auto.running) lockAll(false), (go.disabled = false);
      return null;
    }
    const d = res.result;
    sfx.dice();
    big.className = 'dc-big';
    mark.className = 'dc-mark';
    mark.style.opacity = 1;
    const from = markAt;
    await tween(auto.running ? 380 : 620, (t) => {
      const v = from + (d.roll - from) * ease.outQuint(t);
      mark.style.left = `${v}%`;
      markD.firstChild.textContent = big.textContent = v.toFixed(2);
    });
    markAt = d.roll;
    markD.firstChild.textContent = big.textContent = d.roll.toFixed(2);
    big.classList.add(d.win ? 'w' : 'l');
    mark.classList.add(d.win ? 'w' : 'l');
    hist.push(d.roll.toFixed(2), d.win);
    showResult(p, res);
    ctx.settle(res);
    busy = false;
    if (!auto.running) lockAll(false), (go.disabled = false);
    return res;
  }

  const L = gameLayout(el, ctx, { controls: [auto.mode, bet.el, auto.box, h('div', { class: 'stats' }, sProfit.el, stat('Max roll', '99.99').el), h('div', { class: 'spacer' }), go], stage: stageEl });
  const hist = history(L.bar);
  const p = pop(L.body);
  draw();
  const key = (e) => e.code === 'Space' && e.target === document.body && (e.preventDefault(), go.click());
  document.addEventListener('keydown', key);
  return { unmount: () => document.removeEventListener('keydown', key) };
}
