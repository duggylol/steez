// Quote book.
import { db, save } from '../store.js';
import { pick } from '../util.js';

export function init(bot) {
  const fmt = (q) => `#${q.id}: "${q.text}"${q.game ? ` [${q.game}]` : ''} (${new Date(q.date).toLocaleDateString('en-US')})`;

  bot.command('quote', {
    description: 'Random quote, by number, or search',
    usage: '!quote [number|search words]',
    cooldown: 5,
    handler: (ctx, args) => {
      if (!db.quotes.length) return bot.reply(ctx, 'no quotes yet! Mods can add one with !addquote');
      let q;
      if (/^\d+$/.test(args[0] || '')) q = db.quotes.find((x) => x.id === Number(args[0]));
      else if (args.length) {
        const s = args.join(' ').toLowerCase();
        const hits = db.quotes.filter((x) => x.text.toLowerCase().includes(s) || (x.game || '').toLowerCase().includes(s));
        q = pick(hits);
      } else q = pick(db.quotes);
      bot.say(q ? fmt(q) : 'No matching quote found.');
    },
  });

  bot.command('addquote', {
    description: 'Add a quote',
    usage: '!addquote <text>',
    get level() {
      return db.settings.quotes.addLevel || 'moderator';
    },
    handler: (ctx, args) => {
      const text = args.join(' ').replace(/^"|"$/g, '');
      if (!text) return false;
      const id = ++db.meta.quoteSeq;
      db.quotes.push({ id, text, game: bot.state.stream?.game || '', date: Date.now(), addedBy: ctx.user.login });
      save();
      bot.reply(ctx, `quote #${id} added!`);
    },
  });

  bot.command('delquote', {
    description: 'Delete a quote',
    usage: '!delquote <number>',
    aliases: ['removequote'],
    level: 'moderator',
    handler: (ctx, [n]) => {
      const i = db.quotes.findIndex((q) => q.id === Number(n));
      if (i < 0) return bot.reply(ctx, `quote #${n} not found.`);
      db.quotes.splice(i, 1);
      save();
      bot.reply(ctx, `quote #${n} deleted.`);
    },
  });

  bot.command('editquote', {
    description: 'Edit a quote',
    usage: '!editquote <number> <text>',
    level: 'moderator',
    handler: (ctx, [n, ...rest]) => {
      const q = db.quotes.find((x) => x.id === Number(n));
      if (!q || !rest.length) return false;
      q.text = rest.join(' ');
      save();
      bot.reply(ctx, `quote #${n} updated.`);
    },
  });
}
