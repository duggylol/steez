/* ============================================================
   Steez TikTok rank + Gift Gallery badges — OBS overlay client
   One script for both pages; <body data-kind="rank|gallery"> says
   which one this is. Live over /queueup-ws; the look comes from the
   badge's widget style (see /overlay/kit).
   ============================================================ */
'use strict';

const Kit = window.SteezKit;
const KIND = document.body.dataset.kind === 'gallery' ? 'gallery' : 'rank';
const $ = (id) => document.getElementById(id);
const els = {
  stage: $('stage'), badge: $('badge'), labelText: $('labelText'), num: $('num'), of: $('of'),
  sub: $('sub'), fill: $('fill'), sparkles: $('sparkles'), pop: $('pop'),
};

// Shown in the app's previews while TikTok hasn't sent anything yet.
const SAMPLE = {
  rank: { source: 'sample', text: '#12', value: '12', score: '4520', ranked: true },
  gallery: { source: 'sample', text: '7/25', collected: 7, total: 25, ratio: 0.28 },
};

let style = {};
let real = null;   // last stats snapshot from Steez
let demo = null;   // fake display while a preview animation plays
let shown = null;  // what is on screen now: { text, parsed }
let demoTimers = [];

function fmt(v) {
  const s = String(v || '');
  return /^\d+$/.test(s) ? Number(s).toLocaleString() : s;
}

/** "#12" -> { n: 12, plus: '' }, "#99+" -> { n: 99, plus: '+' }, anything else -> null. */
function rankNum(text) {
  const m = /^#(\d+)(\+?)$/.exec(String(text || ''));
  return m ? { n: Number(m[1]), plus: m[2] } : null;
}

function applyStyle(s) {
  style = s || {};
  const replay = Kit.applyLook(style);
  document.body.classList.toggle('no-label', style.showLabel === false);
  document.body.classList.toggle('no-bar', KIND !== 'gallery' || style.showBar === false);
  els.labelText.textContent = KIND === 'rank' ? (style.rankLabel ?? 'GAMING · DAILY') : (style.galleryLabel ?? 'GIFT GALLERY');
  if (replay) Kit.entrance(els.badge);
}

function current() {
  if (demo) return demo;
  const d = real && real.display && real.display[KIND];
  if (Kit.editor && (!d || d.source === 'none')) return SAMPLE[KIND];
  return d || null;
}

/** Puts a value on screen, counting up and playing the change animation when it moves. */
function paint(text, parsed, quiet) {
  const prev = quiet ? null : shown;
  shown = { text, parsed };
  if (!prev) {
    Kit.stopCount(els.num);
    els.num.textContent = text;
    return;
  }
  if (prev.text === text) return;

  const fmtN = (n) => (KIND === 'rank' ? '#' + n + (parsed ? parsed.plus : '') : String(n));
  const comparable = parsed && prev.parsed && parsed.plus === prev.parsed.plus;
  if (style.countUp && comparable) Kit.countTo(els.num, prev.parsed.n, parsed.n, fmtN);
  else {
    Kit.stopCount(els.num);
    els.num.textContent = text;
  }

  // Rank: lower is better. Gallery: only a gift lighting up is worth celebrating.
  let better = false;
  if (KIND === 'rank') {
    better = parsed ? !prev.parsed || parsed.n < prev.parsed.n : false;
    els.pop.textContent = comparable ? (parsed.n < prev.parsed.n ? '▲' : '▼') + Math.abs(prev.parsed.n - parsed.n) : better ? '▲' : '';
    Kit.change(els.badge);
  } else {
    better = !!(parsed && prev.parsed && parsed.n > prev.parsed.n);
    els.pop.textContent = better ? '+' + (parsed.n - prev.parsed.n) : '';
    if (better) Kit.change(els.badge);
  }
}

function render(quiet) {
  const d = current();
  if (!d) return;
  if (KIND === 'rank') {
    paint(d.text, rankNum(d.text), quiet);
    els.of.textContent = '';
    els.sub.textContent = style.showScore !== false && d.score ? `Score ${fmt(d.score)}` : '';
    document.body.classList.toggle('empty', !d.ranked);
  } else {
    const none = d.source === 'none';
    const total = Number(d.total) || 0;
    paint(none ? '—' : String(d.collected), none ? null : { n: Number(d.collected) || 0, plus: '' }, quiet);
    els.of.textContent = !none && total > 0 && style.showTotal !== false ? '/' + total : '';
    els.sub.textContent = '';
    els.fill.style.width = ((total > 0 ? Math.min(1, d.collected / total) : 0) * 100).toFixed(1) + '%';
    document.body.classList.toggle('empty', none);
  }
}

/* ------------------------------------------------------------------ */
/* preview animation (only ever triggered by the Steez editor)        */
/* ------------------------------------------------------------------ */

function playDemo() {
  demoTimers.forEach(clearTimeout);
  const cur = current() || SAMPLE[KIND];
  let from, to;
  if (KIND === 'rank') {
    const p = rankNum(cur.text);
    const n = p && !p.plus ? p.n : 15;
    const start = n > 1 ? n : 4;
    const end = Math.max(1, start - Math.max(1, Math.round(start * 0.25)));
    from = { source: 'demo', text: '#' + start, ranked: true, score: cur.score || '' };
    to = { ...from, text: '#' + end };
  } else {
    const total = Number(cur.total) || 25;
    const start = Math.min(total - 1, cur.source === 'none' ? 6 : Number(cur.collected) || 0);
    from = { source: 'demo', collected: start, total, ratio: start / total };
    to = { ...from, collected: start + 1, ratio: (start + 1) / total };
  }
  demo = from;
  render(true);
  Kit.entrance(els.badge);
  demoTimers = [
    setTimeout(() => { demo = to; render(); }, 900),
    setTimeout(() => { demo = null; render(true); }, 4200),
  ];
}

/* ------------------------------------------------------------------ */
/* boot                                                               */
/* ------------------------------------------------------------------ */

function handle(msg) {
  if (!msg || msg.type !== 'tiktokStats' || !msg.tiktokStats) return;
  real = msg.tiktokStats;
  applyStyle(KIND === 'rank' ? real.style : real.galleryStyle || real.style);
  render();
}

Kit.seedSparkles(els.sparkles, 10);
Kit.onDemo(playDemo);
Kit.reportSize(els.stage);

if (Kit.thumb) {
  Kit.loadPreset(KIND, Kit.thumb).then((look) => { applyStyle(look); render(); }).catch(() => {});
} else {
  fetch(`/overlay/tiktok-${KIND}/api/state`).then((r) => r.json()).then((s) => handle({ type: 'tiktokStats', ...s })).catch(() => {});
  Kit.connect(handle);
}
