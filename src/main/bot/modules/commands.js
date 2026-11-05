// Custom command management from chat (!cmd) + !commands / !help.
import { db, save } from '../store.js';
import { LEVELS } from '../core/bot.js';

export function init(bot) {
  const clean = (n) => String(n || '').toLowerCase().replace(new RegExp(`^\\${bot.prefix}`), '');

  bot.command('cmd', {
    description: 'Manage custom commands',
    usage: '!cmd add|edit|del|alias|show|cooldown|level|cost|rename <name> ...',
    aliases: ['command', 'commands-edit'],
    level: 'moderator',
    handler: async (ctx, args) => {
      const [sub, rawName, ...rest] = args;
      const name = clean(rawName);
      const text = rest.join(' ');
      const exists = db.commands[name];
      switch ((sub || '').toLowerCase()) {
        case 'add':
        case 'new':
          if (!name || !text) return bot.reply(ctx, 'Usage: !cmd add <name> <response>');
          if (exists) return bot.reply(ctx, `!${name} already exists — use !cmd edit.`);
          if (bot.builtins.has(name)) return bot.reply(ctx, `!${name} is a built-in command (disable it in the dashboard to replace it).`);
          if (text.includes('${eval') && !bot.hasLevel(ctx.user, 'broadcaster')) return bot.reply(ctx, 'Only the broadcaster can create ${eval} commands.');
          db.commands[name] = { response: text, level: 'everyone', cooldown: 5, userCooldown: 0, createdBy: ctx.user.login, createdAt: Date.now() };
          save();
          return bot.reply(ctx, `Command !${name} added.`);
        case 'edit':
          if (!exists || !text) return bot.reply(ctx, exists ? 'Usage: !cmd edit <name> <response>' : `!${name} doesn't exist.`);
          if (text.includes('${eval') && !bot.hasLevel(ctx.user, 'broadcaster')) return bot.reply(ctx, 'Only the broadcaster can create ${eval} commands.');
          exists.response = text;
          save();
          return bot.reply(ctx, `Command !${name} updated.`);
        case 'del':
        case 'delete':
        case 'remove':
          if (!exists) return bot.reply(ctx, `!${name} doesn't exist.`);
          delete db.commands[name];
          save();
          return bot.reply(ctx, `Command !${name} deleted.`);
        case 'show':
          return bot.reply(ctx, exists ? `!${name} → ${exists.response}` : `!${name} doesn't exist.`);
        case 'alias': {
          if (!exists || !rest[0]) return bot.reply(ctx, 'Usage: !cmd alias <name> <alias>');
          exists.aliases = [...new Set([...(exists.aliases || []), clean(rest[0])])];
          save();
          return bot.reply(ctx, `!${clean(rest[0])} now runs !${name}.`);
        }
        case 'cooldown':
        case 'cd': {
          const n = Number(rest[0]);
          if (!exists || Number.isNaN(n)) return bot.reply(ctx, 'Usage: !cmd cooldown <name> <seconds> [userSeconds]');
          exists.cooldown = n;
          if (rest[1] != null) exists.userCooldown = Number(rest[1]) || 0;
          save();
          return bot.reply(ctx, `!${name} cooldown set to ${n}s.`);
        }
        case 'level':
        case 'perm': {
          const lvl = (rest[0] || '').toLowerCase().replace(/s$/, '').replace(/^mod$/, 'moderator').replace(/^sub$/, 'subscriber');
          if (!exists || !(lvl in LEVELS)) return bot.reply(ctx, `Usage: !cmd level <name> <${Object.keys(LEVELS).join('|')}>`);
          exists.level = lvl;
          save();
          return bot.reply(ctx, `!${name} is now ${lvl}+ only.`);
        }
        case 'cost': {
          const n = Number(rest[0]);
          if (!exists || Number.isNaN(n)) return bot.reply(ctx, 'Usage: !cmd cost <name> <points>');
          exists.cost = n;
          save();
          return bot.reply(ctx, `!${name} now costs ${bot.fmtPoints(n)}.`);
        }
        case 'rename': {
          const to = clean(rest[0]);
          if (!exists || !to || db.commands[to]) return bot.reply(ctx, 'Usage: !cmd rename <name> <newname>');
          db.commands[to] = exists;
          delete db.commands[name];
          save();
          return bot.reply(ctx, `!${name} renamed to !${to}.`);
        }
        default:
          return bot.reply(ctx, 'Usage: !cmd add|edit|del|show|alias|cooldown|level|cost|rename <name> ...');
      }
    },
  });

  bot.command('commands', {
    description: 'List of commands',
    aliases: ['cmds'],
    cooldown: 15,
    handler: (ctx) => {
      const p = bot.prefix;
      const custom = Object.entries(db.commands)
        .filter(([, c]) => c.enabled !== false && !c.hidden && bot.hasLevel(ctx.user, c.level || 'everyone'))
        .map(([n]) => p + n);
      const core = ['points', 'checkin', 'gamble', 'slots', 'fish', 'duel', 'heist', 'sr', 'song', 'join', 'queue', 'achievements', 'ask']
        .filter((n) => bot.findCommand(n) && bot.findCommand(n).def.enabled !== false)
        .map((n) => p + n);
      bot.reply(ctx, `Commands: ${[...core, ...custom].join(' ')} — use ${p}help <command> for details.`);
    },
  });

  bot.command('help', {
    description: 'Explain a command',
    usage: '!help <command>',
    cooldown: 3,
    handler: (ctx, args) => {
      const name = clean(args[0]);
      if (!name) return bot.reply(ctx, `Use ${bot.prefix}help <command>. See all with ${bot.prefix}commands`);
      const f = bot.findCommand(name);
      if (!f) return bot.reply(ctx, `No command called !${name}.`);
      if (f.type === 'custom') return bot.reply(ctx, `!${f.name} is a custom command (${f.def.level || 'everyone'}).`);
      bot.reply(ctx, `${f.def.usage || '!' + f.name} — ${f.def.description || ''} (${f.def.level}+)`);
    },
  });

  bot.command('counter', {
    description: 'Set or show a named counter',
    usage: '!counter <name> [set N|+N|-N|reset]',
    level: 'moderator',
    handler: (ctx, [rawName, op, val]) => {
      const name = (rawName || '').toLowerCase();
      if (!name) return false;
      const cur = db.counters[name] || 0;
      let n = cur;
      if (op === 'set') n = Number(val) || 0;
      else if (op === 'reset') n = 0;
      else if (/^[+-]\d+$/.test(op || '')) n = cur + Number(op);
      db.counters[name] = n;
      save();
      bot.reply(ctx, `Counter "${name}" = ${n}`);
    },
  });

  // Reset ${count deaths} style counters automatically at stream start if requested
  bot.on('stream:online', (info) => {
    if (info?.resumed) return;
    for (const name of db.settings.general.resetCountersOnStream || []) db.counters[name] = 0;
    save();
  });
}
