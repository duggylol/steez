// HTTP API for the chat-bot pages of the Steez UI, plus public pages (commands list,
// leaderboard) and the bot overlay. Mounted on the shared Steez server.
// Every /api route except /api/public/* requires the per-launch key that only the
// Steez window receives (via preload), so other local software and web pages can't drive the bot.
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { db, save, findUser, fillDefaults } from '../store.js';
import { defaultSettings } from '../defaults.js';
import { recentLogs } from '../logger.js';
import { disconnect, login, cancelLogin, missingScopes, SCOPES, REDIRECT_URI } from '../twitch/auth.js';
import { bot, LEVELS } from '../core/bot.js';
import { broadcast } from './hub.js';
import { ACHIEVEMENTS } from '../modules/achievements.js';
import { normLogin } from '../util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(here, '../public');

const SE_LEVELS = [
  [1500, 'broadcaster'],
  [500, 'moderator'],
  [400, 'vip'],
  [300, 'regular'],
  [250, 'subscriber'],
  [0, 'everyone'],
];
function toLevel(v) {
  if (v == null) return 'everyone';
  if (typeof v === 'number' || /^\d+$/.test(v)) return SE_LEVELS.find(([n]) => Number(v) >= n)[1];
  const s = String(v).toLowerCase();
  if (s.includes('broad') || s.includes('owner') || s.includes('streamer')) return 'broadcaster';
  if (s.includes('mod')) return 'moderator';
  if (s.includes('vip')) return 'vip';
  if (s.includes('reg')) return 'regular';
  if (s.includes('sub')) return 'subscriber';
  return 'everyone';
}

/** Convert Streamlabs Chatbot / Cloudbot style variables to ours. ${...} and $(...) already work. */
export function convertVariables(text) {
  const map = {
    user: 'user', username: 'user', 'user.name': 'user', sender: 'user',
    target: 'touser', touser: 'touser', 'touser.name': 'touser',
    randuser: 'random.chatter', 'random.chatter': 'random.chatter',
    count: 'count', uptime: 'uptime', game: 'game', title: 'title', channel: 'channel', mychannel: 'channel',
    followage: 'followage', points: 'points', currencyname: 'currency', msg: 'args', query: 'query',
  };
  let t = String(text || '');
  t = t.replace(/\$readapi\(([^)]+)\)/gi, (_, u) => `\${customapi ${u}}`);
  t = t.replace(/\$param(\d)/gi, (_, n) => `\${${n}}`);
  t = t.replace(/(?<![$\w])\{([a-z.]+)\}/gi, (m, k) => (map[k.toLowerCase()] ? `\${${map[k.toLowerCase()]}}` : m));
  t = t.replace(/(?<![\w{(])\$([a-z]+)\b(?![({])/gi, (m, k) => (map[k.toLowerCase()] ? `\${${map[k.toLowerCase()]}}` : m));
  return t;
}

function importCommands(text) {
  let items = [];
  const trimmed = String(text || '').trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) parsed = parsed.commands || parsed.data || Object.entries(parsed).map(([k, v]) => ({ command: k, ...(typeof v === 'string' ? { response: v } : v) }));
    items = parsed;
  } else {
    for (const line of trimmed.split(/\r?\n/)) {
      const m = line.match(/^\s*"?!?([^",\t]+)"?\s*[,\t]\s*"?(.*?)"?\s*$/);
      if (m) items.push({ command: m[1], response: m[2] });
    }
  }
  let n = 0;
  for (const it of items) {
    const name = String(it.command || it.name || it.trigger || it.Command || '').replace(/^!/, '').toLowerCase().trim();
    const response = it.reply || it.response || it.message || it.text || it.Response || it.output;
    if (!name || !response || /\s/.test(name)) continue;
    db.commands[name] = {
      response: convertVariables(response),
      level: toLevel(it.accessLevel ?? it.level ?? it.permission ?? it.userLevel ?? it.Permission),
      cooldown: Number(it.cooldown?.global ?? it.cooldown ?? it.globalCooldown ?? it.Cooldown ?? 5) || 0,
      userCooldown: Number(it.cooldown?.user ?? it.userCooldown ?? it.UserCooldown ?? 0) || 0,
      aliases: Array.isArray(it.aliases) ? it.aliases.map((a) => String(a).replace(/^!/, '').toLowerCase()) : [],
      cost: Number(it.cost ?? it.Cost ?? 0) || 0,
      enabled: it.enabled !== false,
      count: Number(it.count) || 0,
      importedAt: Date.now(),
    };
    n++;
  }
  save();
  return n;
}

export function builtinList() {
  return [...bot.builtins.values()]
    .map((b) => {
      const o = db.builtins[b.name] || {};
      return {
        name: b.name,
        group: b.group || 'Bot',
        description: b.description || '',
        usage: b.usage || '',
        level: o.level ?? b.level,
        cooldown: o.cooldown ?? b.cooldown,
        userCooldown: o.userCooldown ?? b.userCooldown,
        aliases: o.aliases ?? b.aliases,
        enabled: o.enabled !== false,
        defaultLevel: b.level,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function botState() {
  const acct = (r) =>
    db.auth[r] ? { login: db.auth[r].login, scopes: db.auth[r].scopes, expired: !!db.auth[r].expired, missingScopes: missingScopes(r) } : null;
  return {
    status: bot.status(),
    auth: { broadcaster: acct('broadcaster'), bot: acct('bot') },
    config: {
      clientIdSet: !!config.clientId,
      redirectUri: REDIRECT_URI,
      publicUrl: config.publicUrl,
      anthropic: !!config.anthropicKey,
      youtube: !!config.youtubeKey,
      scopes: SCOPES,
    },
    levels: Object.keys(LEVELS),
    settings: db.settings,
    commands: db.commands,
    builtins: builtinList(),
    timers: db.timers,
    quotes: db.quotes,
    counters: db.counters,
    achievements: ACHIEVEMENTS.map(({ check, ...a }) => a),
    raffle: bot.raffleState?.(),
    poll: bot.pollState?.(),
    bets: bot.betState?.(),
    boss: bot.bossState?.(),
    shield: bot.shieldState?.(),
    session: bot.sessionSummary?.(),
    userCount: Object.keys(db.users).length,
  };
}

export function createBotRouter({ key, openUrl }) {
  const r = express.Router();
  r.use(express.json({ limit: '5mb' }));

  // ─── Public ────────────────────────────────────────────────
  r.get('/overlay/alerts', (req, res) => res.sendFile(path.join(PUBLIC, 'overlay.html')));
  r.get('/api/public/commands', (req, res) => {
    res.json({
      prefix: bot.prefix,
      channel: bot.state.channelDisplay,
      currency: bot.currency,
      custom: Object.entries(db.commands)
        .filter(([, c]) => c.enabled !== false && !c.hidden)
        .map(([name, c]) => ({ name, response: c.response, level: c.level || 'everyone', aliases: c.aliases || [], cost: c.cost || 0 })),
      builtin: builtinList().filter((b) => b.enabled),
      shop: db.settings.shop.enabled ? db.settings.shop.items : [],
      achievements: ACHIEVEMENTS.map(({ check, ...a }) => a),
    });
  });
  r.get('/api/public/leaderboard', (req, res) => {
    const ignored = new Set((db.settings.general.ignoredUsers || []).map(normLogin));
    const list = Object.values(db.users).filter((u) => !ignored.has(u.login) && u.login !== bot.state.channel && u.login !== bot.state.botLogin);
    const map = (u) => ({ user: u.display, points: u.points, hours: Math.round(u.watchMinutes / 6) / 10, achievements: Object.keys(u.achievements || {}).length });
    res.json({
      currency: bot.currency,
      points: [...list].sort((a, b) => b.points - a.points).slice(0, 25).map(map),
      watch: [...list].sort((a, b) => b.watchMinutes - a.watchMinutes).slice(0, 25).map(map),
    });
  });

  // ─── Private (Steez window only) ───────────────────────────
  r.use('/api', (req, res, next) => {
    if (req.get('x-steez-key') === key) return next();
    res.status(401).json({ error: 'Unauthorized' });
  });

  r.get('/api/state', (req, res) => res.json(botState()));

  r.post('/api/auth/login/:role', async (req, res) => {
    try {
      const acct = await login(req.params.role === 'bot' ? 'bot' : 'broadcaster');
      bot.reconnectAll();
      res.json({ ok: true, login: acct.login });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
  r.post('/api/auth/cancel', (req, res) => {
    cancelLogin();
    res.json({ ok: true });
  });
  r.post('/api/auth/disconnect/:role', (req, res) => {
    disconnect(req.params.role === 'bot' ? 'bot' : 'broadcaster');
    bot.reconnectAll();
    res.json({ ok: true });
  });

  r.get('/api/secrets', (req, res) => res.json({ anthropicKey: !!db.secrets?.anthropicKey, youtubeKey: !!db.secrets?.youtubeKey }));
  r.put('/api/secrets', (req, res) => {
    db.secrets ||= {};
    for (const k of ['anthropicKey', 'youtubeKey']) if (typeof req.body?.[k] === 'string') db.secrets[k] = req.body[k].trim();
    globalThis.__steezSecrets = db.secrets;
    save();
    res.json({ anthropicKey: !!db.secrets.anthropicKey, youtubeKey: !!db.secrets.youtubeKey });
  });

  r.put('/api/settings', (req, res) => {
    for (const [section, value] of Object.entries(req.body || {})) {
      if (!(section in defaultSettings)) continue;
      db.settings[section] = value;
      if (value && typeof value === 'object' && !Array.isArray(value) && typeof defaultSettings[section] === 'object' && !Array.isArray(defaultSettings[section]))
        fillDefaults(db.settings[section], defaultSettings[section]);
    }
    save();
    broadcast('settings', db.settings);
    res.json(db.settings);
  });
  r.post('/api/settings/reset/:section', (req, res) => {
    const s = req.params.section;
    if (!(s in defaultSettings)) return res.status(404).json({ error: 'Unknown section' });
    db.settings[s] = structuredClone(defaultSettings[s]);
    save();
    res.json(db.settings);
  });

  const replaceable = { commands: 'object', builtins: 'object', timers: 'array', quotes: 'array', counters: 'object' };
  r.put('/api/:collection', (req, res, next) => {
    const c = req.params.collection;
    if (!(c in replaceable)) return next();
    const body = req.body;
    if (replaceable[c] === 'array' ? !Array.isArray(body) : typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Bad body' });
    if (c === 'commands') {
      for (const [k, v] of Object.entries(body)) if (!/^\S+$/.test(k) || typeof v?.response !== 'string') return res.status(400).json({ error: `Invalid command "${k}"` });
    }
    if (c === 'quotes') db.meta.quoteSeq = Math.max(db.meta.quoteSeq, ...body.map((q) => q.id || 0));
    db[c] = body;
    save();
    res.json(db[c]);
  });

  r.get('/api/users', (req, res) => {
    const q = String(req.query.search || '').toLowerCase();
    const sort = ['points', 'watchMinutes', 'messages', 'lastSeen', 'firstSeen'].includes(req.query.sort) ? req.query.sort : 'points';
    const list = Object.values(db.users)
      .filter((u) => !q || u.login.includes(q) || u.display.toLowerCase().includes(q))
      .sort((a, b) => (b[sort] || 0) - (a[sort] || 0));
    const limit = Math.min(500, Number(req.query.limit) || 100);
    res.json({ total: list.length, users: list.slice(0, limit) });
  });
  r.put('/api/users/:login', (req, res) => {
    const u = findUser(req.params.login);
    if (!u) return res.status(404).json({ error: 'Not found' });
    for (const k of ['points', 'watchMinutes', 'messages']) if (req.body[k] != null) u[k] = Math.max(0, Number(req.body[k]) || 0);
    if (req.body.notes != null) u.notes = String(req.body.notes);
    save();
    res.json(u);
  });
  r.delete('/api/users/:login', (req, res) => {
    delete db.users[normLogin(req.params.login)];
    save();
    res.json({ ok: true });
  });

  r.get('/api/modlog', (req, res) => res.json(db.modlog));
  r.get('/api/hype', (req, res) => res.json(db.hypeMoments));
  r.get('/api/clips', (req, res) => res.json(db.clips));
  r.get('/api/streams', (req, res) => res.json(db.streams));
  r.get('/api/logs', (req, res) => res.json(recentLogs()));

  r.post('/api/say', async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Empty message' });
    await bot.say(text);
    res.json({ ok: true });
  });

  r.post('/api/action/:name', async (req, res) => {
    try {
      const out = await bot.runAction(req.params.name, req.body || {});
      res.json({ ok: true, result: out ?? null });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  r.post('/api/import/commands', (req, res) => {
    try {
      res.json({ imported: importCommands(req.body?.text) });
    } catch (e) {
      res.status(400).json({ error: `Could not parse: ${e.message}` });
    }
  });

  r.get('/api/export', (req, res) => {
    const { auth, secrets, ...rest } = db;
    res.setHeader('Content-Disposition', `attachment; filename="steez-bot-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(rest);
  });

  r.post('/api/open', (req, res) => {
    const url = String(req.body?.url || '');
    if (/^https?:\/\//i.test(url)) openUrl?.(url);
    res.json({ ok: true });
  });

  return r;
}
