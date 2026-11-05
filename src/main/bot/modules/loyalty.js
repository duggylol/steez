// Loyalty currency + watch time + ranks.
import { db, save, getUser, findUser } from '../store.js';
import { log } from '../logger.js';
import * as api from '../twitch/api.js';
import { getAccount } from '../twitch/auth.js';
import { parseAmount, fmtNum, fmtDuration, normLogin } from '../util.js';

export function init(bot) {
  const L = () => db.settings.loyalty;
  const ignored = () => new Set([...(db.settings.general.ignoredUsers || []).map(normLogin), bot.state.botLogin, bot.relay?.info?.login]);

  bot.rankOf = (u) => {
    if (!u) return null;
    const hours = (u.watchMinutes || 0) / 60;
    const ranks = [...(L().ranks || [])].sort((a, b) => a.hours - b.hours);
    let cur = ranks[0] || { name: 'Viewer', hours: 0 };
    let next = null;
    for (const r of ranks) {
      if (hours >= r.hours) cur = r;
      else {
        next = r;
        break;
      }
    }
    return { ...cur, next, hours };
  };

  const ranked = () =>
    Object.values(db.users)
      .filter((u) => !ignored().has(u.login) && u.login !== bot.state.channel)
      .sort((a, b) => b.points - a.points);

  // ─── Watch time / points tick (every minute) ───────────────
  let minute = 0;
  async function tick() {
    if (!getAccount('broadcaster')) return;
    const live = bot.state.live;
    if (!live && !L().offlinePoints) return;
    minute++;
    let chatters = [];
    try {
      chatters = await api.getChatters();
      bot.state.chatters = new Set(chatters.map((c) => c.display));
    } catch (e) {
      // Fall back to users who chatted in the last 10 minutes
      const cutoff = Date.now() - 10 * 60000;
      chatters = [...bot.state.active.entries()].filter(([, t]) => t > cutoff).map(([login]) => ({ login, display: findUser(login)?.display || login }));
      if (minute % 30 === 1) log.warn('Could not fetch chatter list, using active chatters:', e.message);
    }
    const award = L().enabled && minute % Math.max(1, L().intervalMinutes) === 0;
    const activeCutoff = Date.now() - Math.max(1, L().intervalMinutes) * 60000;
    const skip = ignored();
    for (const c of chatters) {
      if (skip.has(c.login)) continue;
      const u = getUser(c.login, c.display);
      if (c.id) u.id = c.id;
      if (live) u.watchMinutes = (u.watchMinutes || 0) + 1;
      if (award) {
        let pts = L().pointsPerInterval;
        if (u.isSub) pts *= L().subscriberMultiplier || 1;
        if ((bot.state.active.get(c.login) || 0) > activeCutoff) pts += L().activeChatterBonus || 0;
        u.points = (u.points || 0) + Math.round(pts);
      }
    }
    save();
    bot.emit('loyalty:tick', chatters);
  }
  setInterval(() => tick().catch((e) => log.error('Loyalty tick failed', e)), 60_000);

  // ─── Event bonuses ─────────────────────────────────────────
  bot.on('alert', (a) => {
    if (!L().enabled || !a.login) return;
    const bonus = {
      follow: L().followBonus,
      sub: L().subBonus,
      resub: L().subBonus,
      giftsub: L().giftSubBonus,
      giftbomb: (L().giftSubBonus || 0) * (a.amount || 1),
      cheer: Math.floor((a.amount || 0) / 100) * (L().cheerBonusPer100Bits || 0),
      raid: L().raidBonus,
    }[a.type];
    if (bonus > 0) bot.addPoints(a.login, bonus, a.user);
  });

  // ─── Commands ──────────────────────────────────────────────
  bot.command('points', {
    description: 'Check your (or someone’s) points',
    usage: '!points [user]',
    get aliases() {
      return [...new Set(['balance', 'bal', L().currencyName.toLowerCase()])];
    },
    userCooldown: 5,
    handler: (ctx, args) => {
      const login = normLogin(args[0]) || ctx.user.login;
      const u = findUser(login);
      if (!u) return bot.reply(ctx, `${login} has no ${bot.currency} yet.`);
      const pos = ranked().findIndex((x) => x.login === u.login) + 1;
      bot.reply(ctx, `${u.display} has ${bot.fmtPoints(u.points)}${pos ? ` (rank #${pos})` : ''} and ${fmtDuration(u.watchMinutes * 60000)} watched.`);
    },
  });

  bot.command('give', {
    description: 'Give some of your points to someone',
    usage: '!give <user> <amount>',
    aliases: ['gift', 'pay'],
    userCooldown: 5,
    handler: (ctx, [to, amt]) => {
      const login = normLogin(to);
      const target = findUser(login);
      if (!target) return bot.reply(ctx, 'Usage: !give <user> <amount> (they must have chatted before)');
      if (login === ctx.user.login) return bot.reply(ctx, "you can't give to yourself 🙃");
      const n = parseAmount(amt, bot.points(ctx.user.login));
      if (!(n > 0)) return bot.reply(ctx, 'Usage: !give <user> <amount>');
      if (!bot.takePoints(ctx.user.login, n)) return bot.reply(ctx, `you only have ${bot.fmtPoints(bot.points(ctx.user.login))}.`);
      bot.addPoints(login, n);
      const u = findUser(ctx.user.login);
      u.stats ||= {};
      u.stats.given = (u.stats.given || 0) + n;
      save();
      bot.say(`${ctx.user.display} gave ${bot.fmtPoints(n)} to ${target.display}! 💸`);
    },
  });

  bot.command('addpoints', {
    description: 'Add points to a user or everyone in chat',
    usage: '!addpoints <user|all> <amount>',
    level: 'moderator',
    handler: (ctx, [to, amt]) => {
      const n = Number(String(amt).replace(/,/g, ''));
      if (!to || !Number.isFinite(n)) return false;
      if (to.toLowerCase() === 'all') {
        const cutoff = Date.now() - 15 * 60000;
        const logins = new Set([...bot.state.active.entries()].filter(([, t]) => t > cutoff).map(([l]) => l));
        for (const u of Object.values(db.users)) if (bot.state.chatters.has(u.display)) logins.add(u.login);
        for (const l of logins) bot.addPoints(l, n);
        return bot.say(`Gave ${bot.fmtPoints(n)} to ${logins.size} people in chat! 🎉`);
      }
      const total = bot.addPoints(normLogin(to), n);
      bot.reply(ctx, `${normLogin(to)} now has ${bot.fmtPoints(total)}.`);
    },
  });

  bot.command('removepoints', {
    description: 'Remove points from a user',
    usage: '!removepoints <user> <amount>',
    level: 'moderator',
    handler: (ctx, [to, amt]) => {
      const u = findUser(normLogin(to));
      const n = parseAmount(amt, u?.points || 0);
      if (!u || !(n >= 0)) return false;
      const total = bot.addPoints(u.login, -n);
      bot.reply(ctx, `${u.display} now has ${bot.fmtPoints(total)}.`);
    },
  });

  bot.command('leaderboard', {
    description: 'Top point holders',
    aliases: ['top', 'lb'],
    cooldown: 30,
    handler: (ctx, [what]) => {
      if (what === 'hours' || what === 'watchtime') {
        const top = Object.values(db.users)
          .filter((u) => !ignored().has(u.login) && u.login !== bot.state.channel)
          .sort((a, b) => b.watchMinutes - a.watchMinutes)
          .slice(0, 5);
        return bot.say(`⏱️ Top watchers: ${top.map((u, i) => `${i + 1}. ${u.display} (${Math.round(u.watchMinutes / 60)}h)`).join(' | ')}`);
      }
      const top = ranked().slice(0, 5);
      bot.say(`🏆 Top ${bot.currency}: ${top.map((u, i) => `${i + 1}. ${u.display} (${fmtNum(u.points)})`).join(' | ')}`);
    },
  });

  bot.command('watchtime', {
    description: 'How long you have watched',
    aliases: ['hours'],
    userCooldown: 10,
    handler: (ctx, args) => {
      const u = findUser(normLogin(args[0]) || ctx.user.login);
      if (!u) return bot.reply(ctx, 'No watch time recorded yet.');
      bot.reply(ctx, `${u.display} has watched for ${fmtDuration(u.watchMinutes * 60000, 3)}.`);
    },
  });

  bot.command('rank', {
    description: 'Your watch-time rank',
    userCooldown: 10,
    handler: (ctx, args) => {
      const u = findUser(normLogin(args[0]) || ctx.user.login);
      const r = bot.rankOf(u);
      if (!r) return bot.reply(ctx, 'No rank yet — keep watching!');
      const next = r.next ? ` — ${Math.max(0, r.next.hours - r.hours).toFixed(1)}h until ${r.next.name}` : ' — max rank!';
      bot.reply(ctx, `${u.display} is a ${r.name} (${r.hours.toFixed(1)}h)${next}`);
    },
  });

  // Dashboard actions
  bot.action('points:set', ({ login, points }) => {
    const u = getUser(normLogin(login));
    u.points = Math.max(0, Math.round(Number(points) || 0));
    save();
    return u;
  });
  bot.action('points:import', ({ csv, mode = 'replace' }) => {
    // Accepts "username,points[,minutes]" lines (StreamElements / Streamlabs exports)
    let n = 0;
    for (const line of String(csv).split(/\r?\n/)) {
      const parts = line.split(/[,;\t]/).map((s) => s.trim().replace(/^"|"$/g, ''));
      if (parts.length < 2) continue;
      const login = normLogin(parts[0]);
      const pts = Number(parts[1]);
      if (!/^[a-z0-9_]{2,25}$/.test(login) || !Number.isFinite(pts)) continue;
      const u = getUser(login);
      u.points = mode === 'add' ? u.points + pts : pts;
      if (parts[2] && Number.isFinite(Number(parts[2]))) u.watchMinutes = Math.max(u.watchMinutes, Number(parts[2]));
      n++;
    }
    save();
    return { imported: n };
  });
}
