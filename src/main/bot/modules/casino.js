// !casino posts the link to the web casino, where viewers log in with Twitch and play with their
// points. The games themselves run in ../casino/service.js, reached through the Steez relay.
import { db, save } from '../store.js';
import { config } from '../config.js';
import { getAccount } from '../twitch/auth.js';
import { casinoStats } from '../casino/service.js';

/** Where the casino lives: what the relay told us when we connected, else steezgames.xyz. */
export function casinoBase() {
  return String(db.casino?.base || config.casinoUrl || (config.relayUrl ? `${config.relayUrl}/casino` : '')).replace(/\/+$/, '');
}
export function setCasinoBase(url) {
  if (typeof url !== 'string' || !/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(url)) return;
  db.casino ||= {};
  if (db.casino.base !== url) {
    db.casino.base = url;
    save();
  }
}
export function casinoLink() {
  const base = casinoBase();
  const login = getAccount('broadcaster')?.login;
  return base && login ? `${base}/${login.toLowerCase()}` : null;
}

export function init(bot) {
  const C = () => db.settings.casino;
  bot.command('casino', {
    description: 'Link to the points casino website',
    usage: '!casino',
    cooldown: 10,
    handler: (ctx) => {
      if (!C().enabled) return false;
      const url = casinoLink();
      if (!url) return bot.reply(ctx, 'the casino isn’t set up yet.'), false;
      bot.reply(ctx, `🎰 Play with your ${bot.currency} at ${url} — log in with Twitch. Free to play, nothing to buy.`);
    },
  });
  bot.action('casino:status', () => ({ enabled: !!C().enabled, link: casinoLink(), base: casinoBase() }));
  bot.action('casino:stats', () => casinoStats());
}
