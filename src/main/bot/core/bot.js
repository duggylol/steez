import { EventEmitter } from 'node:events';
import { db, save, getUser, findUser } from '../store.js';
import { log } from '../logger.js';
import { render, bindBot } from './variables.js';
import { TwitchIRC } from '../twitch/irc.js';
import { EventSubClient } from '../twitch/eventsub.js';
import { getAccount, refresh, onAuthChange, actualRole } from '../twitch/auth.js';
import * as api from '../twitch/api.js';
import { broadcast } from '../web/hub.js';
import { createRelay } from '../twitch/relay.js';
import { sanitizeChat, fmtNum, normLogin } from '../util.js';

export const LEVELS = { everyone: 0, regular: 1, subscriber: 2, vip: 3, moderator: 4, broadcaster: 5 };
export const LEVEL_NAMES = Object.keys(LEVELS);

function parseBadges(s) {
  const out = {};
  for (const b of String(s || '').split(',')) {
    if (!b) continue;
    const [k, v] = b.split('/');
    out[k] = v || '1';
  }
  return out;
}

/** "25:0-4,6-10/1902:12-16" → [{id, name, count}] */
function parseEmotes(tag, text) {
  if (!tag) return [];
  const chars = [...text];
  return tag.split('/').map((e) => {
    const [id, ranges] = e.split(':');
    const list = ranges.split(',');
    const [a, b] = list[0].split('-').map(Number);
    return { id, name: chars.slice(a, b + 1).join(''), count: list.length };
  });
}

class Bot extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(200);
    this.builtins = new Map();
    this.actions = new Map();
    this.filters = [];
    this.cooldowns = new Map();
    this.irc = new TwitchIRC();
    this.eventsub = new EventSubClient();
    this.state = {
      live: false,
      stream: null,
      channel: null,
      channelId: null,
      channelDisplay: null,
      botLogin: null,
      ircConnected: false,
      eventsubConnected: false,
      chatters: new Set(), // display names currently in chat
      active: new Map(), // login -> last message time
      emoteCache: new Map(), // emote name -> id (learned from chat)
      startedAt: Date.now(),
    };
    bindBot(this);
  }

  get settings() {
    return db.settings;
  }
  get prefix() {
    return db.settings.general.prefix || '!';
  }
  get currency() {
    return db.settings.loyalty.currencyName;
  }

  // ─── Registration API for modules ──────────────────────────────
  /** Register a built-in command. def: { level, cooldown, userCooldown, aliases, description, usage, handler(ctx,args) } */
  command(name, def) {
    def.name = name;
    def.level ??= 'everyone';
    def.cooldown ??= 0;
    def.userCooldown ??= 0;
    def.aliases ??= [];
    this.builtins.set(name, def);
  }

  /** Register a dashboard action callable through POST /api/action/:name */
  action(name, fn) {
    this.actions.set(name, fn);
  }

  async runAction(name, args = {}) {
    const fn = this.actions.get(name);
    if (!fn) throw new Error(`Unknown action: ${name}`);
    return fn(args);
  }

  /** Register a message filter (moderation). fn(ctx) → true if the message was actioned. */
  filter(fn) {
    this.filters.push(fn);
  }

  overlay(type, data) {
    broadcast(type, data);
  }

  // ─── Output ────────────────────────────────────────────────────
  async say(text, opts = {}) {
    if (text == null) return;
    let t = String(text).trim();
    if (!t) return;
    if (/^\/announce\b/i.test(t)) return this.announce(t.replace(/^\/announce\w*\s*/i, ''));
    let action = !!opts.action;
    if (/^\/me\s/i.test(t)) {
      action = true;
      t = t.slice(4);
    }
    t = sanitizeChat(t, 1500);
    if (!t) return;
    log.chat(`[${this.state.botLogin || 'bot'}] ${t}`);
    this.emit('bot:said', t);
    broadcast('chat:bot', { text: t, t: Date.now() }, { dashboardOnly: true });
    // SteezBot (shared bot account via the relay) when chosen; otherwise the IRC connection.
    if (this.relay?.active()) this.relay.send(t, { replyTo: opts.replyTo }); // (/me is not supported by the chat API)
    else this.irc.say(t, { replyTo: opts.replyTo, action });
  }

  async reply(ctx, text) {
    if (!text) return;
    if (!ctx?.user) return this.say(text);
    if (this.settings.general.replyStyle === 'reply' && ctx.id) return this.say(text, { replyTo: ctx.id });
    return this.say(`@${ctx.user.display} ${text}`);
  }

  async announce(text, color = 'primary') {
    const t = sanitizeChat(text, 500);
    try {
      await api.announce(t, color);
    } catch (e) {
      log.warn('Announcement failed, sending as normal message:', e.message);
      this.irc.say(t);
    }
  }

  render(template, ctx, extra) {
    return render(template, ctx, extra);
  }

  // ─── Moderation helpers ──────────────────────────────────────
  async timeout(user, seconds, reason) {
    try {
      const id = user.id || (await api.getUserByLogin(user.login))?.id;
      if (!id) return false;
      await api.timeoutUser(id, Math.max(1, Math.min(1209600, Math.round(seconds))), reason);
      return true;
    } catch (e) {
      log.warn(`Timeout failed (${user.login}): ${e.message}`);
      return false;
    }
  }
  async ban(user, reason) {
    try {
      const id = user.id || (await api.getUserByLogin(user.login))?.id;
      if (!id) return false;
      await api.banUser(id, reason);
      return true;
    } catch (e) {
      log.warn(`Ban failed (${user.login}): ${e.message}`);
      return false;
    }
  }
  async deleteMessage(id) {
    try {
      await api.deleteMessage(id);
      return true;
    } catch (e) {
      log.warn(`Delete failed: ${e.message}`);
      return false;
    }
  }

  // ─── Points helpers ──────────────────────────────────────────
  points(login) {
    return findUser(login)?.points || 0;
  }
  addPoints(login, n, display) {
    const u = getUser(login, display);
    u.points = Math.max(0, Math.round((u.points || 0) + n));
    save();
    this.emit('points:changed', u);
    return u.points;
  }
  /** Take points if the user can afford it. Returns false if not. */
  takePoints(login, n) {
    const u = findUser(login);
    if (!u || u.points < n) return false;
    u.points -= Math.round(n);
    save();
    this.emit('points:changed', u);
    return true;
  }
  fmtPoints(n) {
    return `${fmtNum(n)} ${this.currency}`;
  }

  // ─── Permissions / cooldowns ────────────────────────────────
  levelOf(tags, badges, login) {
    if (badges.broadcaster) return 'broadcaster';
    if (tags.mod === '1' || badges.moderator) return 'moderator';
    if (badges.vip || tags.vip) return 'vip';
    if (tags.subscriber === '1' || badges.subscriber || badges.founder) return 'subscriber';
    if ((this.settings.general.regulars || []).map(normLogin).includes(login)) return 'regular';
    return 'everyone';
  }
  hasLevel(user, level) {
    return (LEVELS[user?.level] ?? 0) >= (LEVELS[level] ?? 0);
  }
  /** Returns remaining seconds of cooldown (0 = ready) and arms it when ready && arm=true */
  cooldown(key, seconds, arm = true) {
    if (!seconds) return 0;
    const until = this.cooldowns.get(key) || 0;
    const now = Date.now();
    if (until > now) return Math.ceil((until - now) / 1000);
    if (arm) this.cooldowns.set(key, now + seconds * 1000);
    return 0;
  }

  // ─── Chat pipeline ───────────────────────────────────────────
  async handleChat({ tags, login, text }) {
    login = login.toLowerCase();
    const badges = parseBadges(tags.badges);
    const user = {
      login,
      display: tags['display-name'] || login,
      id: tags['user-id'],
      badges,
      color: tags.color,
      isBroadcaster: !!badges.broadcaster,
      isMod: tags.mod === '1' || !!badges.broadcaster,
      isVip: !!badges.vip,
      isSub: tags.subscriber === '1' || !!badges.subscriber || !!badges.founder,
    };
    user.level = this.levelOf(tags, badges, login);
    if ((this.settings.general.ignoredUsers || []).map(normLogin).includes(login)) return;
    if (this.relay?.info && login === this.relay.info.login) return; // our own SteezBot messages

    let isAction = false;
    if (text.startsWith('\x01ACTION ')) {
      isAction = true;
      text = text.slice(8, -1);
    }
    // Strip the "@user " prefix Twitch adds to replies so "!command" still works in a reply.
    const parent = tags['reply-parent-user-login'];
    if (parent && text.toLowerCase().startsWith(`@${parent.toLowerCase()} `)) text = text.slice(parent.length + 2);

    const existing = findUser(login);
    const rec = getUser(login, user.display);
    const prevSeen = rec.lastSeen;
    rec.id = user.id;
    rec.isSub = user.isSub;
    rec.lastSeen = Date.now();
    rec.messages = (rec.messages || 0) + 1;
    save();

    const emotes = parseEmotes(tags.emotes, text);
    for (const e of emotes) this.state.emoteCache.set(e.name, e.id);
    if (this.state.emoteCache.size > 2000) this.state.emoteCache.clear();

    const ctx = {
      id: tags.id,
      user,
      text,
      isAction,
      tags,
      emotes,
      bits: Number(tags.bits) || 0,
      firstMessage: tags['first-msg'] === '1',
      newToBot: !existing,
      daysAway: prevSeen ? (Date.now() - prevSeen) / 86400000 : 0,
      record: rec,
      time: Date.now(),
      args: [],
    };
    this.state.active.set(login, ctx.time);
    this.state.chatters.add(user.display);

    log.chat(`<${user.display}> ${text}`);
    broadcast('chat:message', { user: user.display, login, color: user.color, level: user.level, text, id: ctx.id, emotes, t: ctx.time }, { dashboardOnly: true });

    this.emit('chat:raw', ctx);

    for (const f of this.filters) {
      try {
        if (await f(ctx)) {
          ctx.moderated = true;
          this.emit('chat:moderated', ctx);
          return;
        }
      } catch (e) {
        log.error('Filter error', e);
      }
    }

    this.emit('chat', ctx);
    if (!this.settings.general.botEnabled) return;
    if (text.startsWith(this.prefix)) await this.runCommand(ctx);
  }

  findCommand(name) {
    const cmds = db.commands;
    if (cmds[name]) return { type: 'custom', name, def: cmds[name] };
    for (const [k, c] of Object.entries(cmds)) if ((c.aliases || []).includes(name)) return { type: 'custom', name: k, def: c };
    const build = (b) => ({ type: 'builtin', name: b.name, def: { ...b, ...(db.builtins[b.name] || {}) } });
    if (this.builtins.has(name)) return build(this.builtins.get(name));
    for (const b of this.builtins.values()) {
      const aliases = db.builtins[b.name]?.aliases ?? b.aliases;
      if ((aliases || []).includes(name)) return build(b);
    }
    return null;
  }

  async runCommand(ctx) {
    const body = ctx.text.slice(this.prefix.length).trim();
    if (!body) return;
    const [first, ...args] = body.split(/\s+/);
    const name = first.toLowerCase();
    ctx.args = args;
    ctx.commandName = name;
    const found = this.findCommand(name);
    if (!found) return;
    const { def } = found;
    if (def.enabled === false) return;
    if (!this.hasLevel(ctx.user, def.level)) return;

    const bypass = this.settings.general.modsBypassCooldowns && this.hasLevel(ctx.user, 'moderator');
    if (!bypass) {
      const g = this.cooldown(`cmd:${found.name}`, def.cooldown, false);
      const u = this.cooldown(`cmd:${found.name}:${ctx.user.login}`, def.userCooldown, false);
      if (g || u) {
        if (this.settings.general.cooldownMessages && this.cooldown(`cdmsg:${ctx.user.login}`, 10) === 0)
          this.reply(ctx, `!${name} is on cooldown (${Math.max(g, u)}s).`);
        return;
      }
    }
    const cost = Number(def.cost) || 0;
    if (cost > 0 && !this.hasLevel(ctx.user, 'moderator')) {
      if (this.points(ctx.user.login) < cost) return this.reply(ctx, `that command costs ${this.fmtPoints(cost)} — you have ${this.fmtPoints(this.points(ctx.user.login))}.`);
    }

    try {
      let ok = true;
      if (found.type === 'custom') {
        ctx.command = def;
        const out = await render(def.response, ctx);
        def.uses = (def.uses || 0) + 1;
        save();
        if (def.replyType === 'reply') await this.reply(ctx, out);
        else if (def.replyType === 'announce') await this.announce(out);
        else await this.say(out);
      } else {
        ok = (await def.handler(ctx, args)) !== false;
      }
      if (ok) {
        if (!bypass) {
          this.cooldown(`cmd:${found.name}`, def.cooldown);
          this.cooldown(`cmd:${found.name}:${ctx.user.login}`, def.userCooldown);
        }
        if (cost > 0 && !this.hasLevel(ctx.user, 'moderator')) this.takePoints(ctx.user.login, cost);
        this.emit('command:used', { ctx, name: found.name, type: found.type });
      }
    } catch (e) {
      log.error(`Command !${name} failed:`, e);
    }
  }

  // ─── Connections ─────────────────────────────────────────────
  connectChat() {
    const b = getAccount('broadcaster');
    const acct = getAccount('bot');
    if (!b || !acct) {
      log.warn('Chat not connected: connect the broadcaster account in the dashboard.');
      return;
    }
    this.state.channel = b.login;
    this.state.channelId = b.userId;
    this.state.channelDisplay ||= b.login;
    this.state.botLogin = acct.login;
    this.irc.connect({ login: acct.login, token: acct.accessToken, channel: b.login });
  }

  async startEventSub() {
    if (!getAccount('broadcaster')) return;
    this.eventsub.stop();
    this.eventsub.start();
  }

  /** The account viewers see the bot talking as (SteezBot, a custom bot account, or the streamer). */
  identityLogin() {
    return this.relay?.active() ? this.relay.info.login : this.state.botLogin;
  }

  async init() {
    this.relay = createRelay(this);
    this.relay.refresh();
    this.irc.on('connected', () => {
      this.state.ircConnected = true;
      log.info(`Chat connected as ${this.state.botLogin} in #${this.state.channel}`);
      broadcast('status', this.status(), { dashboardOnly: true });
    });
    this.irc.on('disconnected', () => {
      this.state.ircConnected = false;
      log.warn('Chat disconnected — reconnecting…');
      broadcast('status', this.status(), { dashboardOnly: true });
    });
    this.irc.on('authfail', async () => {
      log.warn('Chat login failed — refreshing token');
      try {
        const a = await refresh('bot');
        this.irc.updateToken(a.accessToken);
      } catch {
        this.irc.disconnect();
      }
    });
    this.irc.on('notice', (t) => log.info(`Twitch notice: ${t}`));
    this.irc.on('error', (e) => log.warn(`Chat socket error: ${e.message}`));
    this.irc.on('message', (m) => this.handleChat(m).catch((e) => log.error('Message handling failed', e)));
    this.irc.on('usernotice', (m) => this.emit('irc:usernotice', m));

    this.eventsub.on('log', (m) => log.info(m));
    this.eventsub.on('welcome', (sessionId) => this.emit('eventsub:welcome', sessionId));
    this.eventsub.on('closed', () => {
      this.state.eventsubConnected = false;
    });
    this.eventsub.on('event', (type, event) => {
      this.emit(`eventsub:${type}`, event);
    });

    // Dashboard "test chat": inject a message as any user/level to try commands without going live.
    this.action('chat:simulate', ({ user = 'testviewer', level = 'everyone', text = '' }) => {
      const login = normLogin(user) || 'testviewer';
      const badges = { broadcaster: 'broadcaster/1', moderator: 'moderator/1', vip: 'vip/1', subscriber: 'subscriber/1' }[level] || '';
      return this.handleChat({
        login,
        text: String(text),
        tags: {
          'display-name': user,
          'user-id': `sim-${login}`,
          id: `sim-${Date.now()}`,
          badges,
          mod: level === 'moderator' ? '1' : '0',
          subscriber: level === 'subscriber' ? '1' : '0',
          simulated: '1',
        },
      });
    });

    onAuthChange((role) => {
      const acct = getAccount('bot');
      if (acct && this.irc.creds && acct.login === this.irc.creds.login && actualRole('bot') === role) {
        this.irc.updateToken(acct.accessToken);
      }
    });
  }

  /** Full reconnect after an account was (re)linked from the dashboard. */
  reconnectAll() {
    this.relay?.refresh();
    this.irc.disconnect();
    this.connectChat();
    this.startEventSub();
    this.emit('accounts:changed');
  }

  status() {
    return {
      identity: this.identityLogin(),
      relay: this.relay?.status(),
      live: this.state.live,
      stream: this.state.stream,
      channel: this.state.channel,
      bot: this.state.botLogin,
      ircConnected: this.state.ircConnected,
      eventsubConnected: this.state.eventsubConnected,
      botIsMod: this.irc.isMod,
      chatters: this.state.chatters.size,
      uptimeMs: Date.now() - this.state.startedAt,
    };
  }
}

export const bot = new Bot();
