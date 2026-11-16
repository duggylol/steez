// Every Steez feature that can act on its own (talk in chat, connect somewhere, take events)
// has one on/off switch here. Everything starts OFF — streamers turn on what they want.
//
// Modules register their own switch through ctx.features.register(); the chat-bot parts are
// registered below. `resetAllOff` runs once per install (also on existing installs, the first
// time a Steez with this file starts) and switches everything off.

export function createFeatures({ onChange, log } = {}) {
  const list = [];
  const notify = () => {
    try {
      onChange?.(describe());
    } catch {
      /* ignore */
    }
  };
  function describe() {
    return list.map((f) => {
      let on = false;
      try {
        on = !!f.get();
      } catch {
        /* ignore */
      }
      return { id: f.id, name: f.name, group: f.group || 'Features', description: f.description || '', page: f.page || '', needs: f.needs || null, on };
    });
  }
  return {
    register(f) {
      if (!f || !f.id || typeof f.get !== 'function' || typeof f.set !== 'function') throw new Error('feature needs id, get, set');
      const i = list.findIndex((x) => x.id === f.id);
      if (i >= 0) list.splice(i, 1, f);
      else list.push(f);
    },
    list: describe,
    get: (id) => describe().find((f) => f.id === id) || null,
    async set(id, on) {
      const f = list.find((x) => x.id === id);
      if (!f) throw new Error('Unknown feature: ' + id);
      await f.set(!!on);
      log?.info?.(`Feature ${f.name} turned ${on ? 'on' : 'off'}`);
      notify();
      return describe();
    },
    /** Turn every feature off (one-time reset). Errors in one feature don't stop the rest. */
    async resetAllOff() {
      for (const f of list) {
        try {
          await f.set(false);
        } catch (e) {
          log?.warn?.(`Could not turn off ${f.name}: ${e.message}`);
        }
      }
      notify();
    },
    notify,
  };
}

/** The chat-bot features (settings live in the bot database). */
export function registerBotFeatures(features, { db, save, bot }) {
  const S = () => db.settings;
  const flag = (id, name, description, page, path, extra = {}) =>
    features.register({
      id,
      name,
      description,
      page,
      group: 'Chat bot',
      ...extra,
      get: () => !!path.split('.').reduce((o, k) => (o ? o[k] : undefined), S()),
      set: (on) => {
        const keys = path.split('.');
        const last = keys.pop();
        const obj = keys.reduce((o, k) => (o[k] ||= {}), S());
        obj[last] = on;
        save();
      },
    });

  flag('chatbot', 'Chat bot', 'Your commands, timers, quotes, giveaways, polls and channel-point replies in chat.', 'commands', 'general.botEnabled');
  features.register({
    id: 'alerts',
    name: 'Chat alerts',
    description: 'Thank-you messages in chat for follows, subs, gift subs, cheers, raids, first-time chatters and ad breaks.',
    page: 'alerts',
    group: 'Chat bot',
    get: () => Object.entries(S().events || {}).some(([k, v]) => k !== 'streamOnline' && v && v.enabled),
    set: (on) => {
      for (const [k, v] of Object.entries(S().events || {})) {
        if (!v || typeof v !== 'object' || !('enabled' in v)) continue;
        if (on && k === 'streamOnline') continue; // the "we are live" message stays your call
        v.enabled = on;
      }
      save();
    },
  });
  flag('loyalty', 'Loyalty points', 'Viewers earn points for watching and chatting.', 'loyalty', 'loyalty.enabled');
  features.register({
    id: 'games',
    name: 'Chat games',
    description: 'Gamble, duel, heist, roulette, fishing, check-ins, trivia and more.',
    page: 'games',
    group: 'Chat bot',
    needs: 'chatbot',
    get: () => Object.values(S().games || {}).some((g) => g && g.enabled),
    set: (on) => {
      for (const g of Object.values(S().games || {})) if (g && typeof g === 'object' && 'enabled' in g) g.enabled = on;
      save();
    },
  });
  flag('moderation', 'Chat moderation', 'Removes links, caps, symbol and emote spam, banned words and spam bots.', 'moderation', 'moderation.enabled');
  flag('shield', 'Follow-bot shield', 'Locks chat down automatically during a follow-bot attack.', 'moderation', 'shield.followBotProtection');
  flag('shop', 'Points shop', 'Viewers spend points on on-stream effects.', 'shop', 'shop.enabled', { needs: 'chatbot' });
  flag('hype', 'Hype clips', 'Spots hype moments in chat and clips them.', 'hype', 'hype.enabled');
  flag('achievements', 'Achievements', 'Viewers unlock badges for milestones.', 'achievements', 'achievements.enabled');
  flag('ai', 'AI', 'Answers @mentions in chat and can control Steez when allowed.', 'ai', 'ai.enabled');
  features.register({
    id: 'modpanel',
    name: 'Mod Panel',
    description: 'Lets your mods change things from their browser while Steez is open.',
    page: 'modpanel',
    group: 'Chat bot',
    get: () => !!S().modPanel?.enabled,
    set: async (on) => {
      S().modPanel.enabled = on;
      save();
      try {
        await bot.runAction('modpanel:apply');
      } catch {
        /* the link isn't started yet */
      }
    },
  });
}
