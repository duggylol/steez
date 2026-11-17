/* TV screen logic — conservative JS for Samsung TV browsers. */
(function () {
  var h = SMP.h, $ = function (id) { return document.getElementById(id); };
  var code = location.pathname.split('/').pop();
  var params = new URLSearchParams(location.search);
  var autoStart = params.has('obs') || params.has('autoplay');
  var S = { settings: {}, timer: null, stats: {}, goals: [], feed: [] };
  var unlocked = false, audioCtx = null;

  // fill static icons
  var icoEls = document.querySelectorAll('[data-icon]');
  for (var i = 0; i < icoEls.length; i++) icoEls[i].innerHTML = SMP.icons[icoEls[i].getAttribute('data-icon')] || '';

  var conn = SMP.connect('tv', '&code=' + encodeURIComponent(code), onMessage, function (ok) {
    $('conn').firstChild.className = 'dot ' + (ok ? 'connected' : 'reconnecting');
  });

  function onMessage(m) {
    switch (m.t) {
      case 'init':
        S = m.state;
        renderAll();
        renderChatAll(m.state.chat || []);
        break;
      case 'timer': S.timer = m.timer; renderTimer(true); break;
      case 'stats': S.stats = m.stats; S.goals = m.goals; renderStats(); renderGoals(); break;
      case 'feed':
        S.feed.unshift(m.item); if (S.feed.length > 30) S.feed.length = 30;
        renderFeed(); queueAlert(m.item);
        if (m.item.added > 0) pop('+' + SMP.fmtDur(m.item.added));
        break;
      case 'chat': addChat(m.msg); break;
      case 'clear': clearChat(m); break;
      case 'play': enqueueMedia(m); break;
      case 'ended': renderTimer(); break;
      case 'control':
        if (m.action === 'skip') nextMedia();
        else if (m.action === 'clear') { mediaQueue = []; nextMedia(); }
        else if (m.action === 'reload') location.reload();
        else if (m.action === 'test-sound') testSound();
        break;
    }
  }

  // ------------------------------------------------------------ render
  function renderAll() {
    var s = S.settings;
    SMP.applyTheme(s);
    $('title').textContent = s.title || 'SUBATHON';
    document.title = (s.title || 'Subathon') + ' · TV';
    $('chan').textContent = s.channel ? '#' + s.channel : '';
    var tv = s.tv || {};
    $('stage').className = 'stage' + (tv.showChat === false ? ' no-chat' : '');
    $('goalsPanel').hidden = tv.showGoals === false;
    $('feedPanel').hidden = tv.showFeed === false;
    var mult = s.time && Number(s.time.multiplier);
    $('multiplier').hidden = !(mult && mult !== 1);
    $('multiplier').textContent = mult + '× TIME';
    renderTimer(); renderStats(); renderGoals(); renderFeed();
  }

  var lastRem = null;
  function renderTimer(fromUpdate) {
    var t = S.timer;
    if (!t) return;
    var rem = SMP.remaining(t, conn);
    var c = SMP.fmtClock(rem);
    var el = $('timer');
    el.textContent = c.text;
    var base = 'timer mono' + (c.days ? ' days' : '');
    if (fromUpdate && lastRem != null && rem > lastRem + 1500) {
      el.className = base; void el.offsetWidth; el.className = base + ' bump';
    } else if (rem < 5 * 60000 && t.running) el.className = base + ' low';
    else if (el.className.indexOf('bump') < 0) el.className = base;
    lastRem = rem;
    $('paused').hidden = t.running || t.ended || rem === 0;
    $('ended').hidden = !t.ended;
    var sub = '';
    if (t.running) {
      var end = new Date(conn.now() + rem);
      sub = 'Ends ' + end.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      if (t.startedAt) sub += '  ·  Live for ' + SMP.fmtDur((conn.now() - t.startedAt) / 1000);
    } else if (!t.ended) sub = c.days > 0 ? c.days + ' day' + (c.days > 1 ? 's' : '') + ' on the clock' : 'Timer paused';
    $('timerSub').textContent = sub || ' ';
  }
  setInterval(function () { renderTimer(false); }, 250);

  function renderStats() {
    var st = S.stats || {}, s = S.settings;
    $('sSubs').textContent = SMP.num(st.subs);
    $('sBits').textContent = SMP.num(st.bits);
    $('sMoney').textContent = SMP.money(st.donations, s.currencySymbol);
    $('statMoney').style.display = s.donationsEnabled || st.donations > 0 ? '' : 'none';
    $('sTime').textContent = SMP.fmtDur(st.timeAdded || 0);
    var coins = Number(st.tiktokCoins) || 0;
    $('statCoins').style.display = coins > 0 ? '' : 'none';
    $('sCoins').textContent = SMP.num(coins);
  }

  function goalNums(g) {
    var cs = S.settings.currencySymbol;
    if (g.metric === 'donations') return SMP.money(g.current, cs) + ' / ' + SMP.money(g.target, cs);
    if (g.metric === 'time') return g.current + 'h / ' + g.target + 'h';
    var unit = g.metric === 'subs' ? ' subs' : g.metric === 'bits' ? ' bits' : '';
    return SMP.num(g.current) + ' / ' + SMP.num(g.target) + unit;
  }
  function renderGoals() {
    var box = $('goals');
    box.innerHTML = '';
    var goals = S.goals || [];
    if (!goals.length) { box.appendChild(h('div', { class: 'chat-empty', text: 'Goals will show up here' })); return; }
    var first = -1;
    goals.forEach(function (g, i) { var done = g.done || g.current >= g.target; if (!done && first < 0) first = i; });
    var start = first < 0 ? Math.max(0, goals.length - 5) : Math.max(0, first - 1);
    goals.slice(start, start + 5).forEach(function (g, j) {
      var done = g.done || (g.target > 0 && g.current >= g.target);
      var pct = g.target > 0 ? Math.min(100, (g.current / g.target) * 100) : (done ? 100 : 0);
      box.appendChild(h('div', { class: 'goal' + (done ? ' done' : '') + (start + j === first ? ' next' : '') }, [
        h('div', { class: 'goal-top' }, [h('div', { class: 'goal-title', text: g.title }), h('div', { class: 'goal-num', text: goalNums(g) })]),
        h('div', { class: 'progress' }, h('b', { style: { width: pct + '%' } })),
      ]));
    });
  }

  function feedRow(f) {
    var info = SMP.eventInfo(f, S.settings.currencySymbol);
    var tvs = S.settings.tv || {};
    return h('div', { class: 'feed-item k-' + info.kind }, [
      info.image ? h('div', { class: 'fi-ico has-img' }, h('img', { src: info.image, alt: '' })) : h('div', { class: 'fi-ico', html: info.icon }),
      h('div', { class: 'fi-body' }, [
        h('div', { class: 'fi-line' }, [h('b', { text: tvs.showNames === false ? 'Someone' : info.title }), ' ' + info.action]),
        f.message || (f.media && f.media.length) ? h('div', { class: 'fi-msg', text: (f.media && f.media.length ? '▶ ' + f.media.join(', ') + (f.message ? '  ·  ' : '') : '') + cleanMsg(f.message || '') }) : null,
      ]),
      f.added > 0 ? h('div', { class: 'fi-added', text: '+' + SMP.fmtDur(f.added) }) : null,
    ]);
  }
  function renderFeed() {
    var box = $('feed');
    box.innerHTML = '';
    var list = (S.feed || []).slice(0, 6);
    if (!list.length) box.appendChild(h('div', { class: 'chat-empty', text: 'Subs, bits and donations will appear here' }));
    list.forEach(function (f) { box.appendChild(feedRow(f)); });
  }
  function cleanMsg(m) { return m.replace(/(^|\s)[A-Za-z]+\d+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim(); }

  function pop(text) {
    var p = h('div', { class: 'pop', text: text });
    $('pops').appendChild(p);
    setTimeout(function () { if (p.parentNode) p.parentNode.removeChild(p); }, 2700);
  }

  // ------------------------------------------------------------ alerts
  // Each feed item carries fx: { effect, level } chosen by the server from the streamer's tiers.
  // Level 1..5 scales how long the alert stays and how big the effect is.
  var FX_EFFECTS = ['pop', 'slide', 'glow', 'confetti', 'fireworks', 'shockwave', 'coinrain', 'rainbow'];
  var FX_TIME = [1, 1.2, 1.5, 2, 2.5];
  var alertQueue = [], alertBusy = false, alertTimers = [], demoSecs = 0;
  function fxOf(f) {
    var fx = f && f.fx ? f.fx : {};
    var level = Math.max(1, Math.min(5, parseInt(fx.level, 10) || 1));
    var effect = FX_EFFECTS.indexOf(fx.effect) >= 0 ? fx.effect : 'pop';
    return { effect: effect, level: level };
  }
  function queueAlert(f) { alertQueue.push(f); if (!alertBusy) nextAlert(); }
  function later(fn, ms) { var t = setTimeout(fn, ms); alertTimers.push(t); return t; }
  function clearAlertTimers() { for (var i = 0; i < alertTimers.length; i++) clearTimeout(alertTimers[i]); alertTimers = []; }
  function nextAlert() {
    clearAlertTimers();
    var f = alertQueue.shift();
    var el = $('alert');
    if (!f) { alertBusy = false; el.hidden = true; return; }
    alertBusy = true;
    var info = SMP.eventInfo(f, S.settings.currencySymbol);
    var fx = fxOf(f);
    var cls = ' k-' + info.kind + ' fx-' + fx.effect + ' lvl-' + fx.level;
    el.className = 'alert' + cls;
    void el.offsetWidth; // restart the CSS animations for back-to-back alerts
    el.className = 'alert show' + cls;
    var icon = $('alertIcon');
    icon.innerHTML = '';
    if (info.image) {
      var gi = h('img', { class: 'gift-img', alt: '' });
      gi.onerror = function () { icon.className = 'alert-icon'; icon.innerHTML = info.icon; };
      gi.src = info.image;
      icon.appendChild(gi);
      icon.className = 'alert-icon has-img';
    } else { icon.innerHTML = info.icon; icon.className = 'alert-icon'; }
    $('alertUser').textContent = (S.settings.tv || {}).showNames === false ? 'Someone' : info.title;
    $('alertAction').textContent = info.action;
    $('alertMsg').textContent = cleanMsg(f.message || '');
    $('alertMsg').style.display = f.message ? '' : 'none';
    $('alertAdded').textContent = f.added > 0 ? '+' + SMP.fmtDur(f.added) : '';
    el.hidden = false;
    var secs = (Number((S.settings.tv || {}).alertSeconds) || 6) * FX_TIME[fx.level - 1];
    if (demoSecs) secs = demoSecs;
    if (alertQueue.length > 2) secs = Math.max(2.5, secs / 2);
    FX.run(fx, info, secs);
    later(function () {
      FX.stopSpawning();
      el.className = 'alert hide' + cls;
      later(nextAlert, 450);
    }, secs * 1000);
  }

  // ------------------------------------------------------------ effects (one canvas, stops when idle)
  var FX = (function () {
    var canvas = $('fx'), ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    var parts = [], running = false, W = 0, H = 0, spawners = [], MAX = 700;
    var RAINBOW = ['#ff004c', '#ff8a00', '#ffe600', '#2bff88', '#00c2ff', '#7a5cff', '#ff00d4'];
    var raf = window.requestAnimationFrame || window.webkitRequestAnimationFrame || function (cb) { return setTimeout(function () { cb(Date.now()); }, 16); };

    function resize() {
      W = window.innerWidth; H = window.innerHeight;
      if (canvas) { canvas.width = W; canvas.height = H; }
    }
    resize();
    window.addEventListener('resize', resize);

    function cssVar(n, d) {
      var v = getComputedStyle(document.documentElement).getPropertyValue(n);
      v = v ? v.replace(/\s/g, '') : '';
      return v || d;
    }
    function palette(kind, rainbow) {
      if (rainbow) return RAINBOW;
      var a = cssVar('--accent', '#a970ff'), b = cssVar('--accent2', '#00e5ff');
      var k = { bits: '#c77dff', gift: '#ff7ab6', money: '#3ddc97', sub: '#a970ff', tiktok: '#ff2d6f' }[kind] || a;
      return [a, b, k, '#ffffff', '#ffd93d'];
    }
    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function add(p) { if (parts.length < MAX) parts.push(p); }
    function start() { if (!running && ctx) { running = true; raf(frame); } }
    function scale() { return Math.max(0.6, W / 1920); }
    function alertBox() {
      var r = $('alert').getBoundingClientRect();
      if (!r.width) return { x: W / 2, y: H * 0.1, w: W * 0.4, h: H * 0.1 };
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    }

    // particle kinds: confetti, spark, star, coin, gem, rocket
    function confetti(x, y, vx, vy, cols, s) {
      add({ k: 'confetti', x: x, y: y, vx: vx, vy: vy, g: 0.32 * s, drag: 0.985, w: rnd(8, 14) * s, h: rnd(4, 8) * s, rot: rnd(0, 6.28), vr: rnd(-0.25, 0.25), tilt: rnd(0, 6.28), vt: rnd(0.08, 0.2), c: pick(cols), life: rnd(170, 250), age: 0 });
    }
    function spark(x, y, vx, vy, c, life, size, g) {
      add({ k: 'spark', x: x, y: y, vx: vx, vy: vy, g: g == null ? 0.06 : g, drag: 0.975, c: c, life: life, age: 0, r: size });
    }
    function star(x, y, c, size) {
      add({ k: 'star', x: x, y: y, vx: rnd(-0.4, 0.4), vy: rnd(-0.9, -0.2), g: 0, drag: 1, c: c, life: rnd(40, 80), age: 0, r: size, rot: rnd(0, 6.28) });
    }

    function burstConfetti(level, cols) {
      var n = Math.min(70 * level, 320), s = scale() * (0.9 + level * 0.06);
      for (var i = 0; i < n; i++) {
        var left = i % 2 === 0;
        var ang = left ? rnd(-1.35, -0.75) : rnd(-2.4, -1.8);
        var sp = rnd(13, 25) * scale() * (0.85 + level * 0.06);
        confetti(left ? rnd(-10, 40) : W - rnd(-10, 40), H + 10, Math.cos(ang) * sp, Math.sin(ang) * sp, cols, s);
      }
      start();
    }
    function rocket(level, cols, rainbow) {
      var x = rnd(W * 0.12, W * 0.88), ty = rnd(H * 0.12, H * 0.45), g = 0.18 * scale();
      add({ k: 'rocket', x: x, y: H + 10, vx: rnd(-1.5, 1.5), vy: -Math.sqrt(2 * g * (H + 10 - ty)), g: g, drag: 1, c: rainbow ? pick(RAINBOW) : pick(cols), life: 260, age: 0, level: level, rainbow: rainbow });
      start();
    }
    function explode(p) {
      var n = Math.min(40 + 18 * p.level, 140), sp = rnd(4, 7) * (0.8 + p.level * 0.12) * scale();
      for (var i = 0; i < n; i++) {
        var a = (i / n) * 6.283 + rnd(-0.05, 0.05), v = sp * rnd(0.55, 1);
        spark(p.x, p.y, Math.cos(a) * v, Math.sin(a) * v, p.rainbow ? RAINBOW[i % RAINBOW.length] : (Math.random() < 0.2 ? '#ffffff' : p.c), rnd(55, 85), rnd(1.8, 3) * scale(), 0.07 * scale());
      }
    }
    function coin(level, gem, cols) {
      var s = scale() * rnd(0.8, 1.25) * (0.9 + level * 0.08);
      add({ k: gem ? 'gem' : 'coin', x: rnd(0, W), y: rnd(-80, -20), vx: rnd(-0.6, 0.6), vy: rnd(2, 5) * scale(), g: 0.12 * scale(), drag: 0.995, r: 16 * s, spin: rnd(0, 6.28), vs: rnd(0.08, 0.2), c: gem ? pick(cols) : '#ffcf3f', life: 420, age: 0 });
      start();
    }
    function sparkleAround(box, level, cols) {
      var n = 2 + level;
      for (var i = 0; i < n; i++) {
        var x = box.x + rnd(-box.w / 2 - 20, box.w / 2 + 20), y = box.y + rnd(-box.h / 2 - 20, box.h / 2 + 20);
        if (Math.random() < 0.5) y = box.y + (Math.random() < 0.5 ? -1 : 1) * (box.h / 2 + rnd(0, 18));
        star(x, y, pick(cols), rnd(3, 6) * scale() * (0.9 + level * 0.12));
      }
      start();
    }
    function streak(box, level, cols) {
      var n = 14 + level * 10;
      for (var i = 0; i < n; i++) spark(box.x - box.w / 2 + rnd(0, box.w), box.y + rnd(-box.h / 2, box.h / 2), rnd(10, 22) * scale(), rnd(-0.5, 0.5), pick(cols), rnd(25, 45), rnd(1.5, 3) * scale(), 0);
      start();
    }
    function ring(box, delay, color, big) {
      later(function () {
        var r = h('div', { class: 'fx-ring' + (big ? ' big' : '') });
        r.style.left = box.x + 'px'; r.style.top = box.y + 'px';
        if (color) r.style.borderColor = color;
        $('fxRings').appendChild(r);
        setTimeout(function () { if (r.parentNode) r.parentNode.removeChild(r); }, 1700);
      }, delay);
    }
    function every(ms, times, fn) {
      var n = 0;
      var t = setInterval(function () {
        fn(n);
        if (++n >= times) {
          clearInterval(t);
          for (var i = 0; i < spawners.length; i++) if (spawners[i] === t) { spawners.splice(i, 1); break; }
        }
      }, ms);
      spawners.push(t);
      start();
    }
    function wave(level) {
      var w = $('fxWave');
      w.className = 'fx-wave';
      void w.offsetWidth;
      w.style.animationIterationCount = String(level >= 4 ? 2 : 1);
      w.className = 'fx-wave on';
    }
    function quake(level) {
      var st = $('stage');
      st.classList.remove('fx-quake');
      void st.offsetWidth;
      st.style.animationDuration = (0.5 + level * 0.08) + 's';
      st.classList.add('fx-quake');
      setTimeout(function () { st.classList.remove('fx-quake'); }, 1200);
    }

    function run(fx, info, secs) {
      if (!ctx) return;
      var L = fx.level, cols = palette(info.kind, fx.effect === 'rainbow');
      var ticks = function (ms) { return Math.max(1, Math.round((secs * 1000) / ms)); };
      // wait one frame so the alert box has its size
      later(function () {
        var box = alertBox();
        var i, j, a, v;
        switch (fx.effect) {
          case 'pop':
            if (L >= 2) sparkleAround(box, L, cols);
            if (L >= 3) every(260, L * 2, function () { sparkleAround(box, L, cols); });
            if (L >= 4) burstConfetti(L - 2, cols);
            break;
          case 'slide':
            streak(box, L, cols);
            if (L >= 3) later(function () { streak(box, L, cols); }, 600);
            if (L >= 4) burstConfetti(L - 2, cols);
            break;
          case 'glow':
            every(180, ticks(180), function () { sparkleAround(box, L, cols); });
            break;
          case 'confetti':
            burstConfetti(L, cols);
            if (L >= 3) later(function () { burstConfetti(L - 1, cols); }, 900);
            if (L >= 5) later(function () { burstConfetti(L - 1, cols); }, 1900);
            break;
          case 'fireworks':
            every(Math.max(220, 700 - L * 90), 2 + L * 2, function () { rocket(L, cols, false); });
            break;
          case 'shockwave':
            for (i = 0; i < 2 + L; i++) ring(box, i * 160, i % 2 ? cssVar('--accent2', '#00e5ff') : cssVar('--accent', '#a970ff'), L >= 4 && i === 0);
            quake(L);
            for (j = 0; j < 30 + L * 14; j++) {
              a = rnd(0, 6.283); v = rnd(6, 13) * (0.8 + L * 0.1) * scale();
              spark(box.x, box.y, Math.cos(a) * v, Math.sin(a) * v, pick(cols), rnd(30, 55), rnd(1.6, 3) * scale(), 0);
            }
            start();
            break;
          case 'coinrain':
            var gem = info.kind === 'bits';
            every(70, Math.min(30 * L, 140), function () { coin(L, gem, gem ? ['#c77dff', '#9d4edd', '#e0aaff', '#7b2cbf'] : cols); });
            break;
          case 'rainbow':
            wave(L);
            burstConfetti(Math.min(5, L + 1), RAINBOW);
            every(240, ticks(240), function () { sparkleAround(box, L, RAINBOW); });
            if (L >= 3) later(function () { burstConfetti(L, RAINBOW); }, 1200);
            if (L >= 4) every(Math.max(260, 650 - L * 80), 2 + L * 2, function () { rocket(L, RAINBOW, true); });
            break;
        }
        // the biggest moments get fireworks on top of whichever effect was picked
        if (L === 5 && fx.effect !== 'rainbow' && fx.effect !== 'fireworks') every(500, 4, function () { rocket(4, cols, false); });
      }, 60);
    }
    function stopSpawning() {
      for (var i = 0; i < spawners.length; i++) clearInterval(spawners[i]);
      spawners = [];
    }

    function drawStar(p, r) {
      ctx.beginPath();
      for (var i = 0; i < 8; i++) {
        var a = p.rot + i * 0.785, rr = i % 2 ? r * 0.35 : r;
        ctx.lineTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
    }
    function frame() {
      ctx.clearRect(0, 0, W, H);
      var next = [];
      var list = parts;
      parts = [];
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        p.age++;
        p.vx *= p.drag; p.vy = p.vy * p.drag + p.g;
        p.x += p.vx; p.y += p.vy;
        if (p.k === 'rocket') {
          if (p.vy >= -1 || p.age > p.life) { explode(p); continue; }
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1;
          ctx.fillStyle = p.c;
          ctx.beginPath(); ctx.arc(p.x, p.y, 3 * scale(), 0, 6.283); ctx.fill();
          if (p.age % 2 === 0) spark(p.x, p.y + 4, rnd(-0.6, 0.6), rnd(0.5, 1.5), '#ffd9a0', 22, 1.5 * scale(), 0.02);
          next.push(p);
          continue;
        }
        var lifeLeft = 1 - p.age / p.life;
        if (lifeLeft <= 0 || p.y > H + 60 || p.x < -80 || p.x > W + 80) continue;
        if (p.k === 'confetti') {
          p.rot += p.vr; p.tilt += p.vt;
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = Math.min(1, lifeLeft * 3);
          ctx.save();
          ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.tilt));
          ctx.fillStyle = p.c;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        } else if (p.k === 'spark') {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = Math.max(0, lifeLeft);
          ctx.fillStyle = p.c;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.4 + lifeLeft * 0.6), 0, 6.283); ctx.fill();
        } else if (p.k === 'star') {
          p.rot += 0.08;
          var tw = Math.sin(Math.PI * (p.age / p.life));
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = Math.max(0, tw);
          ctx.fillStyle = p.c;
          drawStar(p, p.r * (0.6 + 0.4 * tw));
        } else if (p.k === 'coin' || p.k === 'gem') {
          p.spin += p.vs;
          var sx = Math.cos(p.spin), ax = Math.abs(sx) < 0.12 ? 0.12 : Math.abs(sx);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = Math.min(1, lifeLeft * 4);
          ctx.save();
          ctx.translate(p.x, p.y); ctx.scale(ax, 1);
          if (p.k === 'coin') {
            ctx.fillStyle = '#c9931a'; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, 6.283); ctx.fill();
            ctx.fillStyle = sx > 0 ? '#ffcf3f' : '#f5b829'; ctx.beginPath(); ctx.arc(0, 0, p.r * 0.84, 0, 6.283); ctx.fill();
            ctx.fillStyle = 'rgba(255,245,200,.85)'; ctx.fillRect(-p.r * 0.12, -p.r * 0.45, p.r * 0.24, p.r * 0.9);
          } else {
            ctx.fillStyle = p.c;
            ctx.beginPath(); ctx.moveTo(0, -p.r); ctx.lineTo(p.r * 0.75, -p.r * 0.15); ctx.lineTo(0, p.r * 1.1); ctx.lineTo(-p.r * 0.75, -p.r * 0.15); ctx.closePath(); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,.45)';
            ctx.beginPath(); ctx.moveTo(0, -p.r); ctx.lineTo(p.r * 0.75, -p.r * 0.15); ctx.lineTo(0, p.r * 0.1); ctx.lineTo(-p.r * 0.75, -p.r * 0.15); ctx.closePath(); ctx.fill();
          }
          ctx.restore();
        }
        next.push(p);
      }
      // particles added during this frame (sparks from rockets and explosions) carry over
      parts = next.concat(parts);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (parts.length || spawners.length) raf(frame);
      else { running = false; ctx.clearRect(0, 0, W, H); }
    }
    return { run: run, stopSpawning: stopSpawning };
  })();

  // ?fxdemo=1 — cycles every effect at every level with fake alerts (for previews and screenshots)
  function startFxDemo() {
    var kinds = [
      { type: 'bits', user: 'SleepyPanda', amount: 1000, message: 'WAKE UP' },
      { type: 'sub', user: 'NightOwl', tier: 'tier1' },
      { type: 'giftbomb', user: 'xXGamerXx', amount: 10 },
      { type: 'donation', user: 'pixelpirate', amount: 25, message: 'stay strong!' },
      { type: 'tiktok', user: 'tiktokfan', amount: 5, gift: 'Rose', giftImage: '', coins: 5 },
    ];
    // ?fxdemo=rainbow&fxlevel=5 starts the cycle at that effect and level
    var startAt = FX_EFFECTS.indexOf(params.get('fxdemo'));
    var n = startAt >= 0 ? startAt * 5 + Math.max(0, Math.min(4, (parseInt(params.get('fxlevel'), 10) || 1) - 1)) : 0;
    demoSecs = 3.6;
    function one() {
      var e = FX_EFFECTS[Math.floor(n / 5) % FX_EFFECTS.length], lvl = (n % 5) + 1;
      var base = kinds[n % kinds.length], f = {};
      for (var k in base) if (base.hasOwnProperty(k)) f[k] = base[k];
      f.id = 'demo' + n; f.ts = Date.now(); f.added = 300 * lvl; f.fx = { effect: e, level: lvl };
      f.message = (f.message ? f.message + ' · ' : '') + e + ' L' + lvl;
      queueAlert(f);
      n++;
    }
    one();
    setInterval(function () { if (alertQueue.length < 1) one(); }, 4200);
  }
  if (params.has('fxdemo')) setTimeout(startFxDemo, 800);

  // ------------------------------------------------------------ chat
  var BADGE = { broadcaster: 'HOST', moderator: 'MOD', vip: 'VIP', subscriber: 'SUB' };
  var PALETTE = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#c77dff', '#ff9f1c', '#00e5ff', '#ff7ab6'];
  function nameColor(c, user) {
    if (!c) { var x = 0; for (var i = 0; i < user.length; i++) x = (x * 31 + user.charCodeAt(i)) >>> 0; return PALETTE[x % PALETTE.length]; }
    var n = parseInt(c.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum < 110) { var k = (110 - lum) / 255 + 0.35; r = Math.round(r + (255 - r) * k); g = Math.round(g + (255 - g) * k); b = Math.round(b + (255 - b) * k); }
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function chatRow(c) {
    var row = h('div', { class: 'msg' + (c.action ? ' action' : ''), 'data-id': c.id || '', 'data-user': (c.user || '').toLowerCase() });
    (c.badges || '').split(',').forEach(function (b) {
      var k = b.split('/')[0];
      if (BADGE[k]) row.appendChild(h('span', { class: 'badge b-' + k, text: BADGE[k] }));
    });
    row.appendChild(h('span', { class: 'name', style: { color: nameColor(c.color, c.user || '') }, text: c.user }));
    row.appendChild(document.createTextNode(c.action ? ' ' : ': '));
    var t = h('span', { class: 'text' });
    t.appendChild(SMP.chatFragment(c.text || '', c.emotes));
    row.appendChild(t);
    return row;
  }
  function renderChatAll(list) {
    var box = $('chat');
    box.innerHTML = '';
    if (!list.length) box.appendChild(h('div', { class: 'chat-empty', id: 'chatEmpty', text: S.settings.channel ? 'Waiting for chat…' : 'Set your Twitch username in the dashboard' }));
    list.forEach(function (c) { box.appendChild(chatRow(c)); });
  }
  function addChat(c) {
    var box = $('chat');
    var empty = $('chatEmpty'); if (empty) empty.parentNode.removeChild(empty);
    box.appendChild(chatRow(c));
    while (box.children.length > 40) box.removeChild(box.firstChild);
  }
  function clearChat(m) {
    var rows = $('chat').querySelectorAll('.msg');
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if ((m.id && r.getAttribute('data-id') === m.id) || (m.user && r.getAttribute('data-user') === m.user.toLowerCase()) || (!m.id && !m.user)) r.parentNode.removeChild(r);
    }
  }

  // ------------------------------------------------------------ media
  var mediaQueue = [], current = null, cleanupFns = [];
  function enqueueMedia(m) {
    mediaQueue.push(m);
    if (!current) nextMedia(); else updateQueueLabel();
  }
  function updateQueueLabel() {
    $('mediaQueue').textContent = mediaQueue.length ? mediaQueue.length + ' more in queue' : '';
    conn.send({ t: 'nowPlaying', item: current ? { name: current.item.name, by: current.by } : null, queue: mediaQueue.length });
  }
  function cleanup() {
    cleanupFns.forEach(function (f) { try { f(); } catch (e) {} });
    cleanupFns = [];
    $('mediaBox').innerHTML = '';
    $('mediaBox').className = 'media-box';
    $('stage').classList.remove('shake');
    $('flash').className = 'flash';
  }
  function nextMedia() {
    cleanup();
    current = mediaQueue.shift() || null;
    if (!current) { $('media').hidden = true; updateQueueLabel(); return; }
    var it = current.item;
    var vol = Math.max(0, Math.min(1, ((it.volume != null ? it.volume : 100) / 100) * (((S.settings.tv || {}).volume != null ? S.settings.tv.volume : 100) / 100)));
    $('media').hidden = false;
    $('mediaName').textContent = it.name;
    var by = $('mediaBy');
    by.innerHTML = '';
    if (current.by) { by.appendChild(h('b', { text: (S.settings.tv || {}).showNames === false ? 'Someone' : current.by })); by.appendChild(document.createTextNode(current.reason ? ' · ' + current.reason : '')); }
    else by.textContent = current.reason || '';
    updateQueueLabel();

    var box = $('mediaBox');
    var done = function () { nextMedia(); };
    var limit = Number(it.maxSeconds) > 0 ? Number(it.maxSeconds) : 600;
    var tmr = setTimeout(done, limit * 1000);
    cleanupFns.push(function () { clearTimeout(tmr); });

    if (it.type === 'audio') {
      var a = new Audio(it.url);
      a.volume = vol;
      a.onended = done; a.onerror = done;
      box.appendChild(h('div', { class: 'audio-card' }, [h('div', { class: 'ring' }), h('div', { class: 'ring r2' }), h('div', { class: 'ring r3' }),
        h('div', { class: 'bars' }, [h('i'), h('i'), h('i'), h('i'), h('i'), h('i'), h('i')])]));
      playSafe(a);
      cleanupFns.push(function () { a.onended = null; a.onerror = null; a.pause(); a.src = ''; });
    } else if (it.type === 'video') {
      var v = h('video', { playsinline: true, preload: 'auto' });
      v.src = it.url; v.volume = vol;
      v.onended = done; v.onerror = done;
      v.onloadedmetadata = function () { if (v.videoWidth / v.videoHeight > 1.6 && v.videoWidth >= 1280) v.className = 'full'; };
      box.appendChild(v);
      playSafe(v);
      cleanupFns.push(function () { v.onended = null; v.onerror = null; v.pause(); v.removeAttribute('src'); v.load(); });
    } else {
      var img = h('img', { alt: '' });
      img.onerror = done;
      img.src = it.url;
      box.appendChild(img);
      clearTimeout(tmr);
      tmr = setTimeout(done, (Number(it.duration) || 6) * 1000);
    }
    if (it.effect === 'flash' || it.effect === 'both') { var fl = $('flash'); fl.className = 'flash'; void fl.offsetWidth; fl.className = 'flash on'; }
    if (it.effect === 'shake' || it.effect === 'both') {
      box.className = 'media-box shake'; $('stage').classList.add('shake');
      var st = setTimeout(function () { box.className = 'media-box'; $('stage').classList.remove('shake'); }, 2500);
      cleanupFns.push(function () { clearTimeout(st); });
    }
  }
  function playSafe(el) {
    var p = el.play();
    if (p && p.catch) p.catch(function () {
      // Autoplay blocked: ask for one button press, then retry.
      showUnlock(function () { el.play().catch(function () { nextMedia(); }); });
    });
  }

  // ------------------------------------------------------------ unlock / keep awake
  var afterUnlock = null;
  function showUnlock(cb) {
    afterUnlock = cb || null;
    $('unlock').hidden = false;
    $('unlockBtn').focus();
  }
  function doUnlock() {
    unlocked = true;
    $('unlock').hidden = true;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) { audioCtx = audioCtx || new Ctx(); audioCtx.resume && audioCtx.resume(); }
    } catch (e) {}
    var fs = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
    if (fs && !autoStart) { try { var r = fs.call(document.documentElement); if (r && r.catch) r.catch(function () {}); } catch (e) {} }
    keepAwake();
    if (afterUnlock) { var cb = afterUnlock; afterUnlock = null; cb(); }
  }
  $('unlockBtn').addEventListener('click', doUnlock);
  document.addEventListener('keydown', function (e) {
    if (!$('unlock').hidden && (e.key === 'Enter' || e.keyCode === 13 || e.key === ' ')) { e.preventDefault(); doUnlock(); }
  });
  if (autoStart) doUnlock(); else $('unlockBtn').focus();

  var wakeLock = null;
  function keepAwake() {
    if (navigator.wakeLock && navigator.wakeLock.request) {
      navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () {});
    }
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && unlocked) keepAwake(); });

  function testSound() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = audioCtx || new Ctx();
      var t0 = audioCtx.currentTime;
      [659.25, 830.61, 987.77, 1318.5].forEach(function (f, i) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + i * 0.12);
        g.gain.exponentialRampToValueAtTime(0.35, t0 + i * 0.12 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.12 + 0.5);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t0 + i * 0.12); o.stop(t0 + i * 0.12 + 0.55);
      });
      pop('🔊 Sound OK');
    } catch (e) {}
    if (!unlocked) showUnlock();
  }
})();
