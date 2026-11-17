// Turns data from StreamElements and Streamlabs into Steez's own shapes, and writes it into the
// chat bot's database. No Electron here, so it can be tested on its own (see test/accounts.test.js).

export const SE_API = 'https://api.streamelements.com/kappa/v2';

const LOGIN_RE = /^[a-z0-9_]{1,25}$/;
export const normLogin = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const cleanName = (s) =>
  normLogin(s)
    .replace(/^[!]/, '')
    .replace(/\s+/g, '');

// ─── Permission levels ───────────────────────────────────────────────

/** StreamElements access levels: 100 everyone, 250 sub, 300 regular, 400 VIP, 500 mod, 1000 super mod, 1500 broadcaster. */
export function seLevel(n) {
  n = num(n);
  if (n >= 1500) return 'broadcaster';
  if (n >= 500) return 'moderator';
  if (n >= 400) return 'vip';
  if (n >= 300) return 'regular';
  if (n >= 250) return 'subscriber';
  return 'everyone';
}

/** Streamlabs permissions come as words ("Moderator", "Streamer", "Subscriber"...) or numbers. */
export function slLevel(v) {
  if (typeof v === 'number') return seLevel(v);
  const s = str(v).toLowerCase();
  if (/streamer|broadcaster|owner|editor/.test(s)) return 'broadcaster';
  if (/mod/.test(s)) return 'moderator';
  if (/vip/.test(s)) return 'vip';
  if (/sub/.test(s)) return 'subscriber';
  if (/regular/.test(s)) return 'regular';
  return 'everyone';
}

// ─── Command variables ───────────────────────────────────────────────
// Steez already understands StreamElements' ${...} variables; only a few names differ.

export function convertSE(text) {
  return str(text)
    .replace(/\$\{customapi\.(\S+?)\}/gi, (_, url) => '${customapi ' + url + '}')
    .replace(/\$\{urlfetch\.(\S+?)\}/gi, (_, url) => '${customapi ' + url + '}')
    .replace(/\$\{pointsname\}/gi, '${currency}')
    .replace(/\$\{queryescape\s/gi, '${urlencode ')
    .replace(/\$\{pathescape\s/gi, '${urlencode ')
    .replace(/\$\{channel\.viewers\}/gi, '${viewers}')
    .replace(/\$\{(?:channel\.display_name|channel\.name)\}/gi, '${channel}')
    .replace(/\$\{(?:sender\.points|user\.points)\}/gi, '${points}')
    .replace(/\$\{(?:sender\.time_online|user\.time_online)\}/gi, '${watchtime}')
    .replace(/\$\{channel\.subs\}/gi, '${subcount}')
    .replace(/\$\{channel\.followers\}/gi, '${followers}')
    .replace(/\$\{(?:touser\.name|user\.name|sender\.name)\}/gi, (m) => (m.toLowerCase().startsWith('${touser') ? '${touser}' : '${user}'));
}

// Streamlabs Cloudbot uses {var}; the older Streamlabs Chatbot desktop app uses $var and $var(args).
const SL_SIMPLE = {
  user: 'user',
  'user.name': 'user',
  username: 'user',
  sender: 'user',
  touser: 'touser',
  'touser.name': 'touser',
  target: 'touser',
  'target.name': 'touser',
  uptime: 'uptime',
  game: 'game',
  title: 'title',
  channel: 'channel',
  'channel.name': 'channel',
  viewers: 'viewers',
  count: 'count',
  points: 'points',
  'user.points': 'points',
  'points.name': 'currency',
  'currency.name': 'currency',
  currency: 'currency',
  currencyname: 'currency',
  followage: 'followage',
  'user.followage': 'followage',
  watchtime: 'watchtime',
  'user.time_watched': 'watchtime',
  'user.watchtime': 'watchtime',
  msg: 'args',
  message: 'args',
  args: 'args',
  query: 'args',
  rank: 'rank',
  'user.rank': 'rank',
  randuser: 'random.chatter',
  'random.user': 'random.chatter',
  'random.chatter': 'random.chatter',
};

export function convertSL(text) {
  let s = str(text);
  // Cloudbot {readapi.URL} / {random.1-10} / {args.1} / {1}
  s = s.replace(/\{readapi\.(\S+?)\}/gi, (_, url) => '${customapi ' + url + '}');
  s = s.replace(/\{random\.(-?\d+)-(-?\d+)\}/gi, (_, a, b) => '${random.' + a + '-' + b + '}');
  s = s.replace(/\{(?:args\.|arg)?(\d)\}/gi, (_, n) => '${' + n + '}');
  s = s.replace(/\{([a-z][a-z._]*)\}/gi, (m, name) => {
    const to = SL_SIMPLE[name.toLowerCase()];
    return to ? '${' + to + '}' : m;
  });
  // Chatbot desktop: $readapi(url), $randnum(1,10), $param1, $user, $touser ...
  s = s.replace(/\$readapi\(([^)]+)\)/gi, (_, url) => '${customapi ' + url.trim() + '}');
  s = s.replace(/\$randnum\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/gi, (_, a, b) => '${random.' + a + '-' + b + '}');
  s = s.replace(/\$(?:param|arg)(\d)/gi, (_, n) => '${' + n + '}');
  s = s.replace(/\$(?!\{|\()([a-z][a-z]*)\b/gi, (m, name) => {
    const to = SL_SIMPLE[name.toLowerCase()];
    return to ? '${' + to + '}' : m;
  });
  return s;
}

// ─── A common shape for everything we bring in ──────────────────────

export function emptyBundle(source) {
  return { source, channel: '', loyalty: null, users: [], commands: [], timers: [], quotes: [], counters: {}, notes: [] };
}

function addUser(map, name, points, minutes) {
  const login = normLogin(name);
  if (!LOGIN_RE.test(login)) return;
  const u = map.get(login) || { login, display: str(name).replace(/^@/, '').trim() || login, points: 0, minutes: 0 };
  if (points != null) u.points = Math.max(u.points, Math.round(num(points)));
  if (minutes != null) u.minutes = Math.max(u.minutes, Math.round(num(minutes)));
  map.set(login, u);
}

/**
 * StreamElements → bundle. Every part is optional (some need a login, the rest are public).
 * raw: { channel, loyalty, points: [{username, points}], watchtime: [{username, minutes}],
 *        commands, timers, quotes, counters: [{id|counter, count|value}] }
 */
export function fromStreamElements(raw = {}) {
  const b = emptyBundle('streamelements');
  b.channel = str(raw.channel);
  const L = raw.loyalty?.loyalty || raw.loyalty;
  if (L && typeof L === 'object') {
    b.loyalty = {
      currencyName: str(L.name) || null,
      pointsPerInterval: L.amount != null ? num(L.amount) : null,
      intervalMinutes: L.interval != null ? Math.max(1, num(L.interval)) : null,
      subscriberMultiplier: L.subscriberMultiplier != null ? num(L.subscriberMultiplier) : null,
      followBonus: L.bonuses?.follow != null ? num(L.bonuses.follow) : null,
      subBonus: L.bonuses?.subscriber != null ? num(L.bonuses.subscriber) : null,
      raidBonus: L.bonuses?.raid ?? L.bonuses?.host ?? null,
      ignored: Array.isArray(L.ignored) ? L.ignored.map(normLogin).filter(Boolean) : [],
    };
  }
  const users = new Map();
  for (const p of raw.points || []) addUser(users, p.username, p.points, null);
  for (const w of raw.watchtime || []) addUser(users, w.username, null, w.minutes);
  b.users = [...users.values()];

  for (const c of raw.commands || []) {
    const name = cleanName(c.command);
    if (!name || !str(c.reply).trim()) continue;
    b.commands.push({
      name,
      response: convertSE(c.reply),
      aliases: (c.aliases || []).map(cleanName).filter((a) => a && a !== name),
      level: seLevel(c.accessLevel),
      cooldown: num(c.cooldown?.global),
      userCooldown: num(c.cooldown?.user),
      cost: num(c.cost),
      enabled: c.enabled !== false,
      hidden: !!c.hidden,
      replyType: c.type === 'reply' ? 'reply' : undefined,
    });
  }
  for (const t of raw.timers || []) {
    const messages = (t.messages || []).map(convertSE).filter((m) => m.trim());
    if (!messages.length) continue;
    b.timers.push({
      name: str(t.name) || 'Imported timer',
      messages,
      intervalMinutes: Math.max(1, num(t.online?.interval) || 15),
      minLines: num(t.chatLines),
      onlineOnly: !t.offline?.enabled,
      enabled: t.enabled !== false && t.online?.enabled !== false,
    });
  }
  for (const q of raw.quotes || []) {
    const text = str(q.text || q.quote).trim();
    if (text) b.quotes.push({ text, date: Date.parse(q.createdAt) || Date.now(), game: str(q.game) });
  }
  for (const c of raw.counters || []) {
    const name = cleanName(c.id ?? c.counter ?? c.name);
    if (name) b.counters[name] = num(c.count ?? c.value);
  }
  return b;
}

// ─── Streamlabs: we only see what the dashboard loads, so recognise records by their fields ──

const pickStr = (o, keys) => {
  for (const k of keys) {
    const v = k.split('.').reduce((x, p) => (x == null ? x : x[p]), o);
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number') return String(v);
  }
  return '';
};
const pickNum = (o, keys) => {
  for (const k of keys) {
    const v = k.split('.').reduce((x, p) => (x == null ? x : x[p]), o);
    if (v != null && v !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
};

const NAME_KEYS = ['viewer.name', 'viewer.display_name', 'viewer.username', 'user.name', 'user.display_name', 'username', 'user_name', 'display_name', 'name', 'login'];
const RESPONSE_KEYS = ['response', 'reply', 'responses.0', 'responses.0.message', 'responses.0.value', 'output', 'message', 'text'];
const MESSAGE_KEYS = ['messages', 'responses', 'lines'];

/** Which kind of record is this object? (url gives a hint) */
export function classify(o, url = '') {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const u = url.toLowerCase();
  const hasInterval = pickNum(o, ['interval', 'interval_minutes', 'time_interval', 'online_interval', 'timer']) != null;
  const hasMessages = MESSAGE_KEYS.some((k) => Array.isArray(o[k]) && o[k].length) || !!pickStr(o, ['message', 'response', 'text']);
  const trigger = pickStr(o, ['command', 'trigger', 'cmd', 'keyword']);
  if ((u.includes('timer') || hasInterval) && hasMessages && !trigger) return 'timer';
  if (trigger && pickStr(o, RESPONSE_KEYS)) return 'command';
  if (u.includes('command') && pickStr(o, ['name']) && pickStr(o, RESPONSE_KEYS)) return 'command';
  const points = pickNum(o, ['points', 'point', 'balance', 'currency', 'amount']);
  if (points != null && pickStr(o, NAME_KEYS) && !trigger && (u.includes('loyal') || u.includes('point') || o.viewer || 'time' in o || 'points' in o))
    return 'points';
  const quote = pickStr(o, ['quote', 'quote_text']) || ((u.includes('quote') || 'custom_id' in o) && pickStr(o, ['text', 'message']));
  if (quote) return 'quote';
  return null;
}

function* arraysIn(v, depth = 0) {
  if (depth > 6 || !v || typeof v !== 'object') return;
  if (Array.isArray(v)) {
    if (v.length && v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) yield v;
    for (const x of v) yield* arraysIn(x, depth + 1);
    return;
  }
  for (const x of Object.values(v)) yield* arraysIn(x, depth + 1);
}

/** captures: [{ url, json }] — every JSON response seen while the Streamlabs dashboard was open. */
export function fromStreamlabs(captures = []) {
  const b = emptyBundle('streamlabs');
  const users = new Map();
  const cmdSeen = new Set();
  const timerSeen = new Set();
  const quoteSeen = new Set();
  for (const { url, json } of captures) {
    for (const arr of arraysIn(json)) {
      for (const o of arr) {
        const kind = classify(o, url);
        if (kind === 'points') {
          addUser(users, pickStr(o, NAME_KEYS), pickNum(o, ['points', 'point', 'balance', 'currency', 'amount']), pickNum(o, ['time', 'time_watched', 'watchtime', 'minutes', 'watch_time']));
        } else if (kind === 'command') {
          const name = cleanName(pickStr(o, ['command', 'trigger', 'cmd', 'keyword', 'name']));
          if (!name || cmdSeen.has(name)) continue;
          cmdSeen.add(name);
          const cd = o.cooldowns || o.cooldown || {};
          b.commands.push({
            name,
            response: convertSL(pickStr(o, RESPONSE_KEYS)),
            aliases: (Array.isArray(o.aliases) ? o.aliases : []).map((a) => cleanName(typeof a === 'string' ? a : a?.name || a?.command)).filter((a) => a && a !== name),
            level: slLevel(o.permission ?? o.permissions ?? o.perm ?? o.user_level ?? o.level ?? o.access ?? ''),
            cooldown: num(typeof cd === 'object' ? cd.global ?? cd.channel : cd) || num(o.global_cooldown),
            userCooldown: num(typeof cd === 'object' ? cd.user : 0) || num(o.user_cooldown),
            cost: num(o.cost ?? o.points_cost ?? o.price),
            enabled: o.enabled !== false && o.enabled !== 0 && o.status !== 'disabled',
            hidden: false,
          });
        } else if (kind === 'timer') {
          const raw = MESSAGE_KEYS.map((k) => o[k]).find((v) => Array.isArray(v) && v.length) || [pickStr(o, ['message', 'response', 'text'])];
          const messages = raw.map((m) => convertSL(typeof m === 'string' ? m : pickStr(m, ['message', 'text', 'value', 'response']))).filter((m) => m.trim());
          const name = pickStr(o, ['name', 'title']) || 'Imported timer';
          const key = name + '|' + messages.join('|');
          if (!messages.length || timerSeen.has(key)) continue;
          timerSeen.add(key);
          let interval = pickNum(o, ['interval', 'interval_minutes', 'time_interval', 'online_interval', 'timer']) || 15;
          if (interval > 600) interval = Math.round(interval / 60); // seconds, not minutes
          b.timers.push({
            name,
            messages,
            intervalMinutes: Math.max(1, interval),
            minLines: num(pickNum(o, ['lines', 'chat_lines', 'min_lines', 'line_requirement'])),
            onlineOnly: true,
            enabled: o.enabled !== false && o.enabled !== 0 && o.status !== 'disabled',
          });
        } else if (kind === 'quote') {
          const text = (pickStr(o, ['quote', 'quote_text']) || pickStr(o, ['text', 'message'])).trim();
          if (!text || quoteSeen.has(text)) continue;
          quoteSeen.add(text);
          b.quotes.push({ text, game: pickStr(o, ['game', 'category', 'game_name']), date: Date.parse(pickStr(o, ['created_at', 'createdAt', 'date'])) || Date.now() });
        }
      }
    }
  }
  b.users = [...users.values()];
  return b;
}

/** Other pages of a paginated response we captured (Laravel-style: current_page / last_page). */
export function morePages(url, json, max = 5000) {
  const metas = [json, json?.cloudbot, json?.data, json?.meta, json?.pagination, json?.cloudbot?.meta];
  let last = 0;
  let cur = 1;
  for (const m of metas) {
    if (!m || typeof m !== 'object') continue;
    const l = pickNum(m, ['last_page', 'lastPage', 'total_pages', 'totalPages', 'pages']);
    if (l) {
      last = l;
      cur = pickNum(m, ['current_page', 'currentPage', 'page']) || 1;
      break;
    }
  }
  if (!last || cur !== 1) return [];
  const out = [];
  for (let p = 2; p <= Math.min(last, max); p++) {
    const u = new URL(url);
    u.searchParams.set('page', String(p));
    out.push(u.toString());
  }
  return out;
}

// ─── CSV (username, points, minutes) — the format other bots export ─

export function fromCsv(text) {
  const b = emptyBundle('csv');
  const users = new Map();
  const rows = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, '')))
    .filter((r) => r.length && r[0]);
  let [ni, pi, mi] = [0, 1, -1];
  if (rows[0] && rows[0].some((c) => /name|user|viewer/i.test(c)) && !rows[0].some((c) => /^\d+$/.test(c))) {
    const h = rows.shift().map((c) => c.toLowerCase());
    ni = Math.max(0, h.findIndex((c) => /user|name|viewer/.test(c)));
    pi = h.findIndex((c) => /point|balance|currency/.test(c));
    mi = h.findIndex((c) => /minute|watch|time|hour/.test(c));
    if (pi < 0) pi = 1;
    if (mi >= 0 && /hour/.test(h[mi])) {
      const at = mi;
      for (const r of rows) r[at] = String(num(r[at]) * 60);
    }
  } else if (rows[0] && rows[0].length >= 5) {
    // StreamElements' import format: name, twitch id, current points, all-time points, minutes
    pi = 2;
    mi = 4;
  } else if (rows[0] && rows[0].length >= 3) mi = 2;
  for (const r of rows) addUser(users, r[ni], r[pi], mi >= 0 ? r[mi] : null);
  b.users = [...users.values()];
  return b;
}

// ─── Preview ─────────────────────────────────────────────────────────

export function summarize(b) {
  if (!b) return null;
  const top = [...b.users].sort((a, c) => c.points - a.points).slice(0, 5);
  return {
    source: b.source,
    channel: b.channel,
    users: b.users.length,
    points: b.users.reduce((s, u) => s + u.points, 0),
    minutes: b.users.reduce((s, u) => s + u.minutes, 0),
    top,
    commands: b.commands.length,
    commandSamples: b.commands.slice(0, 6).map((c) => ({ name: c.name, response: c.response })),
    timers: b.timers.length,
    quotes: b.quotes.length,
    counters: Object.keys(b.counters).length,
    loyalty: b.loyalty,
    notes: b.notes,
  };
}

// ─── Writing it into Steez ───────────────────────────────────────────

/**
 * opts: {
 *   points: 'max' | 'add' | 'replace' | 'skip'   (max = keep whichever is higher; safe to run twice)
 *   commands: 'keep' | 'overwrite' | 'skip'      (keep = leave Steez commands with the same name alone)
 *   timers, quotes, counters, loyaltySettings: boolean
 *   builtins: names of Steez's built-in commands (custom commands with these names are imported switched off)
 * }
 */
export function applyBundle(db, b, opts = {}) {
  const o = { points: 'max', commands: 'keep', timers: true, quotes: true, counters: true, loyaltySettings: true, builtins: [], ...opts };
  const tag = `import:${b.source}`;
  const res = { users: { added: 0, updated: 0 }, commands: { added: 0, replaced: 0, kept: 0, off: [] }, timers: 0, quotes: 0, counters: 0, loyaltySettings: false };

  if (o.points !== 'skip') {
    for (const u of b.users) {
      let cur = db.users[u.login];
      if (!cur) {
        cur = db.users[u.login] = { login: u.login, display: u.display, id: null, points: 0, watchMinutes: 0, messages: 0, firstSeen: Date.now(), lastSeen: 0, isSub: false, achievements: {}, stats: {} };
        res.users.added++;
      } else res.users.updated++;
      const p = num(cur.points);
      const m = num(cur.watchMinutes);
      if (o.points === 'add') {
        cur.points = p + u.points;
        cur.watchMinutes = m + u.minutes;
      } else if (o.points === 'replace') {
        cur.points = u.points;
        cur.watchMinutes = u.minutes;
      } else {
        cur.points = Math.max(p, u.points);
        cur.watchMinutes = Math.max(m, u.minutes);
      }
    }
  }

  if (o.commands !== 'skip') {
    const builtins = new Set((o.builtins || []).map(String));
    for (const c of b.commands) {
      const exists = db.commands[c.name];
      if (exists && o.commands === 'keep') {
        res.commands.kept++;
        continue;
      }
      const def = { response: c.response, level: c.level, cooldown: c.cooldown, userCooldown: c.userCooldown, createdBy: tag, createdAt: Date.now() };
      if (c.aliases?.length) def.aliases = c.aliases.filter((a) => !builtins.has(a));
      if (c.cost) def.cost = c.cost;
      if (c.hidden) def.hidden = true;
      if (c.replyType) def.replyType = c.replyType;
      if (!c.enabled) def.enabled = false;
      if (builtins.has(c.name)) {
        // A custom command beats a built-in one with the same name; don't let an import silently replace Steez's own.
        def.enabled = false;
        res.commands.off.push(c.name);
      }
      db.commands[c.name] = def;
      if (exists) res.commands.replaced++;
      else res.commands.added++;
    }
  }

  if (o.timers) {
    db.timers ||= [];
    const seen = new Set(db.timers.map((t) => (t.messages || []).join('\n')));
    for (const t of b.timers) {
      const key = t.messages.join('\n');
      if (seen.has(key)) continue;
      seen.add(key);
      const slug = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'timer';
      let id = `${b.source}-${slug}`;
      for (let i = 2; db.timers.some((x) => x.id === id); i++) id = `${b.source}-${slug}-${i}`;
      db.timers.push({ id, name: t.name, enabled: t.enabled, intervalMinutes: t.intervalMinutes, minLines: t.minLines, onlineOnly: t.onlineOnly, messages: t.messages, importedFrom: b.source });
      res.timers++;
    }
  }

  if (o.quotes) {
    db.quotes ||= [];
    db.meta ||= { quoteSeq: 0 };
    db.meta.quoteSeq = Math.max(num(db.meta.quoteSeq), ...db.quotes.map((q) => num(q.id)), 0);
    const have = new Set(db.quotes.map((q) => q.text.trim().toLowerCase()));
    for (const q of b.quotes) {
      const k = q.text.trim().toLowerCase();
      if (have.has(k)) continue;
      have.add(k);
      db.quotes.push({ id: ++db.meta.quoteSeq, text: q.text, game: q.game || '', date: q.date || Date.now(), addedBy: tag });
      res.quotes++;
    }
  }

  if (o.counters) {
    db.counters ||= {};
    for (const [k, v] of Object.entries(b.counters)) {
      db.counters[k] = Math.max(num(db.counters[k]), num(v));
      res.counters++;
    }
  }

  if (o.loyaltySettings && b.loyalty && db.settings?.loyalty) {
    const L = db.settings.loyalty;
    const map = { currencyName: 'currencyName', pointsPerInterval: 'pointsPerInterval', intervalMinutes: 'intervalMinutes', subscriberMultiplier: 'subscriberMultiplier', followBonus: 'followBonus', subBonus: 'subBonus', raidBonus: 'raidBonus' };
    for (const [from, to] of Object.entries(map)) {
      const v = b.loyalty[from];
      if (v == null || v === '') continue;
      if (typeof v === 'number' && from !== 'currencyName' && v <= 0 && /Interval|Multiplier/.test(from)) continue;
      L[to] = v;
    }
    if (b.loyalty.ignored?.length && db.settings.general) {
      db.settings.general.ignoredUsers = [...new Set([...(db.settings.general.ignoredUsers || []), ...b.loyalty.ignored])];
    }
    res.loyaltySettings = true;
  }
  return res;
}
