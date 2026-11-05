// Viewer achievements — unlocked by stats or by events from other modules (bot.emit('achievement:unlock', login, id)).
import { db, save, findUser } from '../store.js';
import { broadcast } from '../web/hub.js';
import { normLogin } from '../util.js';

export const ACHIEVEMENTS = [
  { id: 'first_words', name: 'First Words', icon: '💬', desc: 'Send your first message', check: (u) => u.messages >= 1 },
  { id: 'chatterbox', name: 'Chatterbox', icon: '🗣️', desc: 'Send 100 messages', check: (u) => u.messages >= 100 },
  { id: 'motormouth', name: 'Motormouth', icon: '📣', desc: 'Send 1,000 messages', check: (u) => u.messages >= 1000 },
  { id: 'keyboard_warrior', name: 'Keyboard Warrior', icon: '⌨️', desc: 'Send 10,000 messages', check: (u) => u.messages >= 10000 },
  { id: 'settling_in', name: 'Settling In', icon: '🛋️', desc: 'Watch for 1 hour', check: (u) => u.watchMinutes >= 60 },
  { id: 'couch_potato', name: 'Couch Potato', icon: '🥔', desc: 'Watch for 10 hours', check: (u) => u.watchMinutes >= 600 },
  { id: 'furniture', name: 'Part of the Furniture', icon: '🪑', desc: 'Watch for 100 hours', check: (u) => u.watchMinutes >= 6000 },
  { id: 'dedicated', name: 'Dedicated', icon: '📅', desc: '7-day check-in streak', check: (u) => (u.checkin?.best || 0) >= 7 },
  { id: 'devoted', name: 'Devoted', icon: '🗓️', desc: '30-day check-in streak', check: (u) => (u.checkin?.best || 0) >= 30 },
  { id: 'high_roller', name: 'High Roller', icon: '💰', desc: 'Hold 10,000 points', check: (u) => u.points >= 10000 },
  { id: 'millionaire', name: 'Millionaire', icon: '🤑', desc: 'Hold 1,000,000 points', check: (u) => u.points >= 1000000 },
  { id: 'duelist', name: 'Duelist', icon: '⚔️', desc: 'Win 10 duels', check: (u) => (u.stats?.duelWins || 0) >= 10 },
  { id: 'angler', name: 'Master Angler', icon: '🎣', desc: 'Catch 100 fish', check: (u) => (u.fish?.catches || 0) >= 100 },
  { id: 'philanthropist', name: 'Philanthropist', icon: '🎁', desc: 'Give away 5,000 points', check: (u) => (u.stats?.given || 0) >= 5000 },
  { id: 'early_bird', name: 'Early Bird', icon: '🥇', desc: 'First chatter of a stream' },
  { id: 'night_owl', name: 'Night Owl', icon: '🦉', desc: 'Chat between 2 and 5 AM (streamer time)' },
  { id: 'jackpot', name: 'Jackpot!', icon: '🎰', desc: 'Hit the slots jackpot' },
  { id: 'all_in_win', name: 'Fortune Favors the Bold', icon: '🎲', desc: 'Win a gamble going all-in' },
  { id: 'kraken', name: 'Release the Kraken', icon: '🐙', desc: 'Catch a legendary fish' },
  { id: 'boss_slayer', name: 'Boss Slayer', icon: '🐉', desc: 'Be the MVP against a raid boss' },
  { id: 'heist_survivor', name: 'Smooth Criminal', icon: '🕶️', desc: 'Survive a heist' },
  { id: 'lucky', name: 'Lucky Winner', icon: '🍀', desc: 'Win a giveaway' },
  { id: 'trivia_whiz', name: 'Big Brain', icon: '🧠', desc: 'Win 10 trivia rounds' },
  { id: 'dodged_bullet', name: 'Dodged a Bullet', icon: '🔫', desc: 'Survive roulette 5 times in a row' },
  { id: 'raider', name: 'Raid Leader', icon: '🚨', desc: 'Raid the channel' },
  { id: 'generous', name: 'Generous Soul', icon: '💝', desc: 'Gift a sub' },
];

export function init(bot) {
  const C = () => db.settings.achievements;
  const byId = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
  let pending = []; // batched announcements

  function unlock(login, id) {
    if (!C().enabled) return;
    const u = findUser(login);
    const a = byId.get(id);
    if (!u || !a) return;
    u.achievements ||= {};
    if (u.achievements[id]) return;
    u.achievements[id] = Date.now();
    if (C().rewardPoints) u.points += C().rewardPoints;
    save();
    pending.push({ user: u.display, a });
    broadcast('alert', { type: 'achievement', user: u.display, message: `${a.icon} ${a.name}`, t: Date.now() });
  }
  bot.on('achievement:unlock', unlock);

  setInterval(() => {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    if (!C().announce) return;
    if (batch.length === 1) bot.say(`🏆 ${batch[0].user} unlocked "${batch[0].a.name}" ${batch[0].a.icon} — ${batch[0].a.desc}!`);
    else bot.say(`🏆 Achievements unlocked: ${batch.slice(0, 8).map((b) => `${b.user} → ${b.a.icon} ${b.a.name}`).join(' | ')}${batch.length > 8 ? ` +${batch.length - 8} more` : ''}`);
  }, 8000);

  const checkStats = (u) => {
    if (!u) return;
    for (const a of ACHIEVEMENTS) if (a.check && !u.achievements?.[a.id] && a.check(u)) unlock(u.login, a.id);
  };

  bot.on('chat', (ctx) => {
    checkStats(ctx.record);
    const tz = db.settings.general.timezone || undefined;
    let hour;
    try {
      hour = Number(new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));
    } catch {
      hour = new Date().getHours();
    }
    if (bot.state.live && hour >= 2 && hour < 5) unlock(ctx.user.login, 'night_owl');
  });
  bot.on('points:changed', checkStats);
  bot.on('loyalty:tick', (chatters) => {
    for (const c of chatters) checkStats(findUser(c.login));
  });

  bot.command('achievements', {
    description: 'Your achievements',
    usage: '!achievements [user]',
    aliases: ['achieve', 'badges'],
    userCooldown: 15,
    handler: (ctx, args) => {
      const u = findUser(normLogin(args[0]) || ctx.user.login);
      const got = Object.keys(u?.achievements || {}).filter((id) => byId.has(id));
      if (!got.length) return bot.reply(ctx, `no achievements yet — there are ${ACHIEVEMENTS.length} to find!`);
      bot.reply(ctx, `${u.display} has ${got.length}/${ACHIEVEMENTS.length}: ${got.map((id) => byId.get(id).icon).join('')} (latest: ${byId.get(got.sort((a, b) => u.achievements[b] - u.achievements[a])[0]).name})`);
    },
  });
}
