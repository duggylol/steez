// Twitch Chat page backend: every chat line and stream event, unfiltered and sorted, plus the
// badge and emote art (Twitch, 7TV, BTTV, FFZ) the page needs to draw them like Twitch does.
// Lines are sent to the Steez window as they arrive; the last few hundred are kept for new views.
import WebSocket from 'ws';
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, save } from './store.js';
import { log } from './logger.js';
import { broadcast } from './web/hub.js';
import { helix } from './twitch/helix.js';
import { getAccount, onAuthChange } from './twitch/auth.js';
import { TwitchIRC } from './twitch/irc.js';
import { normLogin } from './util.js';

const KEEP = 400;

// OBS dock: a link with its own lasting key (the Steez window's key changes every launch). The key
// only opens the chat: reading it, reloading emotes and the mod buttons.
export function chatDockKey(renew = false) {
  db.secrets ||= {};
  if (renew || !db.secrets.chatDockKey) {
    db.secrets.chatDockKey = crypto.randomBytes(18).toString('hex');
    save();
  }
  return db.secrets.chatDockKey;
}
export function isChatDockKey(k) {
  const want = db.secrets?.chatDockKey;
  if (typeof k !== 'string' || !want || k.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(k), Buffer.from(want));
}
export const chatDockUrl = () => `${config.publicUrl}/?dock=${chatDockKey()}`;
// Developer preview: STEEZ_CHAT_DEMO=<twitch user id>:<login> (see chatDemo.js).
const DEMO = /^(\d+):(\w+)$/.exec(process.env.STEEZ_CHAT_DEMO || '');
const recent = [];
let seq = 0;

// ─── Parsing ──────────────────────────────────────────────────────
export function parseBadges(s) {
  return String(s || '')
    .split(',')
    .filter(Boolean)
    .map((b) => b.split('/'))
    .map(([set, v]) => [set, v || '1']);
}
/** "25:0-4,6-10/1902:12-16" → [[start, end, id], ...] (code-point offsets), in order. */
export function parseEmoteRanges(tag) {
  if (!tag) return [];
  const out = [];
  for (const part of tag.split('/')) {
    const [id, ranges] = part.split(':');
    if (!id || !ranges) continue;
    for (const r of ranges.split(',')) {
      const [a, b] = r.split('-').map(Number);
      if (Number.isFinite(a) && Number.isFinite(b)) out.push([a, b, id]);
    }
  }
  return out.sort((x, y) => x[0] - y[0]);
}

const TIERS = { 1000: 'Tier 1', 2000: 'Tier 2', 3000: 'Tier 3', Prime: 'Prime' };

/**
 * Which pane a line belongs to. Events beat everything; then bots; then commands; then mods
 * (and the broadcaster); everyone else is chat.
 */
export function classify({ login, text, badges, isMod }, { botLogins, prefix }) {
  const isBroadcaster = badges.some(([set]) => set === 'broadcaster');
  if (botLogins.has(login) && !isBroadcaster) return 'bot'; // the streamer is never "a bot", even when Steez chats as them
  if (prefix && text.startsWith(prefix)) return 'command';
  if (isMod || badges.some(([set]) => set === 'broadcaster' || set === 'moderator')) return 'mod';
  return 'chat';
}

export function createChatFeed(bot) {
  const ctxOf = () => {
    const ignored = (db.settings.general.ignoredUsers || []).map(normLogin);
    // 'steezzzbot' is the shared SteezBot account; it counts as a bot even before the relay says so.
    const botLogins = new Set([...ignored, 'steezzzbot', bot.relay?.info?.login, bot.state?.botLogin, getAccount('bot')?.login].filter(Boolean).map((x) => String(x).toLowerCase()));
    const b = DEMO ? { login: DEMO[2] } : getAccount('broadcaster');
    if (bot.irc.creds && bot.irc.creds.login !== b?.login) botLogins.add(bot.irc.creds.login);
    return { botLogins, prefix: bot.prefix || '!', me: (b?.login || '').toLowerCase() };
  };

  function push(item) {
    item.n = ++seq;
    item.t ||= Date.now();
    recent.push(item);
    if (recent.length > KEEP) recent.splice(0, recent.length - KEEP);
    broadcast('chatfeed', item, { dashboardOnly: true });
  }

  function fromChat(tags, login, text) {
    const c = ctxOf();
    // our own line coming back from Twitch: the real one replaces the stand-in we'd otherwise show
    if (login === c.me) {
      const i = pendingSelf.findIndex((p) => p.text === text.replace(/^\x01ACTION (.*)\x01$/, '$1'));
      if (i >= 0) clearTimeout(pendingSelf.splice(i, 1)[0].timer);
    }
    let action = false;
    if (text.startsWith('\x01ACTION ')) {
      action = true;
      text = text.slice(8).replace(/\x01$/, '');
    }
    const badges = parseBadges(tags.badges);
    const user = { login, display: tags['display-name'] || login, color: tags.color || '', id: tags['user-id'] || '', badges };
    const bits = Number(tags.bits) || 0;
    let cat = classify({ login, text, badges, isMod: tags.mod === '1' }, c);
    if (bits) cat = 'event';
    const item = {
      id: tags.id || `l${seq + 1}`,
      t: Number(tags['tmi-sent-ts']) || Date.now(),
      kind: 'chat',
      cat,
      user,
      text,
      emotes: parseEmoteRanges(tags.emotes),
      action,
      bits,
      first: tags['first-msg'] === '1',
      highlight: tags['msg-id'] === 'highlighted-message',
      mention: !!c.me && login !== c.me && new RegExp(`(^|\\W)@?${c.me}(\\W|$)`, 'i').test(text),
    };
    if (bits) item.event = { type: 'cheer', text: `${user.display} cheered ${bits} bit${bits === 1 ? '' : 's'}` };
    if (tags['reply-parent-msg-id']) {
      item.reply = { login: tags['reply-parent-user-login'], display: tags['reply-parent-display-name'] || tags['reply-parent-user-login'], text: tags['reply-parent-msg-body'] || '' };
      const p = `@${item.reply.login} `;
      if (text.toLowerCase().startsWith(p.toLowerCase())) item.text = text.slice(p.length);
      // a reply must not shift the emote positions we just read
      if (item.text !== text) item.emotes = item.emotes.map(([a, b, id]) => [a - [...p].length, b - [...p].length, id]).filter(([a]) => a >= 0);
    }
    push(item);
  }

  function fromNotice(tags, text) {
    const id = tags['msg-id'];
    const anon = /^anon/.test(id) || tags.login === 'ananonymousgifter';
    const display = anon ? 'Anonymous' : tags['display-name'] || tags.login || '';
    let system = tags['system-msg'] || '';
    let type = id;
    if (id === 'sub' || id === 'resub') {
      const months = Number(tags['msg-param-cumulative-months']) || 1;
      system = `${display} subscribed with ${TIERS[tags['msg-param-sub-plan']] || 'Tier 1'}.${months > 1 ? ` They've subscribed for ${months} months!` : ''}`;
    } else if (id === 'raid') {
      system = `${tags['msg-param-displayName'] || display} is raiding with a party of ${tags['msg-param-viewerCount'] || 0}.`;
    } else if (id === 'announcement') type = 'announcement';
    push({
      id: tags.id || `n${seq + 1}`,
      t: Number(tags['tmi-sent-ts']) || Date.now(),
      kind: 'notice',
      cat: 'event',
      user: { login: tags.login || '', display, color: tags.color || '', id: tags['user-id'] || '', badges: parseBadges(tags.badges) },
      text: text || '',
      emotes: parseEmoteRanges(tags.emotes),
      event: { type, text: system, color: tags['msg-param-color'] || '' },
    });
  }

  function systemEvent(type, display, login, system, text = '') {
    push({ id: `e${seq + 1}`, kind: 'notice', cat: 'event', user: { login, display, color: '', id: '', badges: [] }, text, emotes: [], event: { type, text: system } });
  }

  // ─── Hooks (before the bot's own filters, so nothing is missing) ─────
  bot.irc.on('message', ({ tags, login, text }) => {
    try {
      fromChat(tags, String(login).toLowerCase(), text);
    } catch (e) {
      log.warn('Chat feed: could not read a message', e);
    }
  });
  // Lines this connection sends itself (Twitch doesn't echo them back to us).
  bot.irc.on('sent', (text) => {
    const login = bot.irc.creds?.login || 'bot';
    push({ id: `s${seq + 1}`, kind: 'chat', cat: 'bot', user: { login, display: bot.state.botLogin || login, color: '', id: '', badges: [] }, text, emotes: [], self: true });
  });
  bot.irc.on('usernotice', ({ tags, text }) => {
    try {
      fromNotice(tags, text);
    } catch (e) {
      log.warn('Chat feed: could not read an event', e);
    }
  });
  bot.irc.on('clearmsg', ({ tags }) => {
    const id = tags['target-msg-id'];
    for (const m of recent) if (m.id === id) m.deleted = true;
    broadcast('chatfeed:del', { id }, { dashboardOnly: true });
  });
  bot.irc.on('clearchat', ({ tags, login }) => {
    if (login) for (const m of recent) if (m.user?.login === login && m.kind === 'chat') m.deleted = true;
    const secs = Number(tags['ban-duration']) || 0;
    broadcast('chatfeed:del', { login, all: !login }, { dashboardOnly: true });
    if (login) systemEvent(secs ? 'timeout' : 'ban', login, login, secs ? `${login} has been timed out for ${fmtSecs(secs)}.` : `${login} has been permanently banned.`);
    else systemEvent('clear', '', '', 'Chat was cleared by a moderator.');
  });
  bot.on('eventsub:channel.follow', (e) => systemEvent('follow', e.user_name, e.user_login, `${e.user_name} followed the channel!`));
  bot.on('eventsub:channel.channel_points_custom_reward_redemption.add', (e) =>
    systemEvent('redeem', e.user_name, e.user_login, `${e.user_name} redeemed ${e.reward.title} (${Number(e.reward.cost).toLocaleString()})`, e.user_input || ''),
  );

  // ─── Badges and emotes ──────────────────────────────────────────────
  let assets = { channel: null, badges: {}, emotes: {}, counts: {}, at: 0 };
  let loading = null;

  async function getJson(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
    return r.json();
  }

  // Twitch's badge images: every global badge (mod, VIP, Prime…) and the channel's own sub and bits
  // badges. Read through the streamer's Twitch login; without one, from a public mirror of the
  // same Twitch data (api.ivr.fi).
  async function loadBadges(channelId, login) {
    const out = {};
    const add = (list) => {
      for (const set of Array.isArray(list) ? list : []) for (const v of set.versions || []) out[`${set.set_id}/${v.id}`] = [v.image_url_1x, v.image_url_2x, v.title];
    };
    try {
      if (DEMO) throw new Error('preview');
      add((await helix('broadcaster', 'GET', '/chat/badges/global'))?.data);
      add((await helix('broadcaster', 'GET', '/chat/badges', { query: { broadcaster_id: channelId } }))?.data);
    } catch {
      const [g, c] = await Promise.all([getJson('https://api.ivr.fi/v2/twitch/badges/global').catch(() => null), getJson(`https://api.ivr.fi/v2/twitch/badges/channel?login=${encodeURIComponent(login)}`).catch(() => null)]);
      add(g);
      add(c);
    }
    return out;
  }

  // name → [url1x, url2x, width, height, zeroWidth, provider]. Later sources win, so the order is
  // global FFZ, global BTTV, global 7TV, then the channel's FFZ, BTTV and 7TV.
  async function loadEmotes(channelId) {
    const map = {};
    const counts = { '7tv': 0, bttv: 0, ffz: 0 };
    const set = (name, e, src) => {
      if (!name) return;
      if (!map[name]) counts[src]++;
      else if (map[name][5] !== src) (counts[map[name][5]]--, counts[src]++);
      map[name] = e;
    };
    const seven = (list) => {
      for (const e of list || []) {
        const host = e.data?.host;
        if (!host?.url) continue;
        const one = host.files?.find((f) => f.name === '1x.webp') || host.files?.[0];
        const zw = !!((e.flags & 1) || (e.data?.flags & 256));
        set(e.name, [`https:${host.url}/1x.webp`, `https:${host.url}/2x.webp`, one?.width || 28, one?.height || 28, zw, '7tv'], '7tv');
      }
    };
    const bttv = (list) => {
      for (const e of list || []) set(e.code, [`https://cdn.betterttv.net/emote/${e.id}/1x.webp`, `https://cdn.betterttv.net/emote/${e.id}/2x.webp`, e.width || 28, e.height || 28, false, 'bttv'], 'bttv');
    };
    const ffz = (sets) => {
      for (const s of Object.values(sets || {}))
        for (const e of s.emoticons || []) {
          const u = e.urls || {};
          set(e.name, [u['1'], u['2'] || u['1'], e.width || 28, e.height || 28, false, 'ffz'], 'ffz');
        }
    };
    const safe = (p) => p.catch((err) => (log.info(`Chat emotes: ${err.message}`), null));
    const [fg, bg, sg, fc, bc, sc] = await Promise.all([
      safe(getJson('https://api.frankerfacez.com/v1/set/global')),
      safe(getJson('https://api.betterttv.net/3/cached/emotes/global')),
      safe(getJson('https://7tv.io/v3/emote-sets/global')),
      safe(getJson(`https://api.frankerfacez.com/v1/room/id/${channelId}`)),
      safe(getJson(`https://api.betterttv.net/3/cached/users/twitch/${channelId}`)),
      safe(getJson(`https://7tv.io/v3/users/twitch/${channelId}`)),
    ]);
    if (fg) ffz(Object.fromEntries((fg.default_sets || []).map((id) => [id, fg.sets?.[id]])));
    if (bg) bttv(bg);
    if (sg) seven(sg.emotes);
    if (fc) ffz(fc.sets);
    if (bc) bttv([...(bc.channelEmotes || []), ...(bc.sharedEmotes || [])]);
    if (sc) seven(sc.emote_set?.emotes);
    return { map, counts, sevenSet: sc?.emote_set?.id || null };
  }

  async function load() {
    const b = DEMO ? { userId: DEMO[1], login: DEMO[2] } : getAccount('broadcaster');
    if (!b?.userId) return assets;
    const [badges, emotes] = await Promise.all([loadBadges(b.userId, b.login).catch((e) => (log.info(`Chat badges: ${e.message}`), assets.badges)), loadEmotes(b.userId)]);
    assets = { channel: { id: b.userId, login: b.login }, badges, emotes: emotes.map, counts: emotes.counts, at: Date.now() };
    broadcast('chatfeed:assets', assets, { dashboardOnly: true });
    watchSeven(emotes.sevenSet);
    log.info(`Chat: ${Object.keys(badges).length} badges, emotes 7TV ${emotes.counts['7tv']} · BTTV ${emotes.counts.bttv} · FFZ ${emotes.counts.ffz}`);
    return assets;
  }
  const reload = () => (loading ||= load().finally(() => (loading = null)));

  // 7TV tells us right away when the channel's emote set changes.
  let seven = { ws: null, set: null, retry: 0, timer: null };
  function watchSeven(setId) {
    if (!setId || seven.set === setId) return;
    seven.set = setId;
    seven.ws?.close();
    const open = () => {
      const ws = (seven.ws = new WebSocket('wss://events.7tv.io/v3'));
      ws.on('open', () => {
        seven.retry = 0;
        ws.send(JSON.stringify({ op: 35, d: { type: 'emote_set.update', condition: { object_id: setId } } }));
      });
      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.op === 0) {
          clearTimeout(seven.timer);
          seven.timer = setTimeout(reload, 1500);
        }
      });
      ws.on('error', () => {});
      ws.on('close', () => {
        if (seven.ws !== ws || seven.set !== setId) return;
        setTimeout(open, Math.min(120_000, 5000 * 2 ** seven.retry++)).unref?.();
      });
    };
    open();
  }

  // ─── Chatting as the streamer (from the Twitch Chat page or the OBS dock) ───────
  // A small extra chat connection logged in as the streamer, only for sending. Twitch shows the
  // line to everyone, including our reading connection; if it doesn't come back within a few
  // seconds we show it ourselves.
  let sender = null;
  const pendingSelf = [];
  function getSender() {
    const b = getAccount('broadcaster');
    if (!b) throw new Error('Connect your Twitch channel in Steez → Settings to chat from here.');
    if (sender && sender.creds?.login === b.login.toLowerCase()) return sender;
    sender?.disconnect();
    sender = new TwitchIRC();
    sender.on('authfail', () => log.warn('Twitch Chat: your Twitch login was refused for sending. Reconnect your channel in Settings.'));
    sender.on('error', () => {});
    sender.connect({ login: b.login, token: b.accessToken, channel: b.login });
    return sender;
  }
  function say(raw) {
    let text = String(raw || '').replace(/[\r\n]+/g, ' ').trim();
    if (!text) throw new Error('Type a message first.');
    if (text.length > 500) throw new Error('Twitch messages can be up to 500 characters.');
    let action = false;
    if (/^\/me\s+/i.test(text)) {
      action = true;
      text = text.replace(/^\/me\s+/i, '');
    } else if (text.startsWith('/') && !text.startsWith('//')) throw new Error('Slash commands other than /me don’t work from here. Use the mod buttons on a message instead.');
    const s = getSender();
    s.say(text, { action });
    const b = getAccount('broadcaster');
    const entry = { text, timer: null };
    entry.timer = setTimeout(() => {
      const i = pendingSelf.indexOf(entry);
      if (i < 0) return;
      pendingSelf.splice(i, 1);
      const us = s.userstate || {};
      const login = b.login.toLowerCase();
      const badges = parseBadges(us.badges || 'broadcaster/1');
      push({ id: `me${seq + 1}`, kind: 'chat', cat: classify({ login, text, badges, isMod: true }, ctxOf()), user: { login, display: us['display-name'] || b.login, color: us.color || '', id: b.userId || '', badges }, text, emotes: [], action });
    }, 3000);
    pendingSelf.push(entry);
    if (pendingSelf.length > 20) clearTimeout(pendingSelf.shift().timer);
    return true;
  }
  onAuthChange(() => {
    sender?.disconnect();
    sender = null;
  });
  bot.action('chatfeed:say', ({ text }) => say(text));

  onAuthChange(() => setTimeout(reload, 1500));
  setTimeout(reload, 3000);
  setInterval(reload, 30 * 60_000).unref?.();

  bot.action('chatfeed:recent', async () => ({ items: recent.slice(-KEEP), assets: assets.at ? assets : await reload() }));
  bot.action('chatfeed:refresh', () => reload());
  bot.action('chatfeed:dock', ({ renew } = {}) => (renew && chatDockKey(true), { url: chatDockUrl() }));
  bot.action('chatfeed:mod', async ({ act, id, login, userId, seconds }) => {
    const user = { login: normLogin(login), id: userId || undefined };
    if (act === 'delete') return bot.deleteMessage(String(id));
    if (act === 'timeout') return bot.timeout(user, Number(seconds) || 600, 'Timed out from Steez');
    if (act === 'ban') return bot.ban(user, 'Banned from Steez');
    throw new Error('Unknown moderation action');
  });
  if (DEMO) import('./chatDemo.js').then(({ startChatDemo }) => startChatDemo(bot, DEMO[2], () => Object.keys(assets.emotes).slice(0, 300)));
  return { recent, reload, push };
}

function fmtSecs(s) {
  if (s % 86400 === 0) return `${s / 86400} day${s === 86400 ? '' : 's'}`;
  if (s % 3600 === 0) return `${s / 3600} hour${s === 3600 ? '' : 's'}`;
  if (s % 60 === 0) return `${s / 60} minute${s === 60 ? '' : 's'}`;
  return `${s} second${s === 1 ? '' : 's'}`;
}
