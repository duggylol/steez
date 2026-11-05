// Turns Twitch events (IRC USERNOTICE, cheers, EventSub) into alerts: chat messages, overlay alerts, bonuses.
// Also handles first-time chatters, returning viewers, first-of-stream and channel point redemptions.
import { db, save, getUser } from '../store.js';
import { log } from '../logger.js';
import * as api from '../twitch/api.js';
import { broadcast } from '../web/hub.js';

const TIERS = { 1000: 'Tier 1', 2000: 'Tier 2', 3000: 'Tier 3', Prime: 'Prime' };

export function init(bot) {
  const E = () => db.settings.events;
  const recentAlerts = [];
  bot.recentAlerts = () => recentAlerts;

  /** Central alert dispatcher. alert: { type, user, login, amount, months, tier, message, recipient } */
  async function alert(a, { silent = false } = {}) {
    a.t = Date.now();
    recentAlerts.unshift(a);
    if (recentAlerts.length > 100) recentAlerts.pop();
    bot.emit('alert', a);
    broadcast('alert', a);
    const cfg = E()[a.type];
    if (!silent && cfg?.enabled && cfg.message) {
      const ctx = { user: { login: a.login, display: a.user }, args: [] };
      const text = await bot.render(cfg.message, ctx, {
        amount: a.amount ?? '',
        months: a.months ?? '',
        tier: a.tier ?? '',
        message: a.message ?? '',
        recipient: a.recipient ?? '',
        reward: a.reward ?? '',
      });
      bot.say(text);
    }
  }
  bot.alert = alert;

  // ─── IRC USERNOTICE → subs, resubs, gifts, raids ───────────
  const giftBombs = new Map(); // gifter login -> remaining count to suppress
  bot.on('irc:usernotice', ({ tags, text }) => {
    const id = tags['msg-id'];
    const user = tags['display-name'] || tags.login;
    const login = tags.login;
    const tier = TIERS[tags['msg-param-sub-plan']] || 'Tier 1';
    switch (id) {
      case 'sub':
        return alert({ type: 'sub', user, login, tier, months: 1, message: text });
      case 'resub':
        return alert({ type: 'resub', user, login, tier, months: Number(tags['msg-param-cumulative-months']) || 1, message: text });
      case 'subgift': {
        const recipient = tags['msg-param-recipient-display-name'];
        const left = giftBombs.get(login) || 0;
        if (left > 0) {
          giftBombs.set(login, left - 1);
          return alert({ type: 'giftsub', user, login, tier, recipient }, { silent: true });
        }
        bot.emit('achievement:unlock', login, 'generous');
        return alert({ type: 'giftsub', user, login, tier, recipient, amount: 1 });
      }
      case 'submysterygift': {
        const n = Number(tags['msg-param-mass-gift-count']) || 1;
        giftBombs.set(login, (giftBombs.get(login) || 0) + n);
        bot.emit('achievement:unlock', login, 'generous');
        return alert({ type: 'giftbomb', user, login, tier, amount: n });
      }
      case 'raid': {
        const viewers = Number(tags['msg-param-viewerCount']) || 0;
        const rl = tags['msg-param-login'] || login;
        if (viewers < (E().raid.minViewers || 0)) return;
        alert({ type: 'raid', user: tags['msg-param-displayName'] || user, login: rl, amount: viewers });
        bot.emit('achievement:unlock', rl, 'raider');
        if (E().raid.autoShoutout && bot.shoutout) setTimeout(() => bot.shoutout(rl).catch(() => {}), 4000);
        return;
      }
      default:
        return;
    }
  });

  // Cheers arrive as chat messages with a bits tag
  bot.on('chat:raw', (ctx) => {
    if (ctx.bits > 0 && ctx.bits >= (E().cheer.minBits || 1)) {
      alert({ type: 'cheer', user: ctx.user.display, login: ctx.user.login, amount: ctx.bits, message: ctx.text.replace(/\b\w+\d+\b/g, '').trim() });
    }
  });

  // ─── Chat-based greetings ──────────────────────────────────
  let firstOfStreamDone = false;
  bot.on('stream:online', (info) => (firstOfStreamDone = !!info?.resumed));
  bot.on('chat', async (ctx) => {
    const ev = E();
    if (ctx.firstMessage && ev.firstTimeChatter.enabled) {
      bot.say(await bot.render(ev.firstTimeChatter.message, ctx));
      broadcast('alert', { type: 'firstchat', user: ctx.user.display, message: ctx.text, t: Date.now() }, { dashboardOnly: true });
    } else if (ev.returningViewer.enabled && ctx.daysAway >= ev.returningViewer.days) {
      bot.say(await bot.render(ev.returningViewer.message, ctx, { days: Math.floor(ctx.daysAway) }));
    }
    if (bot.state.live && !firstOfStreamDone && ev.firstOfStream.enabled && !ctx.user.isBroadcaster) {
      firstOfStreamDone = true;
      if (ev.firstOfStream.bonus) bot.addPoints(ctx.user.login, ev.firstOfStream.bonus, ctx.user.display);
      bot.emit('achievement:unlock', ctx.user.login, 'early_bird');
      bot.say(await bot.render(ev.firstOfStream.message, ctx, { bonus: ev.firstOfStream.bonus }));
    }
  });

  // ─── EventSub ──────────────────────────────────────────────
  bot.on('eventsub:welcome', async (sessionId) => {
    const b = api.broadcasterId();
    const subs = [
      ['channel.follow', '2', { broadcaster_user_id: b, moderator_user_id: b }],
      ['channel.channel_points_custom_reward_redemption.add', '1', { broadcaster_user_id: b }],
      ['stream.online', '1', { broadcaster_user_id: b }],
      ['stream.offline', '1', { broadcaster_user_id: b }],
      ['channel.ad_break.begin', '1', { broadcaster_user_id: b }],
    ];
    let ok = 0;
    for (const [type, version, condition] of subs) {
      try {
        await api.createEventSubSubscription(type, version, condition, sessionId);
        ok++;
      } catch (e) {
        log.warn(`EventSub ${type} not subscribed: ${e.message}`);
      }
    }
    bot.state.eventsubConnected = ok > 0;
    log.info(`EventSub connected (${ok}/${subs.length} subscriptions)`);
    broadcast('status', bot.status(), { dashboardOnly: true });
  });

  bot.on('eventsub:channel.follow', (e) => {
    const u = getUser(e.user_login, e.user_name);
    if (u.followAlerted) return; // ignore unfollow/refollow spam
    u.followAlerted = Date.now();
    u.id ||= e.user_id;
    save();
    alert({ type: 'follow', user: e.user_name, login: e.user_login });
  });

  bot.on('eventsub:channel.channel_points_custom_reward_redemption.add', async (e) => {
    const a = { type: 'redemption', user: e.user_name, login: e.user_login, reward: e.reward.title, amount: e.reward.cost, message: e.user_input || '' };
    alert(a, { silent: true });
    const r = (db.settings.redemptions || []).find((x) => x.reward && x.reward.toLowerCase() === e.reward.title.toLowerCase());
    if (!r) return;
    const ctx = { user: { login: e.user_login, display: e.user_name, level: 'everyone' }, args: (e.user_input || '').split(/\s+/).filter(Boolean), text: e.user_input || '' };
    if (r.response) bot.say(await bot.render(r.response, ctx, { reward: e.reward.title, input: e.user_input || '' }));
    if (r.effect) bot.overlay('effect', { effect: r.effect, user: e.user_name, text: e.user_input || '' });
    if (r.points) bot.addPoints(e.user_login, Number(r.points) || 0, e.user_name);
    if (r.command) {
      const found = bot.findCommand(r.command.replace(/^!/, '').toLowerCase());
      if (found?.type === 'custom') bot.say(await bot.render(found.def.response, ctx));
      else if (found) await found.def.handler({ ...ctx, user: { ...ctx.user, level: 'broadcaster' }, commandName: found.name }, ctx.args);
    }
  });

  bot.on('eventsub:channel.ad_break.begin', async (e) => {
    if (!E().adBreak.enabled) return;
    bot.say(await bot.render(E().adBreak.message, {}, { duration: e.duration_seconds }));
    broadcast('alert', { type: 'adbreak', amount: e.duration_seconds, t: Date.now() });
  });

  bot.on('stream:online', async (info) => {
    if (E().streamOnline.enabled && !info?.resumed) bot.say(await bot.render(E().streamOnline.message, {}));
  });

  // Dashboard: fire test alerts
  bot.action('alert:test', ({ type = 'follow' }) => {
    const samples = {
      follow: { user: 'TestFollower', login: 'testfollower' },
      sub: { user: 'TestSubber', login: 'testsubber', tier: 'Tier 1', months: 1 },
      resub: { user: 'LoyalViewer', login: 'loyalviewer', tier: 'Tier 1', months: 12, message: 'A whole year!' },
      giftsub: { user: 'GenerousOne', login: 'generousone', recipient: 'LuckyViewer', amount: 1 },
      giftbomb: { user: 'BigSpender', login: 'bigspender', amount: 10 },
      cheer: { user: 'BitsFan', login: 'bitsfan', amount: 500, message: 'Take my bits!' },
      raid: { user: 'FriendlyStreamer', login: 'friendlystreamer', amount: 42 },
      redemption: { user: 'PointSpender', login: 'pointspender', reward: 'Hydrate', amount: 100 },
    };
    return alert({ type, test: true, ...(samples[type] || samples.follow) }, { silent: true });
  });
  bot.action('alerts:recent', () => recentAlerts);
}
