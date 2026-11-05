// Points games: gamble, slots, duel, heist, roulette, fishing, daily check-in.
import { db, save, findUser, getUser, bumpStat } from '../store.js';
import { parseAmount, randInt, pick, weightedPick, fmtNum, normLogin, todayKey, fmtDuration } from '../util.js';

const FISH = [
  { tier: 'trash', weight: 22, names: ['an old boot', 'a soggy sock', 'a tin can', 'a tangle of seaweed', 'a rubber duck'], min: 0, max: 2, emoji: '🥾' },
  { tier: 'common', weight: 40, names: ['a minnow', 'a sardine', 'a perch', 'a sunfish', 'a carp'], min: 5, max: 25, emoji: '🐟' },
  { tier: 'uncommon', weight: 22, names: ['a bass', 'a trout', 'a catfish', 'a pike'], min: 25, max: 70, emoji: '🐠' },
  { tier: 'rare', weight: 10, names: ['a salmon', 'a swordfish', 'a tuna', 'a pufferfish'], min: 70, max: 180, emoji: '🐡' },
  { tier: 'epic', weight: 4.5, names: ['a golden koi', 'a giant squid', 'an anglerfish'], min: 200, max: 600, emoji: '🦑' },
  { tier: 'legendary', weight: 1.2, names: ['THE KRAKEN', 'a shark wearing sunglasses', 'Nessie herself'], min: 1000, max: 3000, emoji: '🐙' },
  { tier: 'mythic', weight: 0.3, names: ['a glowing treasure chest', 'the Golden Leviathan'], min: 5000, max: 10000, emoji: '💎' },
];

export function init(bot) {
  const G = () => db.settings.games;

  function bet(ctx, raw, cfg) {
    const bal = bot.points(ctx.user.login);
    let n = parseAmount(raw, bal);
    if (!(n > 0)) {
      bot.reply(ctx, `usage: !${ctx.commandName} <amount|all|half|50%>`);
      return null;
    }
    if (cfg.maxBet > 0) n = Math.min(n, cfg.maxBet);
    if (n < (cfg.minBet || 1)) {
      bot.reply(ctx, `minimum bet is ${bot.fmtPoints(cfg.minBet)}.`);
      return null;
    }
    if (n > bal) {
      bot.reply(ctx, `you only have ${bot.fmtPoints(bal)}.`);
      return null;
    }
    return n;
  }

  // ─── Gamble ─────────────────────────────────────────────────
  bot.command('gamble', {
    description: 'Roll 1-100. Over the line doubles your bet, 99-100 triples it',
    usage: '!gamble <amount|all|50%>',
    aliases: ['roll', 'bet-points'],
    get userCooldown() {
      return G().gamble.cooldownSeconds;
    },
    handler: (ctx, [amt]) => {
      const cfg = G().gamble;
      if (!cfg.enabled) return false;
      const allIn = /^(all|allin|max)$/i.test(amt || '');
      const n = bet(ctx, amt, cfg);
      if (!n) return false;
      const roll = randInt(1, 100);
      const u = findUser(ctx.user.login);
      if (roll <= cfg.loseUpTo) {
        bot.addPoints(ctx.user.login, -n);
        bumpStat(u, 'gambleLosses');
        bot.reply(ctx, `rolled ${roll} and lost ${bot.fmtPoints(n)} 💸 Now: ${fmtNum(u.points)}.`);
      } else {
        const mult = roll >= cfg.jackpotFrom ? 3 : 2;
        bot.addPoints(ctx.user.login, n * (mult - 1));
        bumpStat(u, 'gambleWins');
        bot.reply(ctx, `rolled ${roll} and won ${bot.fmtPoints(n * mult)}${mult === 3 ? ' — JACKPOT! 🎰' : '!'} 🎉 Now: ${fmtNum(u.points)}.`);
        if (allIn && n >= 100) bot.emit('achievement:unlock', ctx.user.login, 'all_in_win');
      }
    },
  });

  // ─── Slots ──────────────────────────────────────────────────
  bot.command('slots', {
    description: 'Spin the slot machine',
    usage: '!slots <amount>',
    get userCooldown() {
      return G().slots.cooldownSeconds;
    },
    handler: (ctx, [amt]) => {
      const cfg = G().slots;
      if (!cfg.enabled) return false;
      const n = bet(ctx, amt, cfg);
      if (!n) return false;
      const reels = [pick(cfg.symbols), pick(cfg.symbols), pick(cfg.symbols)];
      const counts = {};
      reels.forEach((r) => (counts[r] = (counts[r] || 0) + 1));
      const max = Math.max(...Object.values(counts));
      let mult = 0;
      if (max === 3) mult = reels[0] === cfg.jackpotSymbol ? cfg.jackpotMultiplier : cfg.tripleMultiplier;
      else if (max === 2) mult = cfg.doubleMultiplier;
      const win = Math.floor(n * mult);
      bot.addPoints(ctx.user.login, win - n);
      const line = `[ ${reels.join(' | ')} ]`;
      if (mult >= cfg.jackpotMultiplier) {
        bot.say(`🎰 ${line} 💥 JACKPOT!!! ${ctx.user.display} won ${bot.fmtPoints(win)}!`);
        bot.emit('achievement:unlock', ctx.user.login, 'jackpot');
        bot.overlay('effect', { effect: 'confetti', user: ctx.user.display });
      } else if (mult > 0) bot.reply(ctx, `🎰 ${line} — you won ${bot.fmtPoints(win)}!`);
      else bot.reply(ctx, `🎰 ${line} — no luck, lost ${bot.fmtPoints(n)}.`);
    },
  });

  // ─── Duel ───────────────────────────────────────────────────
  const duels = new Map(); // target login -> {from, amount, expires}
  bot.command('duel', {
    description: 'Challenge someone to a duel for points',
    usage: '!duel <user> <amount>',
    userCooldown: 15,
    handler: (ctx, [who, amt]) => {
      const cfg = G().duel;
      if (!cfg.enabled) return false;
      const target = normLogin(who);
      if (!target || target === ctx.user.login) return bot.reply(ctx, 'usage: !duel <user> <amount>'), false;
      const t = findUser(target);
      if (!t) return bot.reply(ctx, `${target} hasn't chatted here yet.`), false;
      const n = bet(ctx, amt, cfg);
      if (!n) return false;
      if (t.points < n) return bot.reply(ctx, `${t.display} only has ${bot.fmtPoints(t.points)}.`), false;
      duels.set(target, { from: ctx.user, amount: n, expires: Date.now() + cfg.acceptSeconds * 1000 });
      bot.say(`⚔️ ${ctx.user.display} challenges ${t.display} to a duel for ${bot.fmtPoints(n)}! ${t.display}, type !accept or !deny (${cfg.acceptSeconds}s).`);
    },
  });
  bot.command('accept', {
    description: 'Accept a duel',
    handler: (ctx) => {
      const d = duels.get(ctx.user.login);
      if (!d || d.expires < Date.now()) return duels.delete(ctx.user.login), false;
      duels.delete(ctx.user.login);
      if (bot.points(d.from.login) < d.amount || bot.points(ctx.user.login) < d.amount) return bot.say('⚔️ The duel is off — someone no longer has enough points.');
      const winner = Math.random() < 0.5 ? d.from : ctx.user;
      const loser = winner === d.from ? ctx.user : d.from;
      bot.addPoints(winner.login, d.amount);
      bot.addPoints(loser.login, -d.amount);
      const w = findUser(winner.login);
      bumpStat(w, 'duelWins');
      const moves = ['a perfectly timed parry', 'a flying kick', 'a rubber chicken', 'pure aura', 'a critical hit', 'sheer audacity'];
      bot.say(`⚔️ ${winner.display} defeats ${loser.display} with ${pick(moves)} and wins ${bot.fmtPoints(d.amount)}!`);
    },
  });
  bot.command('deny', {
    description: 'Decline a duel',
    handler: (ctx) => {
      const d = duels.get(ctx.user.login);
      if (!d) return false;
      duels.delete(ctx.user.login);
      bot.say(`🏳️ ${ctx.user.display} declined ${d.from.display}'s duel.`);
    },
  });

  // ─── Heist ──────────────────────────────────────────────────
  let heist = null;
  let heistCooldownUntil = 0;
  bot.command('heist', {
    description: 'Start or join a group heist',
    usage: '!heist <amount>',
    aliases: ['bankheist'],
    handler: (ctx, [amt]) => {
      const cfg = G().heist;
      if (!cfg.enabled) return false;
      if (!heist && Date.now() < heistCooldownUntil)
        return bot.reply(ctx, `the cops are still on high alert. Next heist in ${fmtDuration(heistCooldownUntil - Date.now())}.`), false;
      if (heist?.crew.has(ctx.user.login)) return bot.reply(ctx, "you're already in the crew!"), false;
      const n = bet(ctx, amt, cfg);
      if (!n) return false;
      bot.takePoints(ctx.user.login, n);
      if (!heist) {
        heist = { crew: new Map() };
        heist.crew.set(ctx.user.login, { user: ctx.user, amount: n });
        bot.say(`💰 ${ctx.user.display} is planning a heist! Join with !heist <amount> in the next ${cfg.joinSeconds}s.`);
        setTimeout(runHeist, cfg.joinSeconds * 1000);
      } else {
        heist.crew.set(ctx.user.login, { user: ctx.user, amount: n });
        if (heist.crew.size % 3 === 0) bot.say(`💰 The crew grows to ${heist.crew.size}!`);
      }
    },
  });
  function runHeist() {
    const cfg = G().heist;
    const crew = [...heist.crew.values()];
    heist = null;
    heistCooldownUntil = Date.now() + cfg.cooldownMinutes * 60000;
    const tier = [...cfg.tiers].sort((a, b) => b.minPlayers - a.minPlayers).find((t) => crew.length >= t.minPlayers) || cfg.tiers[0];
    const survivors = [];
    for (const m of crew) {
      if (Math.random() * 100 < tier.successPercent) {
        const won = Math.floor(m.amount * tier.payout);
        bot.addPoints(m.user.login, won);
        survivors.push(`${m.user.display} (${fmtNum(won)})`);
        bumpStat(getUser(m.user.login), 'heistsSurvived');
        bot.emit('achievement:unlock', m.user.login, 'heist_survivor');
      }
    }
    setTimeout(() => {
      if (!survivors.length) bot.say(`🚓 The crew of ${crew.length} tried to rob ${tier.name}... and everyone got caught! All bets lost.`);
      else if (survivors.length === crew.length) bot.say(`💎 Flawless heist on ${tier.name}! Everyone escaped: ${survivors.join(', ')}`);
      else bot.say(`💼 The heist on ${tier.name} is over. Survivors: ${survivors.join(', ')}. ${crew.length - survivors.length} got caught.`);
    }, 1500);
    bot.say(`🚨 The crew of ${crew.length} hits ${tier.name}...`);
  }

  // ─── Roulette ───────────────────────────────────────────────
  bot.command('roulette', {
    description: 'Russian roulette — lose and get timed out',
    userCooldown: 30,
    handler: async (ctx) => {
      const cfg = G().roulette;
      if (!cfg.enabled) return false;
      const dead = randInt(1, Math.max(2, cfg.chambers)) === 1;
      const u = findUser(ctx.user.login);
      if (!dead) {
        const streak = bumpStat(u, 'rouletteStreak');
        if (streak >= 5) bot.emit('achievement:unlock', ctx.user.login, 'dodged_bullet');
        return bot.reply(ctx, `🔫 *click* ... you live to chat another day. (streak: ${streak})`);
      }
      u.stats.rouletteStreak = 0;
      save();
      if (bot.hasLevel(ctx.user, 'moderator')) return bot.say(`🔫 BANG! The bullet bounces off ${ctx.user.display}'s mod armor. 🛡️`);
      bot.say(`🔫 BANG! ${ctx.user.display} is gone for ${cfg.timeoutSeconds}s. 💀`);
      await bot.timeout(ctx.user, cfg.timeoutSeconds, 'Lost at roulette');
    },
  });

  // ─── Fishing ────────────────────────────────────────────────
  bot.command('fish', {
    description: 'Go fishing for points and rare catches',
    aliases: ['fishing', 'cast'],
    get userCooldown() {
      return G().fishing.cooldownSeconds;
    },
    handler: (ctx) => {
      if (!G().fishing.enabled) return false;
      const tier = weightedPick(FISH);
      const name = pick(tier.names);
      const size = Math.round((Math.random() * 1.5 + 0.5) * 100) / 10; // 5.0 - 20.0
      const value = Math.round(randInt(tier.min, tier.max) * (size / 10));
      const u = getUser(ctx.user.login, ctx.user.display);
      u.fish ||= { catches: 0, best: null, tiers: {} };
      u.fish.catches++;
      u.fish.tiers[tier.tier] = (u.fish.tiers[tier.tier] || 0) + 1;
      const isBest = !u.fish.best || value > u.fish.best.value;
      if (isBest) u.fish.best = { name, size, value, tier: tier.tier };
      save();
      if (value) bot.addPoints(ctx.user.login, value);
      const msg = `${tier.emoji} ${ctx.user.display} caught ${name} (${size}lb, ${tier.tier}) worth ${bot.fmtPoints(value)}!${isBest && u.fish.catches > 1 ? ' New personal best! 🏅' : ''}`;
      if (['legendary', 'mythic'].includes(tier.tier)) {
        bot.say(`🎣🌊 ${msg} 🌊`);
        bot.overlay('alert', { type: 'fish', user: ctx.user.display, message: `caught ${name}!`, amount: value });
        bot.emit('achievement:unlock', ctx.user.login, 'kraken');
      } else bot.reply(ctx, msg.replace(`${ctx.user.display} caught`, 'you caught'));
    },
  });
  bot.command('fishlog', {
    description: 'Your fishing stats',
    userCooldown: 10,
    handler: (ctx, args) => {
      const u = findUser(normLogin(args[0]) || ctx.user.login);
      if (!u?.fish) return bot.reply(ctx, 'no fish caught yet. Try !fish');
      const t = u.fish.tiers;
      bot.reply(
        ctx,
        `${u.display}: ${u.fish.catches} catches | best: ${u.fish.best.name} (${u.fish.best.size}lb, ${fmtNum(u.fish.best.value)}) | legendary+: ${(t.legendary || 0) + (t.mythic || 0)}, epic: ${t.epic || 0}, rare: ${t.rare || 0}`,
      );
    },
  });

  // ─── Daily check-in ─────────────────────────────────────────
  bot.command('checkin', {
    description: 'Daily reward — keep your streak going!',
    aliases: ['daily'],
    handler: (ctx) => {
      const cfg = G().checkin;
      if (!cfg.enabled) return false;
      const u = getUser(ctx.user.login, ctx.user.display);
      const today = todayKey();
      const yesterday = todayKey(new Date(Date.now() - 86400000));
      u.checkin ||= { last: null, streak: 0, best: 0 };
      if (u.checkin.last === today) return bot.reply(ctx, `already checked in today! Streak: ${u.checkin.streak} 🔥`);
      u.checkin.streak = u.checkin.last === yesterday ? u.checkin.streak + 1 : 1;
      u.checkin.best = Math.max(u.checkin.best || 0, u.checkin.streak);
      u.checkin.last = today;
      const reward = cfg.baseReward + Math.min(cfg.maxStreakBonus, (u.checkin.streak - 1) * cfg.streakBonus);
      u.points += reward;
      save();
      bot.emit('points:changed', u);
      bot.reply(ctx, `checked in! +${bot.fmtPoints(reward)} | streak: ${u.checkin.streak} day${u.checkin.streak > 1 ? 's' : ''} 🔥`);
    },
  });
}
