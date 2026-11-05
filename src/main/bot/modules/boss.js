// Co-op Raid Boss: chat spawns a boss and attacks it together; loot is split by damage dealt.
import { db } from '../store.js';
import { randInt, pick, fmtNum } from '../util.js';
import { broadcast } from '../web/hub.js';

const BOSSES = [
  { name: 'The Lag Monster', emoji: '🐌' },
  { name: 'Captain Buffering', emoji: '🌀' },
  { name: 'The Dropped Frame Dragon', emoji: '🐉' },
  { name: 'Ban Hammer Golem', emoji: '🔨' },
  { name: 'The Backseat Gamer', emoji: '🪑' },
  { name: 'Lord Copyright Strike', emoji: '⚖️' },
  { name: 'The 3AM Energy Drink Kraken', emoji: '🦑' },
  { name: 'Spoiler Specter', emoji: '👻' },
];

export function init(bot) {
  const C = () => db.settings.games.boss;
  let boss = null;
  const stunned = new Map();

  const publicState = () =>
    boss && {
      name: boss.name,
      emoji: boss.emoji,
      hp: Math.max(0, boss.hp),
      maxHp: boss.maxHp,
      attackers: boss.damage.size,
      top: [...boss.damage.entries()]
        .sort((a, b) => b[1].dmg - a[1].dmg)
        .slice(0, 3)
        .map(([, v]) => ({ user: v.display, dmg: v.dmg })),
      endsAt: boss.endsAt,
    };
  const push = () => broadcast('boss', publicState());
  bot.bossState = publicState;

  function spawn(hp) {
    if (boss) return false;
    const c = C();
    const t = pick(BOSSES);
    const maxHp = hp || c.baseHp + c.hpPerChatter * Math.max(1, bot.state.chatters.size);
    boss = { ...t, hp: maxHp, maxHp, damage: new Map(), endsAt: Date.now() + c.fleeMinutes * 60000 };
    boss.timer = setTimeout(flee, c.fleeMinutes * 60000);
    bot.say(`${t.emoji} A wild ${t.name} appears with ${fmtNum(maxHp)} HP! Type !attack to fight together — loot is split by damage! ⚔️`);
    push();
    return true;
  }

  function flee() {
    if (!boss) return;
    bot.say(`${boss.emoji} ${boss.name} escaped with ${fmtNum(boss.hp)} HP left! Better luck next time.`);
    boss = null;
    push();
  }

  function defeat() {
    clearTimeout(boss.timer);
    const c = C();
    const total = [...boss.damage.values()].reduce((s, v) => s + v.dmg, 0);
    const loot = c.lootBase + c.lootPerParticipant * boss.damage.size;
    const sorted = [...boss.damage.entries()].sort((a, b) => b[1].dmg - a[1].dmg);
    for (const [login, v] of sorted) bot.addPoints(login, Math.max(1, Math.round((loot * v.dmg) / total)));
    const [mvpLogin, mvp] = sorted[0];
    bot.emit('achievement:unlock', mvpLogin, 'boss_slayer');
    bot.say(
      `🏆 ${boss.name} has been defeated by ${boss.damage.size} heroes! ${fmtNum(loot)} ${bot.currency} split by damage. MVP: ${mvp.display} (${fmtNum(mvp.dmg)} dmg) 👑`,
    );
    bot.overlay('effect', { effect: 'confetti', user: mvp.display });
    boss = null;
    push();
  }

  bot.command('attack', {
    description: 'Attack the raid boss',
    aliases: ['hit', 'fight'],
    get userCooldown() {
      return C().attackCooldownSeconds;
    },
    handler: (ctx) => {
      if (!boss) return false;
      const until = stunned.get(ctx.user.login) || 0;
      if (until > Date.now()) return false;
      // Boss counter-attack
      if (Math.random() < 0.08) {
        stunned.set(ctx.user.login, Date.now() + 30000);
        bot.reply(ctx, `${boss.emoji} ${boss.name} counter-attacks! You're stunned for 30s 💫`);
        return;
      }
      let dmg = randInt(8, 30);
      if (ctx.user.isSub) dmg = Math.round(dmg * 1.25);
      const crit = Math.random() < 0.1;
      if (crit) dmg *= 3;
      boss.hp -= dmg;
      const rec = boss.damage.get(ctx.user.login) || { display: ctx.user.display, dmg: 0 };
      rec.dmg += dmg;
      boss.damage.set(ctx.user.login, rec);
      if (crit) bot.say(`💥 CRITICAL HIT! ${ctx.user.display} deals ${dmg} damage to ${boss.name}! (${fmtNum(Math.max(0, boss.hp))} HP left)`);
      if (boss.hp <= 0) defeat();
      else push();
    },
  });

  bot.command('boss', {
    description: 'Boss status, or spawn one (mods)',
    usage: '!boss [spawn [hp]]',
    cooldown: 10,
    handler: (ctx, [sub, hp]) => {
      if (sub === 'spawn' && bot.hasLevel(ctx.user, 'moderator')) {
        if (!C().enabled) return bot.reply(ctx, 'the raid boss game is disabled.');
        if (!spawn(Number(hp) || 0)) bot.reply(ctx, 'a boss is already here!');
        return;
      }
      if (sub === 'kill' && bot.hasLevel(ctx.user, 'moderator')) return flee();
      if (!boss) return bot.reply(ctx, 'no boss right now. Mods can summon one with !boss spawn');
      bot.reply(ctx, `${boss.emoji} ${boss.name}: ${fmtNum(Math.max(0, boss.hp))}/${fmtNum(boss.maxHp)} HP, ${boss.damage.size} attackers. !attack`);
    },
  });

  bot.action('boss:spawn', ({ hp }) => spawn(Number(hp) || 0));
  bot.action('boss:flee', () => flee());

  // Optional auto-spawn
  let lastAuto = Date.now();
  setInterval(() => {
    const c = C();
    if (!c.enabled || !c.autoSpawnMinutes || boss || !bot.state.live) return;
    if (Date.now() - lastAuto >= c.autoSpawnMinutes * 60000) {
      lastAuto = Date.now();
      spawn();
    }
  }, 30_000);
}
