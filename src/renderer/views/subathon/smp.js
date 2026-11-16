// Subathon helpers for the in-app dashboard, ported from the standalone app's common.js.
import { steezInfo } from '../../lib/bot.js';

export const icons = {
  sub: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.5L12 17.3 6.1 20.5l1.3-6.5L2.5 9.4l6.6-.8z"/></svg>',
  gift: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 7h-2.2A3 3 0 0 0 12 3.8 3 3 0 0 0 6.2 7H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h7V7h2v5h7a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1zM9 7a1 1 0 1 1 1-1v1H9zm6 0h-1V6a1 1 0 1 1 1 1zM4 13v7a1 1 0 0 0 1 1h6v-8H4zm9 8h6a1 1 0 0 0 1-1v-7h-7v8z"/></svg>',
  bits: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l7 9-7 11-7-11z" opacity=".55"/><path d="M12 2l7 9-7 4-7-4z"/></svg>',
  money: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.4l-1.4-1.3C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1A6 6 0 0 1 16.5 3C19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.6 11.6z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="14" height="14"/><path d="M16 10l6-3v10l-6-3z"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>',
  goal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 3c.4 2.1 1.7 3.6 3.9 3.9v3.2a7.4 7.4 0 0 1-3.9-1.2v6.3a6.1 6.1 0 1 1-6.1-6.1c.3 0 .6 0 .9.1v3.3a2.9 2.9 0 1 0 2 2.7V3z"/></svg>',
};

/** An SVG icon element from the trusted icon strings above. */
export function icon(name, cls = 'smp-ico') {
  const s = document.createElement('span');
  s.className = cls;
  s.innerHTML = icons[name] || '';
  return s;
}

const pad = (n) => (n < 10 ? '0' + n : '' + n);

export function fmtClock(ms) {
  let s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const hh = d > 0 ? h + d * 24 : h;
  return { text: pad(hh) + ':' + pad(m) + ':' + pad(s), days: d, hours: hh, minutes: m, seconds: s };
}

export function fmtDur(secs) {
  secs = Math.round(Math.abs(secs));
  if (secs < 60) return secs + 's';
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  if (h) return h + 'h' + (m ? ' ' + m + 'm' : '');
  return m + 'm' + (s ? ' ' + s + 's' : '');
}

export function money(n, cs) {
  n = Number(n) || 0;
  return (cs || '$') + (Math.round(n) === n ? n.toFixed(0) : n.toFixed(2));
}

export const num = (n) => (Number(n) || 0).toLocaleString();

export const tierName = (t) => ({ prime: 'Prime', tier1: 'Tier 1', tier2: 'Tier 2', tier3: 'Tier 3' })[t] || 'Tier 1';

export function eventInfo(f, cs) {
  const who = f.user || 'Someone';
  switch (f.type) {
    case 'bits': return { kind: 'bits', icon: 'bits', title: who, action: 'cheered ' + num(f.amount) + ' bits' };
    case 'donation': return { kind: 'money', icon: 'money', title: who, action: 'donated ' + money(f.amount, cs) };
    case 'giftbomb': return { kind: 'gift', icon: 'gift', title: who, action: 'gifted ' + f.amount + ' sub' + (f.amount === 1 ? '' : 's') + '!' };
    case 'gift': return { kind: 'gift', icon: 'gift', title: who, action: 'gifted a sub' + (f.recipient ? ' to ' + f.recipient : '') };
    case 'resub': return { kind: 'sub', icon: 'sub', title: who, action: 'resubscribed' + (f.months ? ' · ' + f.months + ' months' : '') };
    case 'tiktok': return { kind: 'tiktok', icon: 'tiktok', title: who, action: 'sent ' + (f.amount > 1 ? f.amount + '× ' : 'a ') + (f.gift || 'gift') + (f.coins ? ' · ' + num(f.coins) + ' coins' : '') };
    default: return { kind: 'sub', icon: 'sub', title: who, action: 'subscribed' + (f.tier === 'prime' ? ' with Prime' : f.tier && f.tier !== 'tier1' ? ' at ' + tierName(f.tier) : '') };
  }
}

export function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

/** Twitch chat text + emote ranges ("25:0-4,6-10/1902:12-16") → DOM fragment (text nodes + emote images). */
export function chatFragment(text, emotes) {
  const frag = document.createDocumentFragment();
  const chars = Array.from(text || '');
  const ranges = [];
  if (emotes) {
    for (const part of String(emotes).split('/')) {
      const p = part.split(':');
      if (p.length < 2) continue;
      for (const r of p[1].split(',')) {
        const ab = r.split('-');
        ranges.push({ id: p[0], a: parseInt(ab[0], 10), b: parseInt(ab[1], 10) });
      }
    }
  }
  ranges.sort((x, y) => x.a - y.a);
  let pos = 0;
  for (const r of ranges) {
    if (r.a < pos || isNaN(r.a)) continue;
    if (r.a > pos) frag.appendChild(document.createTextNode(chars.slice(pos, r.a).join('')));
    const img = document.createElement('img');
    img.className = 'emote';
    img.alt = chars.slice(r.a, r.b + 1).join('');
    img.src = 'https://static-cdn.jtvnw.net/emoticons/v2/' + encodeURIComponent(r.id) + '/default/dark/2.0';
    frag.appendChild(img);
    pos = r.b + 1;
  }
  if (pos < chars.length) frag.appendChild(document.createTextNode(chars.slice(pos).join('')));
  return frag;
}

/**
 * Live admin connection to /subathon/ws with automatic reconnect and server clock offset.
 * Returns { now(), send(obj), close() }.
 */
export function connect(onMessage, onState) {
  const api = { offset: 0, ws: null, closed: false };
  let retry = 0;
  let pingTimer = null;
  let retryTimer = null;
  const go = async () => {
    if (api.closed) return;
    const { apiKey } = await steezInfo();
    if (api.closed) return;
    const ws = new WebSocket(`ws://${location.host}/subathon/ws?role=admin&key=${encodeURIComponent(apiKey)}`);
    api.ws = ws;
    ws.onopen = () => {
      retry = 0;
      onState?.(true);
      clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        try {
          ws.send(JSON.stringify({ t: 'ping' }));
        } catch {
          /* closed */
        }
      }, 20000);
      try {
        ws.send(JSON.stringify({ t: 'ping' }));
      } catch {
        /* closed */
      }
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      const sn = m.serverNow || m.timer?.serverNow || m.state?.timer?.serverNow;
      if (sn) api.offset = sn - Date.now();
      onMessage(m);
    };
    ws.onclose = () => {
      clearInterval(pingTimer);
      onState?.(false);
      if (api.closed) return;
      const d = Math.min(15000, 800 * Math.pow(1.7, retry++));
      retryTimer = setTimeout(go, d);
    };
  };
  api.now = () => Date.now() + api.offset;
  api.send = (o) => {
    if (api.ws && api.ws.readyState === 1) api.ws.send(JSON.stringify(o));
  };
  api.close = () => {
    api.closed = true;
    clearInterval(pingTimer);
    clearTimeout(retryTimer);
    try {
      api.ws?.close();
    } catch {
      /* ignore */
    }
  };
  go();
  return api;
}

export function remaining(timer, conn) {
  if (!timer) return 0;
  if (timer.running) return Math.max(0, timer.endsAt - (conn ? conn.now() : Date.now()));
  return Math.max(0, timer.remaining);
}
