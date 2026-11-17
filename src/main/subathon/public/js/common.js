/* Shared helpers. Written in conservative JS so it also runs on older Samsung TV browsers. */
(function () {
  var SMP = {};

  SMP.icons = {
    sub: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.5L12 17.3 6.1 20.5l1.3-6.5L2.5 9.4l6.6-.8z"/></svg>',
    gift: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 7h-2.2A3 3 0 0 0 12 3.8 3 3 0 0 0 6.2 7H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h7V7h2v5h7a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1zM9 7a1 1 0 1 1 1-1v1H9zm6 0h-1V6a1 1 0 1 1 1 1zM4 13v7a1 1 0 0 0 1 1h6v-8H4zm9 8h6a1 1 0 0 0 1-1v-7h-7v8z"/></svg>',
    bits: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l7 9-7 11-7-11z" opacity=".55"/><path d="M12 2l7 9-7 4-7-4z"/></svg>',
    money: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.4l-1.4-1.3C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1A6 6 0 0 1 16.5 3C19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.6 11.6z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="14" height="14" rx="2"/><path d="M16 10l6-3v10l-6-3z"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>',
    goal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 2h-3.4v13.4a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9.1a6.4 6.4 0 1 0 5.4 6.3V8.6a8.1 8.1 0 0 0 4.7 1.5V6.7a4.8 4.8 0 0 1-4.7-4.7z"/></svg>',
  };

  SMP.pad = function (n) { return n < 10 ? '0' + n : '' + n; };

  SMP.fmtClock = function (ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    var hh = d > 0 ? h + d * 24 : h;
    var text = (d > 0 ? d + 'd ' : '') + SMP.pad(h) + ':' + SMP.pad(m) + ':' + SMP.pad(s);
    return { text: text, days: d, hours: hh, minutes: m, seconds: s };
  };

  // "2d 4h", "1:12:00:00" (days:hours:minutes:seconds), "36h", "90m", "12:00:00"
  SMP.parseDuration = function (v) {
    v = String(v || '').trim().toLowerCase();
    if (!v) return null;
    if (/^[\d.\s]*[a-z]/.test(v)) {
      var total = 0, hit = false, re = /(\d+(?:\.\d+)?)\s*(d|h|m|s)[a-z]*/g, mt, rest = v;
      while ((mt = re.exec(v))) {
        hit = true;
        total += parseFloat(mt[1]) * { d: 86400, h: 3600, m: 60, s: 1 }[mt[2]];
        rest = rest.replace(mt[0], '');
      }
      return hit && !rest.trim() ? Math.round(total) : null;
    }
    var parts = v.split(':').map(Number);
    if (parts.length > 4 || parts.some(function (n) { return isNaN(n); })) return null;
    while (parts.length < 4) parts.unshift(0);
    return parts[0] * 86400 + parts[1] * 3600 + parts[2] * 60 + parts[3];
  };
  SMP.fmtHours = function (hours) {
    var d = Math.floor(hours / 24), h = Math.round((hours - d * 24) * 100) / 100;
    return d ? d + (d === 1 ? ' day' : ' days') + (h ? ' ' + h + 'h' : '') : h + ' hours';
  };

  SMP.fmtDur = function (secs) {
    secs = Math.round(Math.abs(secs));
    if (secs < 60) return secs + 's';
    var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    if (h) return h + 'h' + (m ? ' ' + m + 'm' : '');
    return m + 'm' + (s ? ' ' + s + 's' : '');
  };

  SMP.money = function (n, cs) {
    n = Number(n) || 0;
    return (cs || '$') + (Math.round(n) === n ? n.toFixed(0) : n.toFixed(2));
  };

  SMP.num = function (n) {
    n = Number(n) || 0;
    return n.toLocaleString ? n.toLocaleString() : String(n);
  };

  SMP.tierName = function (t) {
    return { prime: 'Prime', tier1: 'Tier 1', tier2: 'Tier 2', tier3: 'Tier 3' }[t] || 'Tier 1';
  };

  SMP.eventInfo = function (f, cs) {
    var who = f.user || 'Someone';
    switch (f.type) {
      case 'bits': return { kind: 'bits', icon: SMP.icons.bits, title: who, action: 'cheered ' + SMP.num(f.amount) + ' bits', short: SMP.num(f.amount) + ' bits' };
      case 'donation': return { kind: 'money', icon: SMP.icons.money, title: who, action: 'donated ' + SMP.money(f.amount, cs), short: SMP.money(f.amount, cs) };
      case 'giftbomb': return { kind: 'gift', icon: SMP.icons.gift, title: who, action: 'gifted ' + f.amount + ' sub' + (f.amount === 1 ? '' : 's') + '!', short: f.amount + ' gifts' };
      case 'gift': return { kind: 'gift', icon: SMP.icons.gift, title: who, action: 'gifted a sub' + (f.recipient ? ' to ' + f.recipient : ''), short: 'Gift sub' };
      case 'tiktok': {
        var n = Number(f.amount) || 1, g = f.gift || 'gift';
        return { kind: 'tiktok', icon: SMP.icons.tiktok, image: f.giftImage || '', title: who, action: n > 1 ? 'sent ' + n + '× ' + g : 'sent ' + (/^[aeiou]/i.test(g) ? 'an ' : 'a ') + g, short: (n > 1 ? n + '× ' : '') + g };
      }
      case 'resub': return { kind: 'sub', icon: SMP.icons.sub, title: who, action: 'resubscribed' + (f.months ? ' · ' + f.months + ' months' : ''), short: SMP.tierName(f.tier) };
      default: return { kind: 'sub', icon: SMP.icons.sub, title: who, action: 'subscribed' + (f.tier === 'prime' ? ' with Prime' : f.tier && f.tier !== 'tier1' ? ' at ' + SMP.tierName(f.tier) : ''), short: SMP.tierName(f.tier) };
    }
  };

  SMP.timeAgo = function (ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  };

  SMP.h = function (tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (!attrs.hasOwnProperty(k) || attrs[k] == null || attrs[k] === false) continue;
      if (k === 'class') el.className = attrs[k];
      else if (k === 'html') el.innerHTML = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') el.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'style' && typeof attrs[k] === 'object') for (var s in attrs[k]) el.style.setProperty(s, attrs[k][s]);
      else el.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    if (children != null) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) {
        if (c == null || c === false) return;
        el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
      });
    }
    return el;
  };

  // Twitch chat text + emote ranges ("25:0-4,6-10/1902:12-16") -> DOM fragment
  SMP.chatFragment = function (text, emotes) {
    var frag = document.createDocumentFragment();
    var chars = Array.from ? Array.from(text) : text.split('');
    var ranges = [];
    if (emotes) emotes.split('/').forEach(function (part) {
      var p = part.split(':');
      if (p.length < 2) return;
      p[1].split(',').forEach(function (r) {
        var ab = r.split('-');
        ranges.push({ id: p[0], a: parseInt(ab[0], 10), b: parseInt(ab[1], 10) });
      });
    });
    ranges.sort(function (x, y) { return x.a - y.a; });
    var pos = 0;
    ranges.forEach(function (r) {
      if (r.a < pos || isNaN(r.a)) return;
      if (r.a > pos) frag.appendChild(document.createTextNode(chars.slice(pos, r.a).join('')));
      var img = document.createElement('img');
      img.className = 'emote';
      img.alt = chars.slice(r.a, r.b + 1).join('');
      img.src = 'https://static-cdn.jtvnw.net/emoticons/v2/' + encodeURIComponent(r.id) + '/default/dark/2.0';
      frag.appendChild(img);
      pos = r.b + 1;
    });
    if (pos < chars.length) frag.appendChild(document.createTextNode(chars.slice(pos).join('')));
    return frag;
  };

  SMP.applyTheme = function (s) {
    if (!s) return;
    var r = document.documentElement.style;
    function rgb(hex) {
      var n = parseInt(hex.slice(1), 16);
      return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
    }
    if (s.accent) { r.setProperty('--accent', s.accent); r.setProperty('--accent-rgb', rgb(s.accent)); }
    if (s.accent2) { r.setProperty('--accent2', s.accent2); r.setProperty('--accent2-rgb', rgb(s.accent2)); }
  };

  SMP.toast = function (msg, isErr) {
    var wrap = document.querySelector('.toast-wrap');
    if (!wrap) { wrap = SMP.h('div', { class: 'toast-wrap' }); document.body.appendChild(wrap); }
    var t = SMP.h('div', { class: 'toast' + (isErr ? ' err' : ''), text: msg });
    wrap.appendChild(t);
    setTimeout(function () { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; }, 2600);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3000);
  };

  // Live connection with automatic reconnect + server clock offset
  SMP.connect = function (role, extra, onMessage, onState) {
    var api = { offset: 0, ws: null, open: false };
    var retry = 0, pingTimer = null;
    function url() {
      var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      return proto + location.host + '/ws?role=' + role + (extra || '');
    }
    function go() {
      var ws = new WebSocket(url());
      api.ws = ws;
      ws.onopen = function () {
        retry = 0; api.open = true; onState && onState(true);
        clearInterval(pingTimer);
        pingTimer = setInterval(function () { try { ws.send(JSON.stringify({ t: 'ping' })); } catch (e) {} }, 20000);
      };
      ws.onmessage = function (e) {
        var m; try { m = JSON.parse(e.data); } catch (err) { return; }
        var sn = m.serverNow || (m.timer && m.timer.serverNow) || (m.state && m.state.timer && m.state.timer.serverNow);
        if (sn) api.offset = sn - Date.now();
        onMessage(m);
      };
      ws.onclose = function () {
        api.open = false; onState && onState(false);
        clearInterval(pingTimer);
        var d = Math.min(15000, 800 * Math.pow(1.7, retry++));
        setTimeout(go, d);
      };
    }
    api.send = function (o) { if (api.ws && api.ws.readyState === 1) api.ws.send(JSON.stringify(o)); };
    api.now = function () { return Date.now() + api.offset; };
    go();
    return api;
  };

  SMP.remaining = function (timer, conn) {
    if (!timer) return 0;
    if (timer.running) return Math.max(0, timer.endsAt - conn.now());
    return Math.max(0, timer.remaining);
  };

  window.SMP = SMP;
})();
