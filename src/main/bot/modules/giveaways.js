// Giveaways / raffles with keyword or ticket entry, point-cost tickets, sub luck and winner-response tracking.
import { db, getUser, bumpStat } from '../store.js';
import { broadcast } from '../web/hub.js';

export function init(bot) {
  let raffle = null; // { title, keyword, ticketCost, maxTickets, subLuck, entries: Map<login,{display,tickets,isSub}>, open }
  let lastWinner = null;

  const view = () => ({
    raffle: raffle && {
      title: raffle.title,
      keyword: raffle.keyword,
      ticketCost: raffle.ticketCost,
      maxTickets: raffle.maxTickets,
      subLuck: raffle.subLuck,
      open: raffle.open,
      entries: [...raffle.entries.entries()].map(([login, e]) => ({ login, ...e })),
      totalTickets: [...raffle.entries.values()].reduce((s, e) => s + e.tickets, 0),
    },
    lastWinner,
  });
  const push = () => broadcast('raffle', view());
  bot.raffleState = view;

  function start({ title = 'Giveaway', keyword = '!enter', ticketCost = 0, maxTickets = 1, subLuck = 1, followersOnly = false } = {}) {
    if (raffle?.open) throw new Error('A giveaway is already open');
    raffle = {
      title,
      keyword: String(keyword || '!enter').toLowerCase(),
      ticketCost: Number(ticketCost) || 0,
      maxTickets: Math.max(1, Number(maxTickets) || 1),
      subLuck: Math.max(1, Number(subLuck) || 1),
      followersOnly,
      entries: new Map(),
      open: true,
    };
    const how = raffle.ticketCost ? `!ticket <amount> (${bot.fmtPoints(raffle.ticketCost)} each, max ${raffle.maxTickets})` : `type ${raffle.keyword}`;
    bot.say(`🎁 GIVEAWAY: ${title}! To enter, ${how}.${raffle.subLuck > 1 ? ` Subs get ${raffle.subLuck}x luck!` : ''}`);
    push();
    return view();
  }

  function enter(ctx, tickets = 1) {
    if (!raffle?.open) return;
    const e = raffle.entries.get(ctx.user.login) || { display: ctx.user.display, tickets: 0, isSub: ctx.user.isSub };
    const room = raffle.maxTickets - e.tickets;
    const want = Math.min(room, tickets);
    if (want <= 0) return;
    if (raffle.ticketCost > 0 && !bot.takePoints(ctx.user.login, want * raffle.ticketCost)) {
      return bot.reply(ctx, `you need ${bot.fmtPoints(want * raffle.ticketCost)} for that.`);
    }
    e.tickets += want;
    raffle.entries.set(ctx.user.login, e);
    push();
  }

  function stop() {
    if (!raffle) throw new Error('No giveaway running');
    raffle.open = false;
    bot.say(`🎁 Entries for "${raffle.title}" are closed! ${raffle.entries.size} people entered.`);
    push();
  }

  function draw() {
    if (!raffle || !raffle.entries.size) throw new Error('No entries to draw from');
    raffle.open = false;
    const pool = [];
    for (const [login, e] of raffle.entries) {
      const weight = e.tickets * (e.isSub ? raffle.subLuck : 1);
      pool.push({ login, e, weight });
    }
    const total = pool.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total;
    const win = pool.find((p) => (r -= p.weight) <= 0) || pool[pool.length - 1];
    raffle.entries.delete(win.login); // allows redraw without the same winner
    lastWinner = { login: win.login, display: win.e.display, title: raffle.title, at: Date.now(), responded: false };
    bumpStat(getUser(win.login), 'giveawaysWon');
    bot.emit('achievement:unlock', win.login, 'lucky');
    bot.say(`🎉 The winner of "${raffle.title}" is @${win.e.display}! Say something in chat to claim it!`);
    bot.overlay('alert', { type: 'giveaway', user: win.e.display, message: `won ${raffle.title}!` });
    push();
    return lastWinner;
  }

  function cancel() {
    if (!raffle) return;
    if (raffle.ticketCost > 0) for (const [login, e] of raffle.entries) bot.addPoints(login, e.tickets * raffle.ticketCost);
    bot.say(`🎁 The giveaway "${raffle.title}" was cancelled${raffle.ticketCost ? ' — tickets refunded' : ''}.`);
    raffle = null;
    push();
  }

  bot.on('chat', (ctx) => {
    if (lastWinner && !lastWinner.responded && ctx.user.login === lastWinner.login && Date.now() - lastWinner.at < 10 * 60000) {
      lastWinner.responded = true;
      lastWinner.message = ctx.text;
      bot.say(`✅ ${ctx.user.display} responded — congrats on winning!`);
      push();
    }
    if (raffle?.open && !raffle.ticketCost && ctx.text.trim().toLowerCase() === raffle.keyword) enter(ctx, 1);
  });

  bot.command('ticket', {
    description: 'Buy giveaway tickets',
    usage: '!ticket <amount|max>',
    aliases: ['tickets'],
    handler: (ctx, [n]) => {
      if (!raffle?.open) return false;
      const amount = n === 'max' || n === 'all' ? raffle.maxTickets : Math.max(1, parseInt(n, 10) || 1);
      enter(ctx, amount);
    },
  });

  bot.command('giveaway', {
    description: 'Manage giveaways',
    usage: '!giveaway start <title> | stop | draw | cancel',
    aliases: ['raffle'],
    level: 'moderator',
    handler: (ctx, [sub, ...rest]) => {
      try {
        switch ((sub || '').toLowerCase()) {
          case 'start':
          case 'open':
            return start({ title: rest.join(' ') || 'Giveaway' });
          case 'stop':
          case 'close':
            return stop();
          case 'draw':
          case 'pick':
            return draw();
          case 'cancel':
            return cancel();
          default:
            if (raffle) return bot.reply(ctx, `"${raffle.title}" — ${raffle.entries.size} entries, ${raffle.open ? 'open' : 'closed'}.`);
            return bot.reply(ctx, 'Usage: !giveaway start <title> | stop | draw | cancel');
        }
      } catch (e) {
        bot.reply(ctx, e.message);
      }
    },
  });

  bot.action('raffle:start', (a) => start(a));
  bot.action('raffle:stop', () => stop());
  bot.action('raffle:draw', () => draw());
  bot.action('raffle:cancel', () => cancel());
  bot.action('raffle:state', () => view());
}
