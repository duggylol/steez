// Chat polls (with overlay) and points betting (predictions with your own currency, parimutuel payouts).
import { broadcast } from '../web/hub.js';
import { fmtNum, parseAmount } from '../util.js';

export function init(bot) {
  // ─── Polls ──────────────────────────────────────────────────
  let poll = null; // { question, options:[{text,votes}], voters: Map<login,index>, open, endsAt }
  const pollView = () =>
    poll && { question: poll.question, options: poll.options, total: poll.voters.size, open: poll.open, endsAt: poll.endsAt };
  const pushPoll = () => broadcast('poll', pollView());
  bot.pollState = pollView;

  function startPoll(question, options, seconds = 0) {
    if (options.length < 2) throw new Error('A poll needs at least 2 options');
    clearTimeout(poll?.timer);
    poll = { question, options: options.map((t) => ({ text: t, votes: 0 })), voters: new Map(), open: true, endsAt: seconds ? Date.now() + seconds * 1000 : 0 };
    if (seconds) poll.timer = setTimeout(endPoll, seconds * 1000);
    bot.say(`📊 POLL: ${question} — ${poll.options.map((o, i) => `${i + 1}) ${o.text}`).join('  ')} — vote with !vote <number>`);
    pushPoll();
  }
  function endPoll() {
    if (!poll?.open) return;
    poll.open = false;
    clearTimeout(poll.timer);
    const total = poll.voters.size || 1;
    const sorted = [...poll.options].sort((a, b) => b.votes - a.votes);
    bot.say(
      `📊 Poll closed: ${poll.question} — ${sorted.map((o) => `${o.text}: ${o.votes} (${Math.round((o.votes / total) * 100)}%)`).join(' | ')}. Winner: ${sorted[0].text}!`,
    );
    pushPoll();
    setTimeout(() => {
      if (poll && !poll.open) {
        poll = null;
        pushPoll();
      }
    }, 30000);
  }

  bot.command('poll', {
    description: 'Start/end a chat poll',
    usage: '!poll Question? | option 1 | option 2 [| ...]  —  !poll end',
    level: 'moderator',
    handler: (ctx, args) => {
      const text = args.join(' ');
      if (/^(end|stop|close)$/i.test(text)) return endPoll();
      const [question, ...options] = text.split('|').map((s) => s.trim()).filter(Boolean);
      try {
        startPoll(question, options);
      } catch (e) {
        bot.reply(ctx, `${e.message}. Usage: !poll Question? | A | B`);
      }
    },
  });
  bot.command('vote', {
    description: 'Vote in the current poll',
    usage: '!vote <number>',
    handler: (ctx, [n]) => {
      if (!poll?.open) return false;
      const i = Number(n) - 1;
      if (!poll.options[i]) return false;
      const prev = poll.voters.get(ctx.user.login);
      if (prev != null) poll.options[prev].votes--;
      poll.options[i].votes++;
      poll.voters.set(ctx.user.login, i);
      pushPoll();
    },
  });
  bot.action('poll:start', ({ question, options, seconds }) => startPoll(question, options.filter(Boolean), Number(seconds) || 0));
  bot.action('poll:end', () => endPoll());

  // ─── Bets ───────────────────────────────────────────────────
  let bets = null; // { question, options:[text], wagers: Map<login,{option,amount,display}>, open }
  const betView = () =>
    bets && {
      question: bets.question,
      open: bets.open,
      options: bets.options.map((text, i) => {
        const w = [...bets.wagers.values()].filter((x) => x.option === i);
        return { text, pool: w.reduce((s, x) => s + x.amount, 0), bettors: w.length };
      }),
    };
  const pushBets = () => broadcast('bets', betView());
  bot.betState = betView;

  function openBets(question, options) {
    if (bets) throw new Error('Bets are already running — resolve or refund first');
    if (options.length < 2) throw new Error('Need at least 2 outcomes');
    bets = { question, options, wagers: new Map(), open: true };
    bot.say(`🎲 BETS OPEN: ${question} — ${options.map((o, i) => `${i + 1}) ${o}`).join('  ')} — place a bet: !bet <number> <amount>`);
    pushBets();
  }
  function lockBets() {
    if (!bets?.open) throw new Error('No open bets');
    bets.open = false;
    const v = betView();
    bot.say(`🔒 Bets are locked! ${v.options.map((o) => `${o.text}: ${fmtNum(o.pool)}`).join(' | ')}`);
    pushBets();
  }
  function resolveBets(winIndex) {
    if (!bets) throw new Error('No bets running');
    const all = [...bets.wagers.entries()];
    const pot = all.reduce((s, [, w]) => s + w.amount, 0);
    const winners = all.filter(([, w]) => w.option === winIndex);
    const winPool = winners.reduce((s, [, w]) => s + w.amount, 0);
    let msg;
    if (!winners.length) {
      for (const [login, w] of all) bot.addPoints(login, w.amount);
      msg = `🎲 "${bets.options[winIndex]}" won but nobody bet on it — everyone was refunded.`;
    } else {
      let biggest = null;
      for (const [login, w] of winners) {
        const payout = Math.floor((w.amount / winPool) * pot);
        bot.addPoints(login, payout);
        if (!biggest || payout > biggest.payout) biggest = { display: w.display, payout };
      }
      msg = `🎲 "${bets.options[winIndex]}" wins! ${winners.length} winner(s) split ${bot.fmtPoints(pot)}. Biggest payout: ${biggest.display} (+${fmtNum(biggest.payout)})`;
    }
    bets = null;
    bot.say(msg);
    pushBets();
  }
  function refundBets() {
    if (!bets) return;
    for (const [login, w] of bets.wagers) bot.addPoints(login, w.amount);
    bets = null;
    bot.say('🎲 Bets cancelled — everyone was refunded.');
    pushBets();
  }

  bot.command('bet', {
    description: 'Bet points on an outcome (mods: open/lock/win/refund)',
    usage: '!bet <option#> <amount> | mods: !bet open Q | A | B, !bet lock, !bet win <#>, !bet refund',
    aliases: ['predict'],
    handler: (ctx, args) => {
      const sub = (args[0] || '').toLowerCase();
      if (bot.hasLevel(ctx.user, 'moderator') && ['open', 'lock', 'close', 'win', 'refund', 'cancel'].includes(sub)) {
        try {
          if (sub === 'open') {
            const [q, ...opts] = args.slice(1).join(' ').split('|').map((s) => s.trim()).filter(Boolean);
            return openBets(q, opts);
          }
          if (sub === 'lock' || sub === 'close') return lockBets();
          if (sub === 'win') return resolveBets(Number(args[1]) - 1);
          return refundBets();
        } catch (e) {
          return bot.reply(ctx, e.message);
        }
      }
      if (!bets?.open) return false;
      const opt = Number(args[0]) - 1;
      if (!bets.options[opt]) return bot.reply(ctx, `pick an option 1-${bets.options.length}.`);
      const existing = bets.wagers.get(ctx.user.login);
      if (existing && existing.option !== opt) return bot.reply(ctx, `you already bet on "${bets.options[existing.option]}".`);
      const n = parseAmount(args[1], bot.points(ctx.user.login));
      if (!(n > 0)) return bot.reply(ctx, 'usage: !bet <option#> <amount>');
      if (!bot.takePoints(ctx.user.login, n)) return bot.reply(ctx, `you only have ${bot.fmtPoints(bot.points(ctx.user.login))}.`);
      const w = existing || { option: opt, amount: 0, display: ctx.user.display };
      w.amount += n;
      bets.wagers.set(ctx.user.login, w);
      pushBets();
    },
  });

  bot.action('bets:open', ({ question, options }) => openBets(question, options.filter(Boolean)));
  bot.action('bets:lock', () => lockBets());
  bot.action('bets:resolve', ({ option }) => resolveBets(Number(option)));
  bot.action('bets:refund', () => refundBets());
}
