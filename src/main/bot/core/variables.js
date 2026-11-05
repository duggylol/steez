// Command variable engine. Supports StreamElements-style ${var args} and Nightbot/Streamlabs-style $(var args),
// nested variables, and fallbacks like ${1|default}.
import vm from 'node:vm';
import { db, findUser, getUser, save } from '../store.js';
import { randInt, pick, fmtDuration, since, fmtNum, isPrivateHost, normLogin } from '../util.js';
import * as api from '../twitch/api.js';
import { log } from '../logger.js';

const SAFE = ''; // stands in for "$" inside already-resolved values so they are never re-parsed
const RE_CURLY = /\$\{([^{}]*)\}/;
const RE_PAREN = /\$\(([^()]*)\)/;

const protect = (v) => String(v ?? '').replaceAll('$', SAFE);

let bot = null;
export function bindBot(b) {
  bot = b;
}

const handlers = new Map();
/** Register a variable: fn(arg, ctx, extra) => string|Promise<string> */
export function defineVariable(name, fn) {
  handlers.set(name, fn);
}

function nextMatch(s) {
  const a = RE_CURLY.exec(s);
  const b = RE_PAREN.exec(s);
  if (!a) return b;
  if (!b) return a;
  const inside = (x, y) => x.index > y.index && x.index + x[0].length < y.index + y[0].length;
  if (inside(a, b)) return a;
  if (inside(b, a)) return b;
  return a.index < b.index ? a : b;
}

/**
 * Render a template.
 * ctx: { user, args, commandName, command } — user = { login, display, id, level }
 * extra: map of additional variables (used for alerts: amount, months, ...)
 */
export async function render(template, ctx = {}, extra = {}) {
  let out = String(template ?? '');
  for (let i = 0; i < 50; i++) {
    const m = nextMatch(out);
    if (!m) break;
    let value;
    try {
      value = await resolve(m[1].trim(), ctx, extra);
    } catch (e) {
      log.warn(`Variable "${m[1]}" failed: ${e.message}`);
      value = '';
    }
    out = out.slice(0, m.index) + protect(value === undefined ? m[0] : value) + out.slice(m.index + m[0].length);
  }
  return out.replaceAll(SAFE, '$');
}

function argText(ctx, from) {
  return (ctx.args || []).slice(from).join(' ');
}

function targetLogin(ctx, arg) {
  if (arg) return normLogin(arg);
  if (ctx.args?.[0]) return normLogin(ctx.args[0]);
  return ctx.user?.login;
}

async function resolve(expr, ctx, extra) {
  // Fallback: ${1|default} or ${touser|someone}
  let fallback;
  const pipe = expr.indexOf('|');
  if (pipe >= 0 && !/^(random\.pick|eval|ai)\b/.test(expr)) {
    fallback = expr.slice(pipe + 1);
    expr = expr.slice(0, pipe).trim();
  }
  const sp = expr.indexOf(' ');
  const name = (sp < 0 ? expr : expr.slice(0, sp)).toLowerCase();
  const arg = sp < 0 ? '' : expr.slice(sp + 1).trim();

  let v;
  if (name in extra) v = extra[name];
  else if (/^\d+$/.test(name)) v = ctx.args?.[Number(name) - 1];
  else if (/^\d+:$/.test(name)) v = argText(ctx, Number(name.slice(0, -1)) - 1) || undefined;
  else if (handlers.has(name)) v = await handlers.get(name)(arg, ctx, extra);
  else {
    const rnd = name.match(/^random\.(-?\d+)-(-?\d+)$/);
    if (rnd) v = randInt(Number(rnd[1]), Number(rnd[2]));
  }
  if ((v === undefined || v === null || v === '') && fallback !== undefined) return fallback;
  return v;
}

// ─── Built-in variables ──────────────────────────────────────────────

const displayOf = (ctx) => ctx.user?.display || bot?.state.channelDisplay || 'everyone';

defineVariable('user', (_, ctx) => displayOf(ctx));
defineVariable('sender', (_, ctx) => displayOf(ctx));
defineVariable('user.name', (_, ctx) => displayOf(ctx));
defineVariable('user.login', (_, ctx) => ctx.user?.login || '');
defineVariable('user.level', (_, ctx) => ctx.user?.level || 'everyone');
defineVariable('touser', (_, ctx) => (ctx.args?.[0] ? ctx.args[0].replace(/^@/, '') : displayOf(ctx)));
defineVariable('target', (_, ctx) => (ctx.args?.[0] ? ctx.args[0].replace(/^@/, '') : displayOf(ctx)));
defineVariable('args', (_, ctx) => argText(ctx, 0));
defineVariable('query', (_, ctx) => argText(ctx, 0));
defineVariable('channel', () => bot?.state.channelDisplay || '');
defineVariable('login', () => bot?.state.channel || '');
defineVariable('currency', () => db.settings.loyalty.currencyName);
defineVariable('command', (_, ctx) => ctx.commandName || '');

defineVariable('title', () => bot?.state.stream?.title || '');
defineVariable('game', () => bot?.state.stream?.game || '');
defineVariable('viewers', () => String(bot?.state.stream?.viewers ?? 0));
defineVariable('uptime', () =>
  bot?.state.live && bot.state.stream?.startedAt ? fmtDuration(Date.now() - new Date(bot.state.stream.startedAt).getTime(), 3) : 'offline',
);

defineVariable('random.pick', (arg) => {
  const opts = [...arg.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  return opts.length ? pick(opts) : '';
});
defineVariable('random.chatter', () => {
  const list = [...(bot?.state.chatters || [])];
  return list.length ? pick(list) : bot?.state.channelDisplay || '';
});
defineVariable('randomchatter', (a, c, e) => handlers.get('random.chatter')(a, c, e));

defineVariable('count', (arg, ctx) => {
  if (arg) {
    db.counters[arg.toLowerCase()] = (db.counters[arg.toLowerCase()] || 0) + 1;
    save();
    return db.counters[arg.toLowerCase()];
  }
  const cmd = ctx.command;
  if (!cmd) return 0;
  cmd.count = (cmd.count || 0) + 1;
  save();
  return cmd.count;
});
defineVariable('getcount', (arg, ctx) => (arg ? db.counters[arg.toLowerCase()] || 0 : ctx.command?.count || 0));

function userFor(ctx, arg) {
  const login = targetLogin(ctx, arg);
  return login ? findUser(login) : null;
}
defineVariable('points', (arg, ctx) => fmtNum(userFor(ctx, arg)?.points || 0));
defineVariable('user.points', (_, ctx) => fmtNum(findUser(ctx.user?.login)?.points || 0));
defineVariable('touser.points', (_, ctx) => fmtNum(userFor(ctx)?.points || 0));
defineVariable('watchtime', (arg, ctx) => fmtDuration((userFor(ctx, arg)?.watchMinutes || 0) * 60000));
defineVariable('messages', (arg, ctx) => fmtNum(userFor(ctx, arg)?.messages || 0));
defineVariable('rank', (arg, ctx) => bot?.rankOf?.(userFor(ctx, arg))?.name || '');

defineVariable('followage', async (arg, ctx) => {
  const login = targetLogin(ctx, arg);
  const u = await api.getUserByLogin(login);
  if (!u) return `${login} not found`;
  const at = await api.getFollowedAt(u.id);
  return at ? since(at) : 'not following';
});
defineVariable('accountage', async (arg, ctx) => {
  const u = await api.getUserByLogin(targetLogin(ctx, arg));
  return u ? since(u.created_at) : 'unknown';
});
defineVariable('followers', async () => fmtNum(await api.followerCount()));
defineVariable('subcount', async () => fmtNum(await api.subCount()));

defineVariable('time', (arg) => {
  const tz = arg || db.settings.general.timezone || undefined;
  try {
    return new Date().toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  } catch {
    return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
});
defineVariable('date', (arg) => {
  const tz = arg || db.settings.general.timezone || undefined;
  try {
    return new Date().toLocaleDateString('en-US', { timeZone: tz, dateStyle: 'medium' });
  } catch {
    return new Date().toLocaleDateString('en-US', { dateStyle: 'medium' });
  }
});

defineVariable('urlencode', (arg) => encodeURIComponent(arg));
defineVariable('upper', (arg) => arg.toUpperCase());
defineVariable('lower', (arg) => arg.toLowerCase());

async function fetchText(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return '[invalid url]';
  }
  if (!/^https?:$/.test(u.protocol) || isPrivateHost(u.hostname)) return '[blocked url]';
  const res = await fetch(u, { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'TwitchChatBot/1.0' } });
  const text = (await res.text()).replace(/\s+/g, ' ').trim();
  return text.slice(0, 400);
}
defineVariable('customapi', fetchText);
defineVariable('urlfetch', fetchText);

defineVariable('weather', async (arg) => {
  if (!arg) return 'Usage: !weather <city>';
  return fetchText(`https://wttr.in/${encodeURIComponent(arg)}?format=${encodeURIComponent('%l: %c %t (feels %f), %w wind, %h humidity')}`);
});

defineVariable('quote', () => {
  const q = pick(db.quotes);
  return q ? `#${q.id}: "${q.text}"${q.game ? ` [${q.game}]` : ''}` : 'No quotes yet!';
});
defineVariable('song', () => bot?.songs?.current?.()?.title || 'nothing playing');

defineVariable('eval', (code, ctx) => {
  if (!db.settings.general.allowEval) return '[eval is disabled in settings]';
  const sandbox = {
    user: ctx.user?.display || '',
    args: [...(ctx.args || [])],
    random: (a, b) => randInt(a, b),
    pick: (arr) => pick(arr),
  };
  const result = vm.runInNewContext(code, sandbox, { timeout: 100 });
  return String(result ?? '');
});

// ${ai prompt} is registered by the AI module.
export { getUser };
