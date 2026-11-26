// Points games: gamble, slots, duel, heist, jackpot, plinko, roulette, fishing, daily check-in.
import { db, save, findUser, getUser, bumpStat } from '../store.js';
import { parseAmount, randInt, pick, weightedPick, fmtNum, normLogin, todayKey, fmtDuration } from '../util.js';
import { keep, restore, resumeAt } from '../session.js';
import { castFish, cleanTiers } from '../fishing.js';
import { pickWinner, chanceOf } from '../jackpot.js';
import { recordPlay, viewerPnl, channelPnl, resetPnl, resetViewerPnl } from '../pnl.js';
import { plinkoBoard, dropBall, ballColor, PLINKO_TIMING } from '../plinko.js';

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
        recordPlay(ctx.user.login, ctx.user.display, 'gamble', n, 0);
        bumpStat(u, 'gambleLosses');
        bot.reply(ctx, `rolled ${roll} and lost ${bot.fmtPoints(n)} 💸 Now: ${fmtNum(u.points)}.`);
      } else {
        const mult = roll >= cfg.jackpotFrom ? 3 : 2;
        bot.addPoints(ctx.user.login, n * (mult - 1));
        recordPlay(ctx.user.login, ctx.user.display, 'gamble', n, n * mult);
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
      recordPlay(ctx.user.login, ctx.user.display, 'slots', n, win);
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
      recordPlay(winner.login, winner.display, 'duel', d.amount, d.amount * 2);
      recordPlay(loser.login, loser.display, 'duel', d.amount, 0);
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
  const saveHeist = () => keep('heist', heist && { crew: [...heist.crew], endsAt: heist.endsAt });
  {
    // A heist that was gathering a crew when Steez closed carries on (the crew's points are in it).
    const saved = restore('heist');
    if (saved?.crew?.length) {
      heist = { crew: new Map(saved.crew), endsAt: resumeAt(saved.endsAt) };
      setTimeout(runHeist, Math.max(5000, heist.endsAt - Date.now()));
    } else keep('heist', null);
  }
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
        heist = { crew: new Map(), endsAt: Date.now() + cfg.joinSeconds * 1000 };
        heist.crew.set(ctx.user.login, { user: ctx.user, amount: n });
        saveHeist();
        bot.say(`💰 ${ctx.user.display} is planning a heist! Join with !heist <amount> in the next ${cfg.joinSeconds}s.`);
        setTimeout(runHeist, cfg.joinSeconds * 1000);
      } else {
        heist.crew.set(ctx.user.login, { user: ctx.user, amount: n });
        saveHeist();
        if (heist.crew.size % 3 === 0) bot.say(`💰 The crew grows to ${heist.crew.size}!`);
      }
    },
  });
  function runHeist() {
    const cfg = G().heist;
    if (!heist) return;
    const crew = [...heist.crew.values()];
    heist = null;
    saveHeist();
    heistCooldownUntil = Date.now() + cfg.cooldownMinutes * 60000;
    const tier = [...cfg.tiers].sort((a, b) => b.minPlayers - a.minPlayers).find((t) => crew.length >= t.minPlayers) || cfg.tiers[0];
    const survivors = [];
    for (const m of crew) {
      if (Math.random() * 100 < tier.successPercent) {
        const won = Math.floor(m.amount * tier.payout);
        bot.addPoints(m.user.login, won);
        survivors.push(`${m.user.display} (${fmtNum(won)})`);
        recordPlay(m.user.login, m.user.display, 'heist', m.amount, won);
        bumpStat(getUser(m.user.login), 'heistsSurvived');
        bot.emit('achievement:unlock', m.user.login, 'heist_survivor');
      } else recordPlay(m.user.login, m.user.display, 'heist', m.amount, 0);
    }
    setTimeout(() => {
      if (!survivors.length) bot.say(`🚓 The crew of ${crew.length} tried to rob ${tier.name}... and everyone got caught! All bets lost.`);
      else if (survivors.length === crew.length) bot.say(`💎 Flawless heist on ${tier.name}! Everyone escaped: ${survivors.join(', ')}`);
      else bot.say(`💼 The heist on ${tier.name} is over. Survivors: ${survivors.join(', ')}. ${crew.length - survivors.length} got caught.`);
    }, 1500);
    bot.say(`🚨 The crew of ${crew.length} hits ${tier.name}...`);
  }

  // ─── Jackpot ────────────────────────────────────────────────
  // !jackpot <amount> opens a round; when the countdown ends one winner is picked, weighted by how
  // much each player put in (more points = more spots on the overlay's reel), and they take the whole pot.
  let jp = null; // { id, phase: open|spinning|done|cancelled, players: Map(login → { login, display, amount }), endsAt, ... }
  let jpTimer = null;
  let jpCooldownUntil = 0;
  const jpPot = () => (jp ? [...jp.players.values()].reduce((s, p) => s + p.amount, 0) : 0);
  const jackpotState = () =>
    jp && {
      id: jp.id,
      phase: jp.phase,
      now: Date.now(),
      openedAt: jp.openedAt || jp.endsAt - G().jackpot.joinSeconds * 1000,
      endsAt: jp.endsAt,
      pot: jpPot(),
      currency: bot.currency,
      players: [...jp.players.values()].map((p) => ({ user: p.display, amount: p.amount })),
      winner: jp.winner ?? null,
      landAt: jp.landAt ?? null,
      spinStart: jp.spinStart ?? null,
      spinMs: jp.spinMs ?? null,
      hideAfterMs: Math.max(5, G().jackpot.hideAfterSeconds || 30) * 1000,
      message: jp.message || '',
    };
  bot.jackpotState = jackpotState;
  const showJackpot = () => bot.overlay('jackpot', jackpotState());
  const saveJackpot = () => keep('jackpot', jp?.phase === 'open' ? { players: [...jp.players.values()], endsAt: jp.endsAt } : null);
  // After a round is over it stays on screen a while, then it's cleared (the overlay slides away).
  function endRound() {
    const id = jp.id;
    saveJackpot();
    showJackpot();
    jpCooldownUntil = Date.now() + Math.max(0, G().jackpot.cooldownSeconds || 0) * 1000;
    setTimeout(() => {
      if (jp?.id !== id) return;
      jp = null;
      showJackpot();
    }, Math.max(5, G().jackpot.hideAfterSeconds || 30) * 1000);
  }
  function spinJackpot() {
    clearTimeout(jpTimer);
    if (jp?.phase !== 'open') return;
    const cfg = G().jackpot;
    const players = [...jp.players.values()];
    const pot = jpPot();
    if (players.length < Math.max(2, cfg.minPlayers || 2)) {
      for (const p of players) bot.addPoints(p.login, p.amount);
      jp.phase = 'cancelled';
      jp.message = 'Not enough players — points refunded';
      bot.say(`🎰 Not enough players joined the jackpot, so ${players.map((p) => p.display).join(', ')} got their ${bot.currency} back.`);
      return endRound();
    }
    const w = pickWinner(players);
    const winner = players[w.index];
    bot.addPoints(winner.login, pot); // paid now, announced when the reel stops
    players.forEach((p, i) => recordPlay(p.login, p.display, 'jackpot', p.amount, i === w.index ? pot : 0));
    bumpStat(getUser(winner.login, winner.display), 'jackpotsWon');
    Object.assign(jp, { phase: 'spinning', winner: w.index, landAt: w.at, spinStart: Date.now(), spinMs: Math.max(1, cfg.spinSeconds || 8) * 1000 });
    saveJackpot();
    showJackpot();
    bot.say(`🎰 Jackpot closed: ${players.length} players, ${bot.fmtPoints(pot)} in the pot. Rolling... 🎲`);
    const id = jp.id;
    setTimeout(() => {
      if (jp?.id !== id) return;
      jp.phase = 'done';
      jp.message = `${winner.display} wins ${fmtNum(pot)} ${bot.currency}!`;
      bot.say(`🎉 ${winner.display} WINS THE JACKPOT of ${bot.fmtPoints(pot)} with a ${chanceOf(winner.amount, pot)} chance! 💰`);
      endRound();
    }, jp.spinMs);
  }
  {
    // A round that was open when Steez closed carries on (the players' points are in it).
    const saved = restore('jackpot');
    if (saved?.players?.length) {
      jp = { id: Date.now(), phase: 'open', players: new Map(saved.players.map((p) => [p.login, p])), endsAt: resumeAt(saved.endsAt) };
      jpTimer = setTimeout(spinJackpot, Math.max(5000, jp.endsAt - Date.now()));
    } else keep('jackpot', null);
  }
  bot.action('jackpot:state', () => jackpotState());
  bot.action('jackpot:cancel', () => cancelJackpot());
  function cancelJackpot() {
    if (jp?.phase !== 'open') return false;
    clearTimeout(jpTimer);
    for (const p of jp.players.values()) bot.addPoints(p.login, p.amount);
    jp.phase = 'cancelled';
    jp.message = 'Jackpot cancelled — points refunded';
    bot.say('🎰 The jackpot was cancelled. Everyone got their points back.');
    endRound();
    return true;
  }
  bot.command('jackpot', {
    description: 'Put points in the jackpot: one winner, picked by points put in, takes the whole pot',
    usage: '!jackpot <amount>',
    aliases: ['jp'],
    handler: (ctx, [arg]) => {
      const cfg = G().jackpot;
      if (!cfg.enabled) return false;
      const word = String(arg || '').toLowerCase();
      if (word === 'cancel' || word === 'stop') {
        if (!bot.hasLevel(ctx.user, 'moderator')) return false;
        if (!cancelJackpot()) bot.reply(ctx, 'there is no jackpot to cancel.');
        return;
      }
      const open = jp?.phase === 'open';
      if (!arg) {
        if (open) {
          const left = Math.max(0, Math.ceil((jp.endsAt - Date.now()) / 1000));
          return bot.reply(ctx, `🎰 ${jp.players.size} in the jackpot, ${bot.fmtPoints(jpPot())} in the pot. Spins in ${left}s. Join with !jackpot <amount>`), false;
        }
        return bot.reply(ctx, `start a jackpot with !jackpot <amount>. Everyone who joins in the next ${cfg.joinSeconds}s is in the draw (more points = more spots) and the winner takes the whole pot.`), false;
      }
      if (jp?.phase === 'spinning') return bot.reply(ctx, 'the jackpot is already rolling. Wait for the next round!'), false;
      if (!open && Date.now() < jpCooldownUntil) return bot.reply(ctx, `the next jackpot opens in ${fmtDuration(jpCooldownUntil - Date.now())}.`), false;
      const mine = open ? jp.players.get(ctx.user.login) : null;
      if (mine && cfg.maxBet > 0 && mine.amount >= cfg.maxBet) return bot.reply(ctx, `you're already in with the most you can put in (${bot.fmtPoints(cfg.maxBet)}).`), false;
      let n = bet(ctx, arg, cfg);
      if (!n) return false;
      if (mine && cfg.maxBet > 0) n = Math.min(n, cfg.maxBet - mine.amount);
      bot.takePoints(ctx.user.login, n);
      if (!open) {
        // a finished round still on screen is replaced by the new one
        jp = { id: Date.now(), phase: 'open', players: new Map(), openedAt: Date.now(), endsAt: Date.now() + cfg.joinSeconds * 1000 };
        jp.players.set(ctx.user.login, { login: ctx.user.login, display: ctx.user.display, amount: n });
        clearTimeout(jpTimer);
        jpTimer = setTimeout(spinJackpot, cfg.joinSeconds * 1000);
        saveJackpot();
        showJackpot();
        bot.say(`🎰 ${ctx.user.display} started a JACKPOT with ${bot.fmtPoints(n)}! Type !jackpot <amount> to join (more points = more spots). It rolls in ${cfg.joinSeconds}s and the winner takes the whole pot!`);
        return;
      }
      if (mine) mine.amount += n;
      else jp.players.set(ctx.user.login, { login: ctx.user.login, display: ctx.user.display, amount: n });
      saveJackpot();
      showJackpot();
      const me = jp.players.get(ctx.user.login);
      bot.reply(ctx, `${mine ? `you added ${bot.fmtPoints(n)}, now in with` : "you're in with"} ${fmtNum(me.amount)} (${chanceOf(me.amount, jpPot())} chance). Pot: ${bot.fmtPoints(jpPot())}`);
    },
  });

  // ─── Plinko ─────────────────────────────────────────────────
  // !plinko <amount> [balls]: every ball costs <amount> and lands on a multiplier. Where each ball
  // lands is decided here and paid at once; the overlay just plays the paths, and the chat reply
  // waits until the last ball has landed on it.
  const onBoard = new Map(); // login → { color, until }: players whose balls are still on the overlay
  function plinkoColorFor(user) {
    const now = Date.now();
    for (const [k, v] of onBoard) if (v.until < now) onBoard.delete(k);
    const mine = onBoard.get(user.login);
    if (mine) return mine.color;
    return ballColor(user.login, user.color, [...onBoard.values()].map((v) => v.color));
  }
  const fmtMult = (m) => `${m}×`;
  let plinkoSeq = 0;
  bot.command('plinko', {
    description: 'Drop balls down the Plinko board. Each ball lands on a multiplier of its bet',
    usage: '!plinko <amount per ball> [balls]',
    get userCooldown() {
      return G().plinko.cooldownSeconds;
    },
    handler: (ctx, [amt, ballsArg]) => {
      const cfg = G().plinko;
      if (!cfg.enabled) return false;
      const board = plinkoBoard(cfg);
      const maxBalls = Math.max(1, Math.floor(cfg.maxBalls || 1));
      const ms = board.multipliers;
      if (!amt) {
        return bot.reply(ctx, `drop balls with !plinko <amount> <balls> (up to ${maxBalls} balls, each costs <amount>). Slots pay ${fmtMult(Math.min(...ms))} to ${fmtMult(Math.max(...ms))}.`), false;
      }
      let balls = ballsArg == null ? 1 : Math.floor(Number(ballsArg));
      if (!(balls >= 1)) return bot.reply(ctx, 'usage: !plinko <amount per ball> <balls>, like !plinko 100 5'), false;
      balls = Math.min(balls, maxBalls);
      const bal = bot.points(ctx.user.login);
      // all / half / 50% mean the total, shared between the balls
      const total = /^(all|allin|max|half)$|%$/i.test(amt);
      let per = total ? Math.floor(parseAmount(amt, bal) / balls) : parseAmount(amt, bal);
      if (!(per > 0) && !total) return bot.reply(ctx, 'usage: !plinko <amount per ball> <balls>, like !plinko 100 5'), false;
      if (cfg.maxBet > 0) per = Math.min(per, cfg.maxBet);
      if (!(per >= (cfg.minBet || 1))) return bot.reply(ctx, `minimum bet is ${bot.fmtPoints(cfg.minBet || 1)} per ball.`), false;
      const cost = per * balls;
      if (cost > bal) {
        return bot.reply(ctx, balls > 1 ? `${balls} balls × ${fmtNum(per)} = ${bot.fmtPoints(cost)}, but you only have ${bot.fmtPoints(bal)}.` : `you only have ${bot.fmtPoints(bal)}.`), false;
      }

      const drops = Array.from({ length: balls }, () => {
        const { path, slot } = dropBall(board.rows);
        const mult = ms[slot];
        return { path, slot, mult, win: Math.round(per * mult) };
      });
      const paid = drops.reduce((s, d) => s + d.win, 0);
      bot.addPoints(ctx.user.login, paid - cost);
      recordPlay(ctx.user.login, ctx.user.display, 'plinko', cost, paid);
      const best = Math.max(...drops.map((d) => d.mult));

      const T = PLINKO_TIMING;
      const fallMs = T.revealMs + (balls - 1) * T.staggerMs + (board.rows + 2) * T.stepMs + T.settleMs;
      const color = plinkoColorFor(ctx.user);
      onBoard.set(ctx.user.login, { color, until: Date.now() + fallMs + 5000 });
      bot.overlay('plinko', {
        id: `${Date.now()}-${++plinkoSeq}`,
        user: ctx.user.display,
        login: ctx.user.login,
        color,
        per,
        rows: board.rows,
        multipliers: ms,
        balls: drops.map(({ path, slot, mult, win }) => ({ path, slot, mult, win })),
        staggerMs: T.staggerMs,
        stepMs: T.stepMs,
        revealMs: T.revealMs,
        hideAfterMs: Math.max(5, cfg.hideAfterSeconds || 30) * 1000,
        currency: bot.currency,
      });

      const net = paid - cost;
      const list = balls <= 12 ? drops.map((d) => fmtMult(d.mult)).join(' ') : `best ${fmtMult(best)}`;
      const head = balls > 1 ? `${balls} balls × ${fmtNum(per)}: ` : '';
      const tail = net > 0 ? `${best >= 10 ? ' 🔥' : ' 🎉'}` : net < 0 ? ' 💸' : '';
      setTimeout(() => {
        bot.reply(ctx, `🔻 ${head}${list} → ${bot.fmtPoints(paid)} back (${signed(net)})${tail} Now: ${fmtNum(bot.points(ctx.user.login))}.`);
        if (best >= (cfg.announceFrom || Infinity)) bot.say(`🔻 ${ctx.user.display} hit ${fmtMult(best)} on Plinko for ${bot.fmtPoints(Math.round(per * best))}! 🔥`);
      }, fallMs);
    },
  });

  // The board for the settings page preview (unsaved values from the form, or the saved ones).
  bot.action('plinko:board', (a) => plinkoBoard({ ...G().plinko, ...(a || {}) }));

  // ─── Gambling PnL ───────────────────────────────────────────
  const signed = (n) => (n > 0 ? `+${fmtNum(n)}` : n < 0 ? `-${fmtNum(-n)}` : '0');
  const pnlSkip = () => new Set([...(db.settings.general.ignoredUsers || []).map(normLogin), bot.state.botLogin, bot.relay?.info?.login, bot.state.channel]);
  bot.command('pnl', {
    description: 'Your gambling profit & loss (gamble, slots, duel, heist, jackpot, plinko, bets)',
    usage: '!pnl [user|top]',
    aliases: ['profit', 'gamblestats'],
    userCooldown: 10,
    handler: (ctx, [arg]) => {
      if (/^(top|lb|leaderboard)$/i.test(arg || '')) {
        const r = channelPnl({ skip: pnlSkip(), top: 3 });
        if (!r.plays) return bot.say('📊 No gambling yet. Try !gamble, !slots, !plinko or !jackpot');
        const list = (xs) => xs.map((p, i) => `${i + 1}. ${p.user} ${signed(p.net)}`).join(' | ') || 'nobody';
        return bot.say(`📈 Most up: ${list(r.winners)} · 📉 Most down: ${list(r.losers)}`);
      }
      const u = findUser(normLogin(arg) || ctx.user.login);
      if (arg && !u) return bot.reply(ctx, `${normLogin(arg)} hasn't chatted here yet.`);
      const p = viewerPnl(u);
      if (!p.plays) return bot.reply(ctx, `${u ? `${u.display} hasn't` : "you haven't"} gambled yet.`);
      const games = p.games.slice(0, 4).map((g) => `${g.label} ${signed(g.net)}`).join(' · ');
      bot.reply(
        ctx,
        `${p.net >= 0 ? '📈' : '📉'} ${u.display}: ${signed(p.net)} ${bot.currency} over ${fmtNum(p.plays)} plays (won ${Math.round((p.wins / p.plays) * 100)}%) | ${games} | best ${signed(p.best)} · worst ${signed(p.worst)}`,
      );
    },
  });
  bot.action('pnl:report', () => channelPnl({ skip: pnlSkip() }));
  bot.action('pnl:reset', () => (resetPnl(), true));
  bot.action('pnl:resetViewer', ({ login }) => {
    const l = normLogin(login);
    if (!l) throw new Error('Type a viewer name.');
    if (!resetViewerPnl(l)) throw new Error(`${l} has no gambling PnL to reset.`);
    return true;
  });

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
      const { tier, name, size, value } = castFish(G().fishing.tiers);
      const u = getUser(ctx.user.login, ctx.user.display);
      u.fish ||= { catches: 0, best: null, tiers: {} };
      u.fish.catches++;
      u.fish.tiers[tier.tier] = (u.fish.tiers[tier.tier] || 0) + 1;
      const isBest = !u.fish.best || value > u.fish.best.value;
      if (isBest) u.fish.best = { name, size, value, tier: tier.tier };
      save();
      if (value) bot.addPoints(ctx.user.login, value);
      const msg = `${tier.emoji} ${ctx.user.display} caught ${name} (${size}lb, ${tier.tier}) worth ${bot.fmtPoints(value)}!${isBest && u.fish.catches > 1 ? ' New personal best! 🏅' : ''}`;
      if (tier.announce) {
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
      // the rarest tiers they've caught, rarest first
      const rarest = cleanTiers(G().fishing.tiers)
        .sort((a, b) => a.chance - b.chance)
        .filter((x) => t[x.tier])
        .slice(0, 4)
        .map((x) => `${x.tier}: ${t[x.tier]}`)
        .join(', ');
      bot.reply(
        ctx,
        `${u.display}: ${u.fish.catches} catches | best: ${u.fish.best.name} (${u.fish.best.size}lb, ${fmtNum(u.fish.best.value)})${rarest ? ` | ${rarest}` : ''}`,
      );
    },
  });
  bot.command('fishtop', {
    description: 'The biggest catches in the channel',
    aliases: ['topfish', 'fishleaderboard'],
    cooldown: 30,
    handler: () => {
      const skip = new Set([...(db.settings.general.ignoredUsers || []).map(normLogin), bot.state.botLogin, bot.relay?.info?.login, bot.state.channel]);
      const top = Object.values(db.users)
        .filter((u) => u.fish?.best && !skip.has(u.login))
        .sort((a, b) => b.fish.best.value - a.fish.best.value || b.fish.best.size - a.fish.best.size)
        .slice(0, 5);
      if (!top.length) return bot.say('🎣 Nobody has caught a fish yet. Be the first: !fish');
      bot.say(`🎣 Biggest catches: ${top.map((u, i) => `${i + 1}. ${u.display} — ${u.fish.best.name} (${u.fish.best.size}lb, ${fmtNum(u.fish.best.value)})`).join(' | ')}`);
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
