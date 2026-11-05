// Sends the bot's chat messages as the shared SteezBot account through the Steez relay
// (relay/src/index.js on Cloudflare). Falls back to the normal IRC connection (the streamer's
// own account) whenever the relay can't be used, so chat never goes quiet.
import { db } from '../store.js';
import { config } from '../config.js';
import { getAccount, hasScope } from './auth.js';
import { log } from '../logger.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PACE_MS = 1100; // ~20 messages / 30s, Twitch's chat limit for a non-mod sender

export function createRelay(bot) {
  let info = null; // { id, login, display } of SteezBot
  let downUntil = 0;
  let lastError = null;
  let lastWarn = 0;
  const queue = [];
  let pumping = false;

  const warn = (msg) => {
    lastError = msg;
    if (Date.now() - lastWarn > 60_000) {
      lastWarn = Date.now();
      log.warn(msg);
    }
  };

  /** The streamer chose SteezBot and hasn't connected their own custom bot account. */
  const wanted = () => !!config.relayUrl && (db.settings.general.botIdentity || 'steezbot') === 'steezbot' && !(db.auth.bot && !db.auth.bot.expired);
  const missingScope = () => !!getAccount('broadcaster') && !hasScope('broadcaster', 'channel:bot');
  const active = () => wanted() && !!info && Date.now() > downUntil && !!getAccount('broadcaster') && !missingScope();

  async function refresh() {
    if (!config.relayUrl) return null;
    try {
      const r = await fetch(`${config.relayUrl}/v1/status`, { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      if (j.ok && j.bot) {
        info = j.bot;
        lastError = null;
      } else warn(`SteezBot relay: ${j.message || j.error || 'not ready'}`);
    } catch (e) {
      warn(`SteezBot relay unreachable (${e.message}) — messages go out from your own account.`);
    }
    return info;
  }

  async function post(item) {
    const acct = getAccount('broadcaster');
    const r = await fetch(`${config.relayUrl}/v1/say`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${acct.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: item.text, replyTo: item.replyTo }),
      signal: AbortSignal.timeout(10_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(j.hint || j.message || j.error || `HTTP ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return j;
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    while (queue.length) {
      const item = queue.shift();
      if (Date.now() - item.t > 30_000) continue; // stale
      if (!active()) {
        bot.irc.say(item.text, { replyTo: item.replyTo });
        continue;
      }
      try {
        const res = await post(item);
        if (res.sent === false && res.dropReason) log.warn(`Twitch held back a SteezBot message: ${res.dropReason}`);
      } catch (e) {
        if (e.status === 429) {
          queue.unshift(item);
          await sleep(3000);
          continue;
        }
        downUntil = Date.now() + 60_000;
        warn(`SteezBot couldn't send (${e.message}) — using your account for the next minute.`);
        bot.irc.say(item.text, { replyTo: item.replyTo });
      }
      await sleep(PACE_MS);
    }
    pumping = false;
  }

  setInterval(refresh, 30 * 60_000).unref();

  return {
    refresh,
    wanted,
    active,
    get info() {
      return info;
    },
    send(text, { replyTo } = {}) {
      queue.push({ text, replyTo, t: Date.now() });
      if (queue.length > 50) queue.shift();
      pump();
    },
    status: () => ({
      configured: !!config.relayUrl,
      wanted: wanted(),
      active: active(),
      bot: info,
      missingScope: missingScope(),
      error: lastError,
    }),
  };
}
