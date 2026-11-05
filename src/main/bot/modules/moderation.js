// Spam filters with escalating punishments, link permits, banned words, spam-bot detection
// and follow-bot "shield mode".
import { db, save } from '../store.js';
import { log } from '../logger.js';
import { normLogin } from '../util.js';
import * as api from '../twitch/api.js';
import { broadcast } from '../web/hub.js';

const LINK_RE = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|net|org|io|gg|tv|co|me|ly|be|xyz|ru|de|uk|us|app|dev|live|link|info|biz|shop|site|online|store|fun|club|top|ws|to|cc|gl)(?:\/[^\s]*)?)/i;
const ZALGO_RE = /[̀-ͯ҃-҉᷀-᷿⃐-⃿︠-︯]{3,}/;

export function init(bot) {
  const S = () => db.settings.moderation;
  const permits = new Map(); // login -> expires
  const offenses = new Map(); // login -> [timestamps]

  function record(entry) {
    db.modlog.unshift({ t: Date.now(), ...entry });
    if (db.modlog.length > 300) db.modlog.length = 300;
    save();
    broadcast('modlog', db.modlog[0], { dashboardOnly: true });
  }

  async function punish(ctx, filter, reason) {
    const cfg = S()[filter] || {};
    const login = ctx.user.login;
    const windowMs = (S().offenseWindowMinutes || 10) * 60000;
    const list = (offenses.get(login) || []).filter((t) => Date.now() - t < windowMs);
    list.push(Date.now());
    offenses.set(login, list);
    const strike = list.length;

    let action;
    if (cfg.ban) {
      action = 'ban';
      await bot.ban(ctx.user, reason);
    } else if (S().warningFirst && strike === 1) {
      action = 'delete';
      await bot.deleteMessage(ctx.id);
    } else {
      const base = cfg.timeoutSeconds || 10;
      const secs = S().warningFirst ? base * Math.pow(10, strike - 2) : base * Math.pow(10, strike - 1);
      action = `timeout ${Math.min(secs, 1209600)}s`;
      await bot.timeout(ctx.user, secs, reason);
    }
    record({ user: ctx.user.display, login, filter, action, reason, message: ctx.text.slice(0, 300) });
    log.info(`[mod] ${filter}: ${action} ${ctx.user.display} — ${reason}`);
    if (S().announce && cfg.message && bot.cooldown(`modmsg:${filter}`, 5) === 0) {
      bot.say(await bot.render(cfg.message + (action === 'delete' ? ' (warning)' : ''), ctx));
    }
    return true;
  }

  function isLinkAllowed(text, ctx) {
    const c = S().links;
    if (c.allowSubscribers && ctx.user.isSub) return true;
    const p = permits.get(ctx.user.login);
    if (p && p > Date.now()) {
      permits.delete(ctx.user.login);
      return true;
    }
    const all = text.match(new RegExp(LINK_RE.source, 'gi')) || [];
    return all.every((l) => (c.whitelist || []).some((w) => w && l.toLowerCase().includes(w.toLowerCase())));
  }

  const compiled = { key: '', words: [], regex: [], spam: [] };
  function rules() {
    const bw = S().bannedWords;
    const key = JSON.stringify([bw.words, bw.regex, S().spamBots.patterns]);
    if (key !== compiled.key) {
      compiled.key = key;
      const safe = (src) => {
        try {
          return new RegExp(src, 'i');
        } catch {
          log.warn(`Invalid regex in moderation settings: ${src}`);
          return null;
        }
      };
      compiled.words = (bw.words || []).filter(Boolean).map((w) => new RegExp(`(^|\\W)${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '\\w*')}($|\\W)`, 'i'));
      compiled.regex = (bw.regex || []).map(safe).filter(Boolean);
      compiled.spam = (S().spamBots.patterns || []).map(safe).filter(Boolean);
    }
    return compiled;
  }

  bot.filter(async (ctx) => {
    const m = S();
    if (!m.enabled) return false;
    if (bot.hasLevel(ctx.user, m.exemptLevel || 'vip')) return false;
    const text = ctx.text;
    const r = rules();

    // Spam bots (mostly first messages from fresh accounts)
    if (m.spamBots.enabled && (ctx.firstMessage || ctx.newToBot) && r.spam.some((re) => re.test(text))) {
      const ok = m.spamBots.ban ? await bot.ban(ctx.user, 'Spam bot') : await bot.timeout(ctx.user, 600, 'Spam bot');
      record({ user: ctx.user.display, login: ctx.user.login, filter: 'spamBots', action: m.spamBots.ban ? 'ban' : 'timeout 600s', reason: 'Spam bot pattern', message: text.slice(0, 300) });
      return ok || true;
    }
    if (m.bannedWords.enabled && (r.words.some((re) => re.test(text)) || r.regex.some((re) => re.test(text)))) return punish(ctx, 'bannedWords', 'Banned word');
    if (m.links.enabled && LINK_RE.test(text) && !isLinkAllowed(text, ctx)) return punish(ctx, 'links', 'Unpermitted link');
    if (m.zalgo.enabled && ZALGO_RE.test(text)) return punish(ctx, 'zalgo', 'Zalgo text');

    const emoteCount = ctx.emotes.reduce((s, e) => s + e.count, 0);
    if (m.emotes.enabled && emoteCount > m.emotes.max) return punish(ctx, 'emotes', `Emote spam (${emoteCount})`);

    // Strip emotes before caps/symbol checks so "KEKW LUL" isn't caps spam
    const emoteNames = new Set(ctx.emotes.map((e) => e.name));
    const plain = text
      .split(/\s+/)
      .filter((w) => !emoteNames.has(w))
      .join(' ');

    if (m.length.enabled && text.length > m.length.max) return punish(ctx, 'length', 'Message too long');
    if (m.caps.enabled && plain.length >= m.caps.minLength) {
      const letters = plain.replace(/[^a-zA-Z]/g, '');
      const caps = plain.replace(/[^A-Z]/g, '');
      if (letters.length >= m.caps.minLength && (caps.length / letters.length) * 100 > m.caps.maxPercent) return punish(ctx, 'caps', 'Excessive caps');
    }
    if (m.symbols.enabled && plain.length >= m.symbols.minLength) {
      const sym = plain.replace(/[\p{L}\p{N}\s]/gu, '').length;
      if ((sym / plain.replace(/\s/g, '').length) * 100 > m.symbols.maxPercent) return punish(ctx, 'symbols', 'Excessive symbols');
    }
    if (m.repetition.enabled) {
      if (new RegExp(`(.)\\1{${Math.max(3, m.repetition.maxRepeatedChars)},}`).test(plain)) return punish(ctx, 'repetition', 'Repeated characters');
      const counts = {};
      for (const w of text.toLowerCase().split(/\s+/)) if (w.length > 1) counts[w] = (counts[w] || 0) + 1;
      if (Object.values(counts).some((c) => c > m.repetition.maxRepeatedWords)) return punish(ctx, 'repetition', 'Repeated words');
    }
    return false;
  });

  bot.command('permit', {
    description: 'Allow a user to post one link',
    usage: '!permit <user>',
    level: 'moderator',
    handler: (ctx, args) => {
      const login = normLogin(args[0]);
      if (!login) return false;
      permits.set(login, Date.now() + (S().links.permitSeconds || 60) * 1000);
      bot.say(`${args[0].replace(/^@/, '')} may post a link in the next ${S().links.permitSeconds}s.`);
    },
  });

  bot.command('nuke', {
    description: 'Time out everyone who said a phrase in the last 2 minutes',
    usage: '!nuke <phrase> [seconds]',
    level: 'moderator',
    handler: async (ctx, args) => {
      if (!args.length) return false;
      const secs = /^\d+$/.test(args[args.length - 1]) && args.length > 1 ? Number(args.pop()) : 60;
      const phrase = args.join(' ').toLowerCase();
      const hits = recent.filter((m) => Date.now() - m.t < 120000 && m.text.toLowerCase().includes(phrase) && !bot.hasLevel(m.user, 'vip'));
      const unique = [...new Map(hits.map((h) => [h.user.login, h.user])).values()];
      for (const u of unique) await bot.timeout(u, secs, `Nuked: ${phrase}`);
      record({ user: ctx.user.display, login: ctx.user.login, filter: 'nuke', action: `timeout ${secs}s ×${unique.length}`, reason: phrase, message: '' });
      bot.say(`☢️ Nuked ${unique.length} user(s) for "${phrase}".`);
    },
  });
  const recent = [];
  bot.on('chat:raw', (ctx) => {
    recent.push({ t: ctx.time, text: ctx.text, user: ctx.user });
    if (recent.length > 1000) recent.shift();
  });

  // ─── Shield mode (follow-bot protection / panic button) ─────
  let shieldUntil = 0;
  let shieldTimer = null;
  async function shield(on, reason = 'manual') {
    const c = db.settings.shield;
    try {
      if (on) {
        await api.setChatSettings({
          follower_mode: !!c.followersOnly,
          ...(c.followersOnly ? { follower_mode_duration: c.followersOnlyMinutes || 10 } : {}),
          emote_mode: !!c.emoteOnly,
          slow_mode: c.slowSeconds > 0,
          ...(c.slowSeconds > 0 ? { slow_mode_wait_time: Math.max(3, c.slowSeconds) } : {}),
        });
        shieldUntil = Date.now() + (c.durationMinutes || 10) * 60000;
        clearTimeout(shieldTimer);
        shieldTimer = setTimeout(() => shield(false, 'expired'), (c.durationMinutes || 10) * 60000);
        if (c.message) bot.say(c.message);
      } else {
        await api.setChatSettings({ follower_mode: false, emote_mode: false, slow_mode: false });
        shieldUntil = 0;
        clearTimeout(shieldTimer);
      }
      record({ user: 'shield', login: '', filter: 'shield', action: on ? 'on' : 'off', reason, message: '' });
      broadcast('shield', { on, until: shieldUntil }, { dashboardOnly: true });
    } catch (e) {
      log.error('Shield mode failed:', e.message);
      throw e;
    }
  }
  bot.action('shield', ({ on }) => shield(!!on));
  bot.command('shield', {
    description: 'Toggle shield mode (followers-only/slow mode)',
    usage: '!shield on|off',
    level: 'moderator',
    handler: (ctx, [arg]) => shield(arg !== 'off'),
  });

  const follows = [];
  bot.on('alert', (a) => {
    if (a.type !== 'follow' || !db.settings.shield.followBotProtection) return;
    follows.push(Date.now());
    while (follows.length && Date.now() - follows[0] > 60000) follows.shift();
    if (follows.length >= db.settings.shield.followsPerMinute && Date.now() > shieldUntil) {
      log.warn('Follow-bot attack suspected — enabling shield mode');
      shield(true, `follow spike (${follows.length}/min)`).catch(() => {});
    }
  });
  bot.shieldState = () => ({ on: shieldUntil > Date.now(), until: shieldUntil });
}
