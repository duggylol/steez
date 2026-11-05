// Boots the chat-bot core inside Steez's main process.
// Must be imported AFTER process.env.STEEZ_BOT_DATA is set (store.js reads it on load).
import { log } from './logger.js';
import { bot } from './core/bot.js';
import { getAccount, setBrowserOpener } from './twitch/auth.js';

import * as stream from './modules/stream.js';
import * as commands from './modules/commands.js';
import * as timers from './modules/timers.js';
import * as moderation from './modules/moderation.js';
import * as loyalty from './modules/loyalty.js';
import * as games from './modules/games.js';
import * as boss from './modules/boss.js';
import * as minigames from './modules/minigames.js';
import * as giveaways from './modules/giveaways.js';
import * as quotes from './modules/quotes.js';
import * as polls from './modules/polls.js';
import * as events from './modules/events.js';
import * as shop from './modules/shop.js';
import * as hype from './modules/hype.js';
import * as ai from './modules/ai.js';
import * as achievements from './modules/achievements.js';
import * as stats from './modules/stats.js';

export const MODULES = { stream, commands, timers, moderation, loyalty, games, boss, minigames, giveaways, quotes, polls, events, shop, hype, ai, achievements, stats };

let started = false;
export async function startBot({ openUrl } = {}) {
  if (started) return bot;
  started = true;
  if (openUrl) setBrowserOpener(openUrl);
  await bot.init();
  for (const [name, m] of Object.entries(MODULES)) {
    try {
      m.init(bot);
    } catch (e) {
      log.error(`Bot module "${name}" failed to load`, e);
    }
  }
  log.info(`Chat bot ready: ${Object.keys(MODULES).length} modules, ${bot.builtins.size} built-in commands.`);
  return bot;
}

/** Called once the rest of Steez (SongSeek/QueueUp commands) has registered. */
export function connectBot() {
  if (getAccount('broadcaster')) {
    bot.connectChat();
    bot.startEventSub();
  }
  bot.emit('ready');
}

export { bot };
