/* ============================================================
   Steez TikTok rank + Gift Gallery badges — OBS overlay client
   One script for both pages; <body data-kind="rank|gallery"> says
   which one this is. Live over /queueup-ws.
   ============================================================ */
'use strict';

const KIND = document.body.dataset.kind === 'gallery' ? 'gallery' : 'rank';
const $ = id => document.getElementById(id);
const els = { badge: $('badge'), label: $('label'), value: $('value'), sub: $('sub'), fill: $('fill') };

let last = null; // what was on screen, to decide when to bump

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
  return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : '18, 18, 18';
}

function fmt(v) {
  const s = String(v || '');
  return /^\d+$/.test(s) ? Number(s).toLocaleString() : s;
}

function applyStyle(style) {
  const r = document.documentElement.style;
  r.setProperty('--accent', style.accent || '#d4d4d4');
  r.setProperty('--text', style.textColor || '#f2f2f2');
  r.setProperty('--bg', hexToRgb(style.bg));
  r.setProperty('--bg-opacity', Number(style.bgOpacity ?? 0.82));
  r.setProperty('--scale', Number(style.scale) || 1);
  document.body.classList.toggle('no-label', style.showLabel === false);
  document.body.classList.toggle('no-bar', KIND !== 'gallery' || style.showBar === false);
  els.label.textContent = KIND === 'rank' ? (style.rankLabel ?? 'GAMING · DAILY') : (style.galleryLabel ?? 'GIFT GALLERY');
}

function bump() {
  els.value.classList.remove('bump');
  els.badge.classList.remove('flash');
  void els.value.offsetWidth;
  els.value.classList.add('bump');
  els.badge.classList.add('flash');
}

function render(stats) {
  if (!stats || !stats.display) return;
  const style = stats.style || {};
  applyStyle(style);

  if (KIND === 'rank') {
    const d = stats.display.rank;
    els.value.textContent = d.text;
    els.sub.textContent = style.showScore !== false && d.score ? `Score ${fmt(d.score)}` : '';
    document.body.classList.toggle('empty', !d.ranked);
    if (last !== null && last !== d.text) bump();
    last = d.text;
  } else {
    const d = stats.display.gallery;
    els.value.textContent = d.text;
    els.sub.textContent = '';
    els.fill.style.width = (d.ratio * 100).toFixed(1) + '%';
    document.body.classList.toggle('empty', d.source === 'none');
    if (last !== null && d.collected > last) bump();
    last = d.collected;
  }
}

/* ------------------------------------------------------------------ */
/* live connection                                                    */
/* ------------------------------------------------------------------ */

let ws = null;
let retry = 0;

function handle(msg) {
  if (!msg || msg.type !== 'tiktokStats') return;
  render(msg.tiktokStats);
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/queueup-ws`);
  ws.onopen = () => { retry = 0; };
  ws.onmessage = ev => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    handle(msg);
  };
  ws.onclose = () => {
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, Math.min(500 * Math.pow(2, retry - 1), 8000));
  };
  ws.onerror = () => { try { ws.close(); } catch (_) {} };
}

fetch(`/overlay/tiktok-${KIND}/api/state`).then(r => r.json()).then(s => handle({ type: 'tiktokStats', ...s })).catch(() => {});
connect();
