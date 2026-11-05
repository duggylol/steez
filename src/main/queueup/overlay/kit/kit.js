/* ============================================================
   Steez overlay kit — runtime shared by the three TikTok overlays.
   Exposes window.SteezKit: applies a widget style (CSS variables +
   data attributes), plays entrance / change animations, counts
   numbers up, seeds sparkles and keeps the /queueup-ws socket open.

   URL parameters (set by the Steez editor, never needed in OBS):
     ?preset=<id>  preset thumbnail: that preset's look, sample data,
                   no live socket
     ?editor=1     in-app preview: sample data while there is none,
                   reports its size to the app
   Both play a fake update when the app posts {type: 'steez:demo'}.
   ============================================================ */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const thumb = params.get('preset') || '';
  const editor = params.has('editor') || !!thumb;
  const reduced = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const MONO = /console|consolas|courier|mono/i;

  let look = null;
  let entranceKey = '';

  function hexToRgb(hex, fallback) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
    return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : fallback;
  }

  function fontStack(name) {
    const clean = String(name || '').replace(/["'`<>;{}\\]/g, '').trim();
    const tail = MONO.test(clean) ? '"Cascadia Mono", Consolas, monospace' : '"Segoe UI", Inter, system-ui, sans-serif';
    return clean ? `"${clean}", ${tail}` : tail;
  }

  /** Applies a widget style. Returns true when the entrance should replay (new look). */
  function applyLook(l) {
    look = l || {};
    const r = document.documentElement.style;
    const set = (k, v) => r.setProperty(k, String(v));
    set('--c1', look.accent || '#d4d4d4');
    set('--c2', look.accent2 || '#8c8c8c');
    set('--c1-rgb', hexToRgb(look.accent, '212, 212, 212'));
    set('--c2-rgb', hexToRgb(look.accent2, '140, 140, 140'));
    set('--text', look.textColor || '#f2f2f2');
    set('--text-rgb', hexToRgb(look.textColor, '242, 242, 242'));
    set('--bg', hexToRgb(look.bg, '18, 18, 18'));
    set('--bg-a', Number(look.bgOpacity ?? 0.82));
    set('--font', fontStack(look.fontFamily));
    set('--weight', Number(look.fontWeight) || 700);
    set('--radius', (Number(look.radius) || 0) + 'px');
    set('--bw', (Number(look.borderWidth) || 0) + 'px');
    if (look.width) set('--width', Number(look.width) + 'px');
    set('--scale', Number(look.scale) || 1);
    set('--sp', Number(look.spacing) || 1);
    set('--k', (1 / Math.max(0.25, Number(look.speed) || 1)).toFixed(3));

    const b = document.body;
    b.dataset.theme = look.preset || 'steez';
    b.dataset.entrance = look.entrance || 'fade';
    b.dataset.change = look.change || 'bump';
    b.dataset.idle = look.idle || 'none';
    b.classList.toggle('anim-off', look.animations === false);
    b.classList.toggle('fx-glow', !!look.glow);
    b.classList.toggle('fx-particles', !!look.particles);
    b.classList.toggle('fx-ring', !!look.ring);
    b.classList.toggle('has-icon', !!look.showIcon);
    b.classList.toggle('has-bg', Number(look.bgOpacity) > 0.02);

    // A new preset or entrance replays it so the streamer sees it; slider drags don't.
    const key = [look.preset, look.entrance, look.animations].join('|');
    const replay = key !== entranceKey;
    entranceKey = key;
    return replay;
  }

  function animOn() {
    return !(look && look.animations === false) && !reduced.matches;
  }

  /** Restarts a CSS animation class on an element and takes it off again afterwards. */
  function replay(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    clearTimeout(el['_kit_' + cls]);
    const k = 1 / Math.max(0.25, Number(look && look.speed) || 1);
    el['_kit_' + cls] = setTimeout(() => el.classList.remove(cls), ms * k + 60);
  }

  const entrance = (el) => replay(el, 'in', 1200);
  const change = (card) => replay(card, 'chg', 950);

  /** Counts el's number from `from` to `to`, painting each frame with fmt. */
  function countTo(el, from, to, fmt, ms) {
    stopCount(el);
    if (!animOn() || Math.abs(to - from) <= 1 || !Number.isFinite(from) || !Number.isFinite(to)) {
      el.textContent = fmt(to);
      return;
    }
    const k = 1 / Math.max(0.25, Number(look && look.speed) || 1);
    const dur = Math.min(1400, (ms || 650) * k);
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.round(from + (to - from) * e));
      if (p < 1) el._kitCount = requestAnimationFrame(step);
    };
    el._kitCount = requestAnimationFrame(step);
    // Frames stop while a source is hidden; make sure the real number always lands.
    el._kitDone = setTimeout(() => {
      cancelAnimationFrame(el._kitCount);
      el.textContent = fmt(to);
    }, dur + 150);
  }

  /** Cancels a count in progress (call before writing the number directly). */
  function stopCount(el) {
    cancelAnimationFrame(el._kitCount);
    clearTimeout(el._kitDone);
  }

  function seedSparkles(box, n) {
    if (!box) return;
    box.innerHTML = '';
    for (let i = 0; i < (n || 18); i++) {
      const s = document.createElement('i');
      if (i % 5 === 0) s.className = 'big';
      s.style.left = (4 + Math.random() * 92) + '%';
      s.style.top = (10 + Math.random() * 85) + '%';
      s.style.setProperty('--dur', (4 + Math.random() * 5).toFixed(2) + 's');
      s.style.setProperty('--delay', (-Math.random() * 8).toFixed(2) + 's');
      box.appendChild(s);
    }
  }

  /** Thumbnail mode: the preset's look for this widget, on the widget's defaults. */
  function loadPreset(widget, id) {
    return fetch('/overlay/kit/presets.json')
      .then((r) => r.json())
      .then((kit) => {
        const p = kit.presets.find((x) => x.id === id) || kit.presets[0];
        return { ...kit.defaults[widget], ...p.looks[widget], preset: p.id };
      });
  }

  /** Live pushes from Steez over /queueup-ws, reconnecting with backoff. */
  function connect(onMessage) {
    let retry = 0;
    const open = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/queueup-ws`);
      ws.onopen = () => { retry = 0; };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (_) { return; }
        onMessage(msg);
      };
      ws.onclose = () => {
        retry = Math.min(retry + 1, 6);
        setTimeout(open, Math.min(500 * Math.pow(2, retry - 1), 8000));
      };
      ws.onerror = () => { try { ws.close(); } catch (_) { /* closing anyway */ } };
    };
    open();
  }

  /** The editor's "Play animation" button (and hovering a preset thumbnail). */
  function onDemo(fn) {
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'steez:demo') fn(e.data);
    });
  }

  /** In the editor, tells the app how big the overlay is so it can suggest the OBS size. */
  function reportSize(stage) {
    if (!editor || thumb || window.parent === window || !stage) return;
    let last = '';
    const send = () => {
      const rect = stage.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(document.body).paddingLeft) || 0;
      const w = Math.ceil(rect.width + pad * 2);
      const h = Math.ceil(rect.height + pad * 2);
      const key = w + 'x' + h;
      if (key === last) return;
      last = key;
      window.parent.postMessage({ type: 'steez:size', width: w, height: h }, '*');
    };
    if (window.ResizeObserver) new ResizeObserver(send).observe(stage);
    setInterval(send, 1500);
    send();
  }

  window.SteezKit = { thumb, editor, applyLook, animOn, replay, entrance, change, countTo, stopCount, seedSparkles, loadPreset, connect, onDemo, reportSize };
})();
