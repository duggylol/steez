// Hype detection: measures chat velocity vs. baseline, drives the hype-meter overlay,
// and auto-clips + logs "hype moments" with VOD timestamps. Also the !clip command.
import { db, save } from '../store.js';
import { log } from '../logger.js';
import * as api from '../twitch/api.js';
import { broadcast } from '../web/hub.js';
import { fmtDuration } from '../util.js';
import { postClipToDiscord } from '../discordClip.js';

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

  /** Make a clip. Returns { url, clip } or { error } with a reason chat can read. */
  async function makeClip(by) {
    try {
      const c = await api.createClip();
      const url = `https://clips.twitch.tv/${c.id}`;
      const rec = { id: c.id, url, editUrl: c.edit_url, by, t: Date.now(), game: bot.state.stream?.game, title: bot.state.stream?.title };
      db.clips.unshift(rec);
      db.clips.length = Math.min(db.clips.length, 300);
      save();
      broadcast('clip', rec, { dashboardOnly: true });
      shareClip(rec);
      return { url, clip: rec };
    } catch (e) {
      log.warn('Clip failed:', e.message);
      const m = e.body?.message || e.message || '';
      if (/not connected/i.test(m)) return { error: 'the streamer’s Twitch account isn’t connected in Steez.' };
      if (e.status === 401 || /scope|token/i.test(m)) return { error: 'Twitch said no — reconnect the Twitch account in Steez.' };
      if (e.status === 404 || /offline|not live/i.test(m) || !bot.state.live) return { error: "can't clip while the stream is offline." };
      if (e.status === 403) return { error: 'clips are turned off for this channel on Twitch.' };
      return { error: 'Twitch couldn’t make the clip, try again in a moment.' };
    }
  }
  const clip = async (by) => (await makeClip(by)).url || null;
  bot.clip = clip;

  const whoClipped = (by) => ({ 'auto-hype': 'Hype detector', dashboard: bot.state.channelDisplay || 'The streamer', ai: 'Chat (asked the AI)' })[by] || by;

  // Post it in Discord (in the background: Twitch takes a few seconds to finish the video).
  function shareClip(rec) {
    const s = db.settings.clips;
    if (!s.discordVideo || (rec.by === 'auto-hype' && !s.discordHypeClips)) return;
    postClipToDiscord(bot, { ...rec, by: whoClipped(rec.by) })
      .then((r) => {
        rec.discord = r?.sent || null;
        save();
        broadcast('clip', rec, { dashboardOnly: true });
        if (r) log.info(`Clip posted in Discord as ${r.sent === 'video' ? 'a video' : 'a link'}`);
      })
      .catch((e) => log.warn('Clip to Discord failed:', e.message));
  }

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
    // On out of the box: !clip works even with the Chat bot switch off (turn it off on the Commands page).
    module: true,
    get userCooldown() {
      return db.settings.clips.cooldownSeconds;
    },
    cooldown: 15,
    handler: async (ctx) => {
      // No offline check up front: the live flag can lag a minute behind, so let Twitch decide.
      const { url, error } = await makeClip(ctx.user.display);
      if (!url) return bot.reply(ctx, `${error} 😢`), false;
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
  // Send a clip (the newest one unless an id is given) to Discord now, to test the setup.
  bot.action('clip:discord', async ({ id } = {}) => {
    const rec = id ? db.clips.find((c) => c.id === id) : db.clips[0];
    if (!rec) throw new Error('No clips yet. Make one while you’re live, then try again.');
    const r = await postClipToDiscord(bot, { ...rec, by: whoClipped(rec.by) }, { force: true });
    return r;
  });

  // One-time repair (0.1.23): an imported !clip from another bot could hide Steez's own.
  if (!db.meta.clipCommandFixed) {
    db.meta.clipCommandFixed = true;
    const isImported = (c) => !!(c.importedAt || /^import:/.test(c.createdBy || ''));
    const own = db.commands.clip;
    if (own && isImported(own) && own.enabled !== false) own.enabled = false;
    for (const c of Object.values(db.commands)) if (isImported(c) && c.aliases?.includes('clip')) c.aliases = c.aliases.filter((a) => a !== 'clip');
    if (db.builtins.clip?.enabled === false) delete db.builtins.clip.enabled;
    save();
  }
}
