// Live status polling + stream info commands (uptime, title, game, shoutouts, followage...).
import { db } from '../store.js';
import { log } from '../logger.js';
import * as api from '../twitch/api.js';
import { getAccount } from '../twitch/auth.js';
import { fmtDuration, since, normLogin } from '../util.js';
import { broadcast } from '../web/hub.js';

export function init(bot) {
  let offlineStrikes = 0;

  function goOnline(info) {
    if (bot.state.live) return;
    bot.state.live = true;
    offlineStrikes = 0;
    // "resumed" = the bot (re)started while the stream was already running — skip go-live notifications/resets
    const resumed = info?.startedAt && Date.now() - new Date(info.startedAt).getTime() > 10 * 60000;
    log.info(resumed ? 'Stream is LIVE (resumed tracking)' : 'Stream is LIVE');
    bot.emit('stream:online', { ...info, resumed });
    broadcast('status', bot.status(), { dashboardOnly: true });
  }
  function goOffline() {
    if (!bot.state.live) return;
    bot.state.live = false;
    log.info('Stream went offline');
    bot.emit('stream:offline');
    broadcast('status', bot.status(), { dashboardOnly: true });
  }

  async function poll() {
    if (!getAccount('broadcaster')) return;
    try {
      const s = await api.getStream();
      if (s) {
        bot.state.stream = {
          title: s.title,
          game: s.game_name,
          gameId: s.game_id,
          viewers: s.viewer_count,
          startedAt: s.started_at,
          thumbnail: s.thumbnail_url?.replace('{width}', '640').replace('{height}', '360'),
        };
        bot.state.channelDisplay = s.user_name;
        goOnline(bot.state.stream);
      } else {
        const c = await api.getChannel();
        if (c) {
          bot.state.channelDisplay = c.broadcaster_name;
          bot.state.stream = { ...(bot.state.stream || {}), title: c.title, game: c.game_name, gameId: c.game_id, viewers: 0 };
        }
        if (bot.state.live && ++offlineStrikes >= 2) goOffline();
      }
      bot.emit('stream:polled', bot.state.stream);
    } catch (e) {
      log.warn('Stream poll failed:', e.message);
    }
  }
  setInterval(poll, 60_000);
  bot.on('ready', poll);
  bot.on('accounts:changed', poll);
  bot.on('eventsub:stream.online', () => setTimeout(poll, 5000));
  bot.on('eventsub:stream.offline', () => goOffline());

  bot.action('stream:update', async ({ title, game }) => {
    const body = {};
    if (title) body.title = title;
    if (game) {
      const g = await api.findCategory(game);
      if (!g) throw new Error(`Category "${game}" not found`);
      body.game_id = g.id;
    }
    await api.updateChannel(body);
    await poll();
    return bot.state.stream;
  });

  // ─── Commands ──────────────────────────────────────────────
  bot.command('uptime', {
    description: 'How long the stream has been live',
    cooldown: 5,
    handler: (ctx) => {
      if (!bot.state.live) return bot.reply(ctx, `${bot.state.channelDisplay} is offline.`);
      bot.reply(ctx, `${bot.state.channelDisplay} has been live for ${fmtDuration(Date.now() - new Date(bot.state.stream.startedAt), 3)}.`);
    },
  });

  bot.command('title', {
    description: 'Show or set (mods) the stream title',
    usage: '!title [new title]',
    cooldown: 5,
    handler: async (ctx, args) => {
      if (args.length && bot.hasLevel(ctx.user, 'moderator')) {
        await api.updateChannel({ title: args.join(' ') });
        bot.state.stream = { ...(bot.state.stream || {}), title: args.join(' ') };
        return bot.reply(ctx, `Title updated to: ${args.join(' ')}`);
      }
      bot.reply(ctx, `Title: ${bot.state.stream?.title || 'unknown'}`);
    },
  });

  bot.command('game', {
    description: 'Show or set (mods) the stream category',
    usage: '!game [category]',
    aliases: ['category'],
    cooldown: 5,
    handler: async (ctx, args) => {
      if (args.length && bot.hasLevel(ctx.user, 'moderator')) {
        const g = await api.findCategory(args.join(' '));
        if (!g) return bot.reply(ctx, `Couldn't find a category called "${args.join(' ')}".`);
        await api.updateChannel({ game_id: g.id });
        bot.state.stream = { ...(bot.state.stream || {}), game: g.name, gameId: g.id };
        return bot.reply(ctx, `Category updated to ${g.name}.`);
      }
      bot.reply(ctx, `Currently playing: ${bot.state.stream?.game || 'unknown'}`);
    },
  });

  async function shoutout(login, ctx) {
    const u = await api.getUserByLogin(login);
    if (!u) {
      if (ctx) bot.reply(ctx, `Couldn't find ${login}.`);
      return false;
    }
    const ch = await api.getChannel(u.id);
    const msg = await bot.render(db.settings.shoutout.message, ctx || {}, {
      name: u.display_name,
      login: u.login,
      game: ch?.game_name || 'something awesome',
      title: ch?.title || '',
    });
    await bot.say(msg);
    if (db.settings.shoutout.nativeShoutout && bot.state.live) {
      api.shoutout(u.id).catch((e) => log.warn('Native shoutout failed:', e.message));
    }
    bot.emit('shoutout', u);
    return true;
  }
  bot.shoutout = shoutout;

  bot.command('so', {
    description: 'Shout out another streamer',
    usage: '!so <user>',
    level: 'moderator',
    aliases: ['shoutout'],
    cooldown: 5,
    handler: async (ctx, args) => {
      if (!args[0]) return false;
      return shoutout(normLogin(args[0]), ctx);
    },
  });

  // Auto-shoutout listed streamers the first time they chat each stream.
  const autoSoDone = new Set();
  bot.on('stream:online', () => autoSoDone.clear());
  bot.on('chat', (ctx) => {
    const list = (db.settings.shoutout.autoList || []).map(normLogin);
    if (!list.includes(ctx.user.login) || autoSoDone.has(ctx.user.login) || !bot.state.live) return;
    autoSoDone.add(ctx.user.login);
    setTimeout(() => shoutout(ctx.user.login), 2000);
  });

  bot.command('followage', {
    description: 'How long you (or someone) have followed',
    usage: '!followage [user]',
    cooldown: 3,
    userCooldown: 15,
    handler: async (ctx, args) => {
      const login = normLogin(args[0]) || ctx.user.login;
      const u = await api.getUserByLogin(login);
      if (!u) return bot.reply(ctx, `${login} not found.`);
      if (u.id === bot.state.channelId) return bot.reply(ctx, `${u.display_name} is the streamer!`);
      const at = await api.getFollowedAt(u.id);
      bot.reply(ctx, at ? `${u.display_name} has been following for ${since(at)}.` : `${u.display_name} isn't following (yet!).`);
    },
  });

  bot.command('accountage', {
    description: 'How old a Twitch account is',
    aliases: ['created'],
    cooldown: 3,
    userCooldown: 15,
    handler: async (ctx, args) => {
      const u = await api.getUserByLogin(normLogin(args[0]) || ctx.user.login);
      if (!u) return bot.reply(ctx, 'User not found.');
      bot.reply(ctx, `${u.display_name}'s account was created ${since(u.created_at)} ago.`);
    },
  });

  const lurkers = new Map();
  bot.command('lurk', {
    description: 'Let the streamer know you are lurking',
    userCooldown: 60,
    handler: (ctx) => {
      lurkers.set(ctx.user.login, Date.now());
      bot.say(`${ctx.user.display} is now lurking. Enjoy the stream in the shadows 👀`);
    },
  });
  bot.command('unlurk', {
    description: 'Return from lurking',
    aliases: ['back'],
    userCooldown: 30,
    handler: (ctx) => {
      const t = lurkers.get(ctx.user.login);
      lurkers.delete(ctx.user.login);
      bot.say(t ? `Welcome back ${ctx.user.display}! You lurked for ${fmtDuration(Date.now() - t)}.` : `Welcome back ${ctx.user.display}!`);
    },
  });

  bot.command('viewers', {
    description: 'Current viewer count',
    cooldown: 10,
    handler: (ctx) => bot.reply(ctx, bot.state.live ? `${bot.state.stream.viewers} viewers watching right now.` : 'Stream is offline.'),
  });
}
