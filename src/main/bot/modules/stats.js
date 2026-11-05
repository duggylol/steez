// Stream sessions & analytics, Discord go-live notifications and end-of-stream recaps.
import { db, save, backup } from '../store.js';
import { log } from '../logger.js';
import { fmtDuration, fmtNum } from '../util.js';
import { broadcast } from '../web/hub.js';

export function init(bot) {
  let session = null;

  function newSession() {
    return {
      id: Date.now(),
      start: bot.state.stream?.startedAt ? new Date(bot.state.stream.startedAt).getTime() : Date.now(),
      end: null,
      title: bot.state.stream?.title || '',
      game: bot.state.stream?.game || '',
      games: [],
      peakViewers: 0,
      avgViewersSum: 0,
      avgViewersN: 0,
      messages: 0,
      chatters: {},
      follows: 0,
      subs: 0,
      gifts: 0,
      bits: 0,
      raids: [],
      commands: {},
      timeline: [], // {t, viewers, mpm}
      hypeMoments: 0,
      recap: null,
    };
  }

  bot.on('stream:online', async (info) => {
    session = newSession();
    bot.state.session = session;
    const d = db.settings.discord;
    if (d.webhookUrl && d.goLive && !info?.resumed) {
      const msg = await bot.render(d.goLiveMessage, {});
      discord({ content: msg, embeds: bot.state.stream?.thumbnail ? [{ title: bot.state.stream.title, url: `https://twitch.tv/${bot.state.channel}`, image: { url: `${bot.state.stream.thumbnail}?t=${Date.now()}` }, color: 0x9146ff }] : [] });
    }
  });

  bot.on('stream:offline', () => finish());

  let msgsThisMinute = 0;
  bot.on('chat:raw', (ctx) => {
    msgsThisMinute++;
    if (!session) return;
    session.messages++;
    session.chatters[ctx.user.display] = (session.chatters[ctx.user.display] || 0) + 1;
  });
  bot.on('command:used', ({ name }) => {
    if (session) session.commands[name] = (session.commands[name] || 0) + 1;
  });
  bot.on('alert', (a) => {
    if (!session || a.test) return;
    if (a.type === 'follow') session.follows++;
    if (a.type === 'sub' || a.type === 'resub') session.subs++;
    if (a.type === 'giftsub') session.gifts++; // gift bombs also emit one giftsub per recipient
    if (a.type === 'cheer') session.bits += a.amount || 0;
    if (a.type === 'raid') session.raids.push({ user: a.user, viewers: a.amount });
  });
  bot.on('hype:moment', () => session && session.hypeMoments++);

  setInterval(() => {
    const mpm = msgsThisMinute;
    msgsThisMinute = 0;
    if (!session || !bot.state.live) return;
    const v = bot.state.stream?.viewers || 0;
    session.peakViewers = Math.max(session.peakViewers, v);
    session.avgViewersSum += v;
    session.avgViewersN++;
    const g = bot.state.stream?.game;
    if (g && !session.games.includes(g)) session.games.push(g);
    session.timeline.push({ t: Date.now(), viewers: v, mpm });
    broadcast('session', summary(session), { dashboardOnly: true });
  }, 60_000);

  function summary(s) {
    if (!s) return null;
    const top = Object.entries(s.chatters)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([user, n]) => ({ user, n }));
    return {
      ...s,
      chatters: undefined,
      uniqueChatters: Object.keys(s.chatters).length,
      topChatters: top,
      avgViewers: s.avgViewersN ? Math.round(s.avgViewersSum / s.avgViewersN) : 0,
      duration: (s.end || Date.now()) - s.start,
    };
  }
  bot.sessionSummary = () => summary(session);

  async function finish() {
    if (!session) return;
    session.end = Date.now();
    const s = summary(session);
    session = null;
    bot.state.session = null;
    log.info(`Stream session saved: ${fmtDuration(s.duration)} / ${s.messages} messages / peak ${s.peakViewers}`);

    const moments = db.hypeMoments.filter((m) => m.t >= s.start);
    const facts = [
      `Stream "${s.title}" (${s.games.join(', ') || s.game}) lasted ${fmtDuration(s.duration, 3)}.`,
      `Peak viewers ${s.peakViewers}, average ${s.avgViewers}. ${fmtNum(s.messages)} chat messages from ${s.uniqueChatters} chatters.`,
      `New followers: ${s.follows}. Subs: ${s.subs}. Gifted subs: ${s.gifts}. Bits: ${s.bits}. Raids: ${s.raids.map((r) => `${r.user} (${r.viewers})`).join(', ') || 'none'}.`,
      `Top chatters: ${s.topChatters.slice(0, 5).map((t) => `${t.user} (${t.n})`).join(', ')}.`,
      `Hype moments: ${moments.map((m) => `${m.offset} [${m.top.join(' ')}] ${m.sample.slice(-3).join(' / ')}`).join(' || ') || 'none'}.`,
    ].join('\n');
    s.facts = facts;

    if (db.settings.ai.streamRecap && bot.ai?.available()) {
      try {
        s.recap = await bot.ai.recap(facts);
      } catch (e) {
        log.warn('AI recap failed:', e.message);
      }
    }
    db.streams.unshift({ ...s, timeline: s.timeline });
    db.streams.length = Math.min(db.streams.length, 100);
    save();
    backup();
    const d = db.settings.discord;
    if (d.webhookUrl && d.recap) {
      discord({
        embeds: [
          {
            title: `📊 Stream recap — ${new Date(s.start).toLocaleDateString('en-US')}`,
            description: (s.recap || facts).slice(0, 4000),
            color: 0x9146ff,
            fields: [
              { name: 'Duration', value: fmtDuration(s.duration, 3), inline: true },
              { name: 'Peak viewers', value: String(s.peakViewers), inline: true },
              { name: 'Messages', value: fmtNum(s.messages), inline: true },
              { name: 'Followers', value: String(s.follows), inline: true },
              { name: 'Subs', value: String(s.subs + s.gifts), inline: true },
              { name: 'Bits', value: fmtNum(s.bits), inline: true },
            ],
          },
        ],
      });
    }
  }

  async function discord(body) {
    try {
      const url = db.settings.discord.webhookUrl;
      if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url)) return log.warn('Discord webhook URL looks invalid');
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Stream Bot', ...body }) });
      if (!r.ok) log.warn(`Discord webhook failed: ${r.status}`);
    } catch (e) {
      log.warn('Discord webhook failed:', e.message);
    }
  }

  bot.action('discord:test', () => discord({ content: '✅ Test message from your Twitch bot!' }));
  bot.action('stream:end-session', () => finish());

  // Resume tracking if the bot restarts mid-stream
  bot.on('stream:polled', () => {
    if (bot.state.live && !session) {
      session = newSession();
      bot.state.session = session;
    }
  });

  setInterval(backup, 24 * 3600 * 1000).unref();
}
