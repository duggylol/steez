// Hype detection: measures chat velocity vs. baseline, drives the hype-meter overlay,
// and auto-clips + logs "hype moments" with VOD timestamps. Also the !clip command.
import { db, save } from '../store.js';
import { log } from '../logger.js';
import * as api from '../twitch/api.js';
import { broadcast } from '../web/hub.js';
import { fmtDuration } from '../util.js';

export function init(bot) {
  const H = () => db.settings.hype;
  const times = []; // message timestamps (last 5 min)
  const window = []; // {t, text, user, emotes} last 30s
  let baseline = 5; // msgs/min EMA
  let lastMoment = 0;

  bot.on('chat:raw', (ctx) => {
    times.push(ctx.time);
    window.push({ t: ctx.time, text: ctx.text, user: ctx.user.display, emotes: ctx.emotes.map((e) => e.name) });
  });

  async function clip(by) {
    try {
      const c = await api.createClip();
      const url = `https://clips.twitch.tv/${c.id}`;
      db.clips.unshift({ id: c.id, url, editUrl: c.edit_url, by, t: Date.now(), game: bot.state.stream?.game, title: bot.state.stream?.title });
      db.clips.length = Math.min(db.clips.length, 300);
      save();
      broadcast('clip', db.clips[0], { dashboardOnly: true });
      return url;
    } catch (e) {
      log.warn('Clip failed:', e.message);
      return null;
    }
  }
  bot.clip = clip;

  setInterval(async () => {
    const now = Date.now();
    while (times.length && now - times[0] > 300000) times.shift();
    while (window.length && now - window[0].t > 30000) window.shift();
    const mpm = window.length * 2; // last 30s → per minute
    baseline = baseline * 0.97 + mpm * 0.03;
    const score = mpm / Math.max(baseline, 3);
    const level = Math.max(0, Math.min(1, (score - 1) / Math.max(1, H().threshold - 1)));
    broadcast('hype', { mpm, baseline: Math.round(baseline * 10) / 10, score: Math.round(score * 100) / 100, level });

    if (!H().enabled || !bot.state.live) return;
    if (score < H().threshold || mpm < H().minMessagesPerMinute) return;
    if (now - lastMoment < H().cooldownMinutes * 60000) return;
    lastMoment = now;

    // Top emotes/words of the moment
    const counts = {};
    for (const m of window) for (const e of m.emotes.length ? m.emotes : m.text.split(/\s+/).slice(0, 3)) counts[e] = (counts[e] || 0) + 1;
    const top = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k]) => k);
    const started = bot.state.stream?.startedAt ? new Date(bot.state.stream.startedAt).getTime() : now;
    const moment = {
      t: now,
      offset: fmtDuration(now - started, 3),
      offsetSeconds: Math.floor((now - started) / 1000),
      mpm,
      score: Math.round(score * 10) / 10,
      top,
      sample: window.slice(-8).map((m) => `${m.user}: ${m.text}`),
      game: bot.state.stream?.game,
      clip: null,
    };
    log.info(`🔥 Hype moment detected (${mpm} msg/min, ${moment.score}x baseline)`);
    if (H().autoClip) moment.clip = await clip('auto-hype');
    db.hypeMoments.unshift(moment);
    db.hypeMoments.length = Math.min(db.hypeMoments.length, 300);
    save();
    bot.emit('hype:moment', moment);
    broadcast('hype:moment', moment);
    if (H().announce && moment.clip) bot.say(await bot.render(H().announceMessage, {}, { clip: moment.clip }));
  }, 2000);

  bot.command('clip', {
    description: 'Clip the last 30 seconds',
    get userCooldown() {
      return db.settings.clips.cooldownSeconds;
    },
    cooldown: 15,
    handler: async (ctx) => {
      if (!bot.state.live) return bot.reply(ctx, "can't clip while offline."), false;
      const url = await clip(ctx.user.login);
      if (!url) return bot.reply(ctx, 'clip failed 😢'), false;
      bot.say(await bot.render(db.settings.clips.message, ctx, { clip: url }));
    },
  });

  bot.command('marker', {
    description: 'Mark this moment for the VOD (saved in dashboard)',
    usage: '!marker [note]',
    level: 'vip',
    cooldown: 5,
    handler: (ctx, args) => {
      const started = bot.state.stream?.startedAt ? new Date(bot.state.stream.startedAt).getTime() : Date.now();
      db.hypeMoments.unshift({ t: Date.now(), offset: fmtDuration(Date.now() - started, 3), offsetSeconds: Math.floor((Date.now() - started) / 1000), manual: true, note: args.join(' '), by: ctx.user.display, top: [], sample: [] });
      save();
      bot.reply(ctx, `📍 marker saved at ${db.hypeMoments[0].offset}.`);
    },
  });

  bot.action('clip:create', () => clip('dashboard'));
}
