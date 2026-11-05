// Points shop: viewers spend loyalty points to trigger on-stream overlay effects (confetti, TTS, emote rain...).
import { db } from '../store.js';
import { sanitizeChat } from '../util.js';

export function init(bot) {
  const S = () => db.settings.shop;

  bot.command('shop', {
    description: 'See what you can buy with points',
    aliases: ['store'],
    cooldown: 15,
    handler: () => {
      if (!S().enabled) return false;
      bot.say(`🛒 Shop: ${S().items.map((i) => `${i.name} (${i.cost})`).join(' | ')} — buy with !redeem <item> [text]`);
    },
  });

  bot.command('redeem', {
    description: 'Buy an on-stream effect',
    usage: '!redeem <item> [text]',
    aliases: ['buy'],
    userCooldown: 10,
    handler: (ctx, [name, ...rest]) => {
      if (!S().enabled) return false;
      const item = S().items.find((i) => i.name.toLowerCase() === String(name || '').toLowerCase());
      if (!item) return bot.reply(ctx, `unknown item. Try: ${S().items.map((i) => i.name).join(', ')}`), false;
      if (item.cooldownSeconds && bot.cooldown(`shop:${item.name}`, item.cooldownSeconds, false))
        return bot.reply(ctx, `${item.name} is on cooldown.`), false;
      const text = sanitizeChat(rest.join(' '), 200);
      if (item.effect === 'tts' && !text) return bot.reply(ctx, 'add a message: !redeem tts <message>'), false;
      if (!bot.takePoints(ctx.user.login, item.cost)) return bot.reply(ctx, `${item.name} costs ${bot.fmtPoints(item.cost)} — you have ${bot.fmtPoints(bot.points(ctx.user.login))}.`), false;
      if (item.cooldownSeconds) bot.cooldown(`shop:${item.name}`, item.cooldownSeconds);
      const emotes = ctx.emotes.map((e) => ({ id: e.id, name: e.name }));
      bot.overlay('effect', { effect: item.effect, user: ctx.user.display, text, emotes, color: ctx.user.color });
      bot.reply(ctx, `redeemed ${item.name}! ✨`);
    },
  });

  bot.action('effect:test', ({ effect, text }) =>
    bot.overlay('effect', { effect, user: bot.state.channelDisplay || 'Streamer', text: text || 'This is a test message!', emotes: [] }),
  );
}
