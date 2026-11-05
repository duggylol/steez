// The single Twitch connection, shared by every Steez feature. The chat-bot core owns the
// actual IRC + EventSub sockets; this facade hands SongSeek, QueueUp, etc. a small, stable API.
import { bot } from './bot/core/bot.js';
import { helix } from './bot/twitch/helix.js';
import { getAccount, login, onAuthChange } from './bot/twitch/auth.js';
import { db } from './bot/store.js';

function toMessage(ctx) {
  const u = ctx.user;
  return {
    id: ctx.id,
    login: u.login,
    display: u.display,
    userId: u.id,
    text: ctx.text,
    color: u.color || null,
    badges: u.badges,
    level: u.level,
    isSub: !!u.isSub,
    isMod: !!u.isMod,
    isVip: !!u.isVip,
    isBroadcaster: !!u.isBroadcaster,
    firstMessage: !!ctx.firstMessage,
    emotes: ctx.emotes,
    simulated: ctx.tags?.simulated === '1',
  };
}

export function createTwitchHub() {
  const statusListeners = new Set();
  const status = () => {
    const b = db.auth.broadcaster;
    return {
      connected: !!bot.state.ircConnected,
      eventsub: !!bot.state.eventsubConnected,
      loggedIn: !!getAccount('broadcaster'),
      expired: !!b?.expired,
      login: b?.login || null,
      userId: b?.userId || null,
      channel: bot.state.channel || b?.login || null,
      botLogin: bot.state.botLogin || null,
      botIsMod: !!bot.irc.isMod,
      live: !!bot.state.live,
    };
  };
  const emitStatus = () => {
    const s = status();
    for (const fn of statusListeners) {
      try {
        fn(s);
      } catch {
        /* ignore */
      }
    }
  };
  bot.irc.on('connected', () => setTimeout(emitStatus, 50));
  bot.irc.on('disconnected', emitStatus);
  bot.on('stream:online', emitStatus);
  bot.on('stream:offline', emitStatus);
  onAuthChange(() => setTimeout(emitStatus, 50));

  return {
    /** Every chat message that passed moderation: { login, display, text, isSub, isMod, ... } */
    onChat(cb) {
      const h = (ctx) => cb(toMessage(ctx), ctx);
      bot.on('chat', h);
      return () => bot.off('chat', h);
    },
    /** Channel-point redemptions: { user, login, userId, reward, rewardId, input, cost } */
    onRedemption(cb) {
      const h = (e) =>
        cb({ user: e.user_name, login: e.user_login, userId: e.user_id, reward: e.reward?.title || '', rewardId: e.reward?.id, input: (e.user_input || '').trim(), cost: e.reward?.cost || 0 });
      bot.on('eventsub:channel.channel_points_custom_reward_redemption.add', h);
      return () => bot.off('eventsub:channel.channel_points_custom_reward_redemption.add', h);
    },
    /** Send a chat message as the bot account. Returns false when chat isn't connected. */
    say(text) {
      if (!bot.state.ircConnected) return false;
      bot.say(text);
      return true;
    },
    reply(msg, text) {
      if (!bot.state.ircConnected) return false;
      bot.say(`@${msg.display} ${text}`);
      return true;
    },
    status,
    onStatus(cb) {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    /** Helix call as the broadcaster (or 'bot'). */
    helix: (method, path, opts, role = 'broadcaster') => helix(role, method, path, opts),
    getAuth() {
      const a = getAccount('broadcaster');
      return a ? { token: a.accessToken, clientId: a.clientId, login: a.login, userId: a.userId } : null;
    },
    async login() {
      const a = await login('broadcaster');
      bot.reconnectAll();
      return a;
    },
    /**
     * Register a chat command in the bot's command system (permissions, cooldowns, aliases,
     * enable/disable and the public command list all apply). def: { description, usage, level,
     * cooldown, userCooldown, aliases, group, handler(msg, args, ctx) }
     */
    registerCommand(name, def) {
      const { handler, ...rest } = def;
      bot.command(String(name).replace(/^!/, '').toLowerCase(), { ...rest, handler: (ctx, args) => handler(toMessage(ctx), args, ctx) });
    },
    bot,
  };
}
