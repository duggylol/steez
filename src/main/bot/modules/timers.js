// Timed messages: post on an interval, but only when chat has been active enough.
import { db, save } from '../store.js';
import { pick } from '../util.js';

export function init(bot) {
  const state = new Map(); // id -> { lastRun, lines, index }
  bot.on('chat', () => {
    for (const s of state.values()) s.lines++;
  });

  const get = (t) => {
    if (!state.has(t.id)) state.set(t.id, { lastRun: Date.now(), lines: 0, index: 0 });
    return state.get(t.id);
  };

  async function fire(t, force = false) {
    const s = get(t);
    const msgs = (t.messages || []).filter(Boolean);
    if (!msgs.length) return;
    const msg = t.random ? pick(msgs) : msgs[s.index++ % msgs.length];
    s.lastRun = Date.now();
    s.lines = 0;
    const out = await bot.render(msg, {});
    if (t.announce) await bot.announce(out);
    else await bot.say(out);
    if (!force) {
      t.runs = (t.runs || 0) + 1;
      save();
    }
  }

  setInterval(() => {
    if (!bot.state.ircConnected || !db.settings.general.botEnabled) return;
    for (const t of db.timers) {
      if (!t.enabled) continue;
      if (t.onlineOnly !== false && !bot.state.live) continue;
      const s = get(t);
      if (Date.now() - s.lastRun < (t.intervalMinutes || 15) * 60000) continue;
      if (s.lines < (t.minLines ?? 5)) continue;
      fire(t);
    }
  }, 15_000);

  bot.action('timer:fire', ({ id }) => {
    const t = db.timers.find((x) => x.id === id);
    if (!t) throw new Error('Timer not found');
    return fire(t, true);
  });
}
