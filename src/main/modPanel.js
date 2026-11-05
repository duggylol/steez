// Mod Panel link: keeps a websocket to the Steez relay (ChannelHub) so the streamer's mods can
// manage the bot from the web panel at <relay>/mod. Every request is checked against the
// streamer's permission switches and written to the activity log.
import WebSocket from 'ws';
import { bot } from './bot/core/bot.js';
import { db, save, getUser, findUser } from './bot/store.js';
import { config } from './bot/config.js';
import { getAccount, onAuthChange } from './bot/twitch/auth.js';
import { builtinList } from './bot/web/api.js';
import { broadcast } from './bot/web/hub.js';
import { LEVELS } from './bot/core/bot.js';
import { log } from './bot/logger.js';

const GROUPS = ['commands', 'timers', 'quotes', 'giveaways', 'polls', 'songs', 'queue', 'points', 'moderation'];
const P = () => db.settings.modPanel;
const clean = (n) => String(n || '').trim().toLowerCase().replace(/^!/, '');

function record(mod, action, summary) {
  db.modActivity ||= [];
  db.modActivity.unshift({ t: Date.now(), mod: mod.login, action, summary });
  db.modActivity.length = Math.min(db.modActivity.length, 300);
  save();
  broadcast('modActivity', db.modActivity[0], { dashboardOnly: true });
  log.info(`[mod panel] ${mod.login}: ${summary}`);
}

export function startModPanel({ send, version = '' }) {
  let ws = null;
  let state = 'off'; // off | connecting | online | error
  let detail = '';
  let retry = 0;
  let timer = null;
  let pingTimer = null;

  const setState = (s, d = '') => {
    state = s;
    detail = d;
    broadcast('modPanel', status(), { dashboardOnly: true });
  };
  const status = () => ({ state, detail, url: config.relayUrl ? `${config.relayUrl}/mod` : null, enabled: !!P()?.enabled, permissions: permissions() });
  const permissions = () => Object.fromEntries(GROUPS.map((g) => [g, !!P()?.[g]]));

  const can = (group) => {
    if (!P()?.enabled) throw new Error('The streamer turned the mod panel off.');
    if (!P()[group]) throw new Error('The streamer hasn’t allowed mods to change this.');
  };

  // ─── Actions mods can run ───────────────────────────────────
  const H = {
    'commands.list': () => (can('commands'), { custom: db.commands, builtins: builtinList(), levels: Object.keys(LEVELS) }),
    'commands.save': ({ name, oldName, def }, mod) => {
      can('commands');
      const n = clean(name);
      if (!/^\S{1,40}$/.test(n)) throw new Error('Command names can’t contain spaces.');
      if (!def || typeof def.response !== 'string' || !def.response.trim()) throw new Error('The response can’t be empty.');
      if (def.response.includes('${eval')) throw new Error('Only the streamer can use ${eval}.');
      if (!(def.level in LEVELS)) def.level = 'everyone';
      const old = oldName ? clean(oldName) : null;
      if (n !== old && db.commands[n]) throw new Error(`!${n} already exists.`);
      if (!old && bot.builtins.has(n)) throw new Error(`!${n} is a built-in command.`);
      const prev = old ? db.commands[old] : null;
      if (old && old !== n) delete db.commands[old];
      db.commands[n] = { ...(prev || {}), response: def.response.slice(0, 500), level: def.level, cooldown: Math.max(0, +def.cooldown || 0), userCooldown: Math.max(0, +def.userCooldown || 0), enabled: def.enabled !== false };
      save();
      record(mod, 'commands.save', prev ? `edited !${n}` : `added !${n}`);
      return db.commands[n];
    },
    'commands.delete': ({ name }, mod) => {
      can('commands');
      const n = clean(name);
      if (!db.commands[n]) throw new Error(`!${n} doesn’t exist.`);
      delete db.commands[n];
      save();
      record(mod, 'commands.delete', `deleted !${n}`);
      return true;
    },
    'commands.builtin': ({ name, patch }, mod) => {
      can('commands');
      const n = clean(name);
      if (!bot.builtins.has(n)) throw new Error('Unknown command');
      const o = (db.builtins[n] ||= {});
      if (patch && 'enabled' in patch) o.enabled = !!patch.enabled;
      if (patch && patch.level in LEVELS) o.level = patch.level;
      if (patch && 'cooldown' in patch) o.cooldown = Math.max(0, +patch.cooldown || 0);
      save();
      record(mod, 'commands.builtin', `changed built-in !${n}`);
      return o;
    },
    'timers.list': () => (can('timers'), db.timers),
    'timers.save': ({ timer: t }, mod) => {
      can('timers');
      if (!t?.name) throw new Error('A timer needs a name.');
      const clean = {
        id: t.id || Math.random().toString(36).slice(2, 10),
        name: String(t.name).slice(0, 60),
        enabled: t.enabled !== false,
        intervalMinutes: Math.max(1, +t.intervalMinutes || 15),
        minLines: Math.max(0, +t.minLines || 0),
        onlineOnly: t.onlineOnly !== false,
        random: !!t.random,
        announce: !!t.announce,
        messages: (t.messages || []).map((m) => String(m).slice(0, 500)).filter(Boolean).slice(0, 30),
      };
      const i = db.timers.findIndex((x) => x.id === clean.id);
      if (i >= 0) db.timers[i] = { ...db.timers[i], ...clean };
      else db.timers.push(clean);
      save();
      record(mod, 'timers.save', `${i >= 0 ? 'edited' : 'added'} timer "${clean.name}"`);
      return clean;
    },
    'timers.delete': ({ id }, mod) => {
      can('timers');
      const t = db.timers.find((x) => x.id === id);
      db.timers = db.timers.filter((x) => x.id !== id);
      save();
      record(mod, 'timers.delete', `deleted timer "${t?.name || id}"`);
      return true;
    },
    'quotes.list': () => (can('quotes'), db.quotes),
    'quotes.add': ({ text }, mod) => {
      can('quotes');
      const q = String(text || '').trim().slice(0, 400);
      if (!q) throw new Error('Empty quote');
      const id = ++db.meta.quoteSeq;
      db.quotes.push({ id, text: q, game: bot.state.stream?.game || '', date: Date.now(), addedBy: mod.login });
      save();
      record(mod, 'quotes.add', `added quote #${id}`);
      return id;
    },
    'quotes.delete': ({ id }, mod) => {
      can('quotes');
      db.quotes = db.quotes.filter((q) => q.id !== Number(id));
      save();
      record(mod, 'quotes.delete', `deleted quote #${id}`);
      return true;
    },
    'giveaway.state': () => (can('giveaways'), bot.raffleState?.()),
    'giveaway.start': async (a, mod) => (can('giveaways'), record(mod, 'giveaway.start', `started giveaway "${a.title}"`), bot.runAction('raffle:start', a)),
    'giveaway.stop': async (a, mod) => (can('giveaways'), record(mod, 'giveaway.stop', 'closed giveaway entries'), bot.runAction('raffle:stop')),
    'giveaway.draw': async (a, mod) => {
      can('giveaways');
      const w = await bot.runAction('raffle:draw');
      record(mod, 'giveaway.draw', `drew giveaway winner ${w?.display}`);
      return w;
    },
    'giveaway.cancel': async (a, mod) => (can('giveaways'), record(mod, 'giveaway.cancel', 'cancelled the giveaway'), bot.runAction('raffle:cancel')),
    'polls.state': () => (can('polls'), { poll: bot.pollState?.(), bets: bot.betState?.() }),
    'polls.start': async (a, mod) => (can('polls'), await bot.runAction('poll:start', a), record(mod, 'polls.start', `started poll "${a.question}"`)),
    'polls.end': async (a, mod) => (can('polls'), await bot.runAction('poll:end'), record(mod, 'polls.end', 'ended the poll')),
    'bets.open': async (a, mod) => (can('polls'), await bot.runAction('bets:open', a), record(mod, 'bets.open', `opened bets "${a.question}"`)),
    'bets.lock': async (a, mod) => (can('polls'), await bot.runAction('bets:lock'), record(mod, 'bets.lock', 'locked bets')),
    'bets.resolve': async (a, mod) => (can('polls'), await bot.runAction('bets:resolve', a), record(mod, 'bets.resolve', `paid out bet option ${Number(a.option) + 1}`)),
    'bets.refund': async (a, mod) => (can('polls'), await bot.runAction('bets:refund'), record(mod, 'bets.refund', 'refunded all bets')),
    'songs.command': ({ cmd }, mod) => {
      can('songs');
      if (!['skip', 'pause', 'resume', 'clearqueue'].includes(cmd)) throw new Error('Unknown song command');
      send('ss:twitch:command', { cmd, user: mod.login, isMod: true });
      record(mod, 'songs.command', `${cmd} (song requests)`);
      return true;
    },
    'queue.state': () => (can('queue'), bot.runAction('queueup:state')),
    'queue.next': async (a, mod) => (can('queue'), record(mod, 'queue.next', 'started the next game'), bot.runAction('queueup:next')),
    'queue.remove': async (a, mod) => (can('queue'), record(mod, 'queue.remove', 'removed a player from the queue'), bot.runAction('queueup:remove', a)),
    'queue.open': async (a, mod) => (can('queue'), record(mod, 'queue.open', a.open ? 'opened the queue' : 'closed the queue'), bot.runAction('queueup:open', a)),
    'points.get': ({ login }) => {
      can('points');
      const u = findUser(clean(login));
      if (!u) throw new Error('That viewer hasn’t chatted here yet.');
      return { login: u.display, points: u.points, currency: bot.currency };
    },
    'points.adjust': ({ login, amount }, mod) => {
      can('points');
      const n = Math.round(Number(amount) || 0);
      if (!n || Math.abs(n) > 1_000_000) throw new Error('Enter an amount between 1 and 1,000,000.');
      const l = clean(login);
      if (!/^[a-z0-9_]{2,25}$/.test(l)) throw new Error('Enter a Twitch username.');
      const total = bot.addPoints(l, n);
      record(mod, 'points.adjust', `${n > 0 ? 'gave' : 'took'} ${Math.abs(n)} ${bot.currency} ${n > 0 ? 'to' : 'from'} ${l}`);
      return { login: getUser(l).display, points: total, currency: bot.currency };
    },
    'mod.state': () => (can('moderation'), { shield: bot.shieldState?.(), log: (db.modlog || []).slice(0, 40) }),
    'mod.shield': async ({ on }, mod) => {
      can('moderation');
      await bot.runAction('shield', { on: !!on });
      record(mod, 'mod.shield', on ? 'turned shield mode on' : 'turned shield mode off');
      return true;
    },
  };

  async function handleCall(msg) {
    const reply = (obj) => ws?.readyState === 1 && ws.send(JSON.stringify({ type: 'reply', id: msg.id, ...obj }));
    const mod = { login: String(msg.mod?.login || 'unknown'), id: msg.mod?.id };
    try {
      const fn = H[msg.action];
      if (!fn) throw new Error('Unknown action');
      const result = await fn(msg.args || {}, mod);
      reply({ ok: true, result: result === undefined ? null : result });
      sendHello(); // permissions or names may have changed
    } catch (e) {
      reply({ ok: false, error: e.message });
    }
  }

  function sendHello() {
    if (ws?.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'hello', info: { name: bot.state.channelDisplay || getAccount('broadcaster')?.login, permissions: P()?.enabled ? permissions() : {}, version } }));
  }

  function connect() {
    clearTimeout(timer);
    if (ws) {
      ws.removeAllListeners();
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      ws = null;
    }
    const acct = getAccount('broadcaster');
    if (!P()?.enabled || !config.relayUrl) return setState('off');
    if (!acct) return setState('off', 'Connect your Twitch channel first.');
    if (acct.clientId && config.clientId && acct.clientId !== config.clientId)
      return setState('error', 'Your Twitch login came from another app (e.g. SongSeek). Reconnect your channel in Settings → Twitch accounts.');
    setState('connecting');
    const sock = (ws = new WebSocket(`${config.relayUrl.replace(/^http/, 'ws')}/v1/hub`, { headers: { Authorization: `Bearer ${acct.accessToken}` } }));
    sock.on('open', () => {
      retry = 0;
      setState('online');
      sendHello();
      clearInterval(pingTimer);
      pingTimer = setInterval(() => sock.readyState === 1 && sock.send('{"type":"ping"}'), 30_000);
    });
    sock.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'call') handleCall(msg);
    });
    // The relay refused the connection. With a listener attached, `ws` does not close the socket
    // or emit 'close' on its own, so we read the reason, abort, and schedule the retry ourselves.
    sock.on('unexpected-response', (req, res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        let code = '';
        try {
          code = JSON.parse(body).error || '';
        } catch {
          /* not JSON */
        }
        const msg =
          res.statusCode === 401
            ? 'Your Twitch login expired — reconnect your channel in Settings → Twitch accounts.'
            : code === 'wrong_app'
              ? 'Your Twitch login came from another app (e.g. SongSeek). Reconnect your channel in Settings → Twitch accounts.'
              : `The relay answered ${res.statusCode}${code ? ` (${code})` : ''} — retrying.`;
        setState('error', msg);
        req.destroy(); // only now — destroying earlier would discard the relay's explanation
        // Login problems won't fix themselves quickly; a reconnect in Settings retries immediately.
        retryLater(res.statusCode === 401 || res.statusCode === 403 ? 5 * 60_000 : null);
      });
      res.on('error', () => {});
    });
    sock.on('error', (e) => {
      if (state !== 'error') setState('error', `Can't reach the relay (${e.message}) — retrying.`);
    });
    sock.on('close', (code) => {
      clearInterval(pingTimer);
      if (ws !== sock) return;
      ws = null;
      if (code === 4000) return setState('error', 'Another Steez for this channel took over the mod panel.');
      if (state === 'online') setState('connecting', 'Reconnecting…');
      retryLater();
    });
  }

  function retryLater(ms) {
    if (ws) {
      ws.removeAllListeners();
      ws = null;
    }
    clearInterval(pingTimer);
    clearTimeout(timer);
    timer = setTimeout(connect, ms ?? Math.min(60_000, 2000 * 2 ** retry++));
    timer.unref?.();
  }

  // Safety net: if we're enabled but neither connected nor waiting to retry, try again.
  setInterval(() => {
    if (P()?.enabled && config.relayUrl && getAccount('broadcaster') && !ws && state !== 'online') {
      const pending = timer && timer._idleTimeout > 0 && !timer._destroyed;
      if (!pending) connect();
    }
  }, 60_000).unref();

  onAuthChange(() => {
    retry = 0;
    setTimeout(connect, 500);
  });
  bot.action('modpanel:reconnect', () => {
    retry = 0;
    connect();
    return status();
  });
  bot.action('modpanel:status', () => status());
  bot.action('modpanel:activity', () => (db.modActivity || []).slice(0, 100));
  bot.action('modpanel:apply', () => {
    // Settings changed in Steez: reconnect if needed and tell the relay the new permissions.
    if (!P()?.enabled) connect();
    else if (ws?.readyState === 1) sendHello();
    else connect();
    return status();
  });
  connect();
  return { status, reconnect: connect, handlers: H };
}
