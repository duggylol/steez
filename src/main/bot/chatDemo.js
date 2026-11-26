// Developer preview for the Twitch Chat page: STEEZ_CHAT_DEMO=<twitch user id>:<login> makes up a
// busy chat (viewers, commands, mods, bots, subs, raids, bits, follows, deletions) through the real
// IRC parsing path, using that channel's 7TV/BTTV/FFZ emotes. Off unless the variable is set.
import { parseLine } from './twitch/irc.js';

const NAMES = ['pixelpanda', 'NightOwl_TV', 'zestyLemon', 'kappa_king', 'glizzygoblin', 'sunnyside42', 'MrBigBrain', 'Kira', 'tofu_tactics', 'lurkmaster3000', 'velvetvortex', 'ChadGPT'];
const LINES = ['lets goooo', 'this is actually insane', 'wait what just happened', 'W streamer', 'clip that', 'no way he hit that', 'first time catching the stream, love the vibes', 'chat is this real', 'that was so clean', 'LMAO', 'ok but the music slaps', 'gg', 'how long have you been streaming today?', 'hi chat!', 'I was here', 'bro is cooking'];
const COMMANDS = ['!points', '!gamble 100', '!slots 50', '!casino', '!sr never gonna give you up', '!fish', '!uptime', '!pnl'];
const BOT = ['@pixelpanda you have 4,210 points.', '🎰 Play with your points at https://steezgames.xyz/demo — log in with Twitch.', '@zestyLemon rolled 74 and won 200 points! Now: 1,240.', '🎣 kappa_king caught a Golden Koi (rare) worth 420 points!'];
const MOD = ['please keep it chill chat', 'no spoilers in chat', 'welcome in everyone', 'raid incoming, be nice'];
const COLORS = ['#FF4500', '#1E90FF', '#9ACD32', '#FF69B4', '#8A2BE2', '#DAA520', '', '#00FF7F', '#5F9EA0'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
// What real viewers wear: subs of different lengths, founders, VIPs, Prime, Turbo, bits.
const VIEWER_BADGES = ['', '', 'subscriber/0', 'subscriber/3', 'subscriber/6,bits/100', 'subscriber/12', 'subscriber/24,bits/1000', 'founder/0', 'vip/1,subscriber/12', 'premium/1', 'turbo/1', 'subscriber/36,bits/5000', 'glhf-pledge/1'];

export function startChatDemo(bot, channel, emoteNames = () => []) {
  let n = 0;
  const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\:').replace(/ /g, '\\s');
  const line = (tags, cmd, text) => `@${Object.entries(tags).map(([k, v]) => `${k}=${esc(v)}`).join(';')} :x!x@x.tmi.twitch.tv ${cmd} #${channel} :${text}`;
  const msg = (login, text, extra = {}) => {
    const tags = { 'display-name': login, color: pick(COLORS), id: `demo-${++n}`, 'user-id': String(1000 + n), badges: '', 'tmi-sent-ts': Date.now(), ...extra };
    const m = parseLine(line(tags, 'PRIVMSG', text));
    bot.irc.emit('message', { tags: m.tags, login: login.toLowerCase(), channel, text: m.trailing });
  };
  const notice = (tags, text = '') => {
    const m = parseLine(line({ id: `demo-${++n}`, 'tmi-sent-ts': Date.now(), ...tags }, 'USERNOTICE', text));
    bot.irc.emit('usernotice', { tags: m.tags, text: m.trailing });
  };
  const withEmotes = (text) => {
    const names = emoteNames();
    if (!names.length || Math.random() < 0.35) return text;
    const k = 1 + Math.floor(Math.random() * 3);
    return `${text} ${Array.from({ length: k }, () => pick(names)).join(' ')}`;
  };
  const tick = () => {
    const r = Math.random();
    const who = pick(NAMES);
    if (r < 0.52) msg(who, withEmotes(pick(LINES)), { badges: pick(VIEWER_BADGES), 'first-msg': Math.random() < 0.04 ? '1' : '0' });
    else if (r < 0.56) msg(who, `Kappa ${pick(LINES)}`, { emotes: '25:0-4', badges: pick(VIEWER_BADGES) });
    else if (r < 0.66) msg(who, pick(COMMANDS), { badges: pick(VIEWER_BADGES) });
    else if (r < 0.74) msg('steezzzbot', pick(BOT), { color: '#9146FF' });
    else if (r < 0.8) msg('ModMandy', withEmotes(pick(MOD)), { badges: 'moderator/1,subscriber/24', mod: '1', color: '#00C7AC' });
    else if (r < 0.82) msg(channel, withEmotes('thanks for hanging out everyone'), { badges: 'broadcaster/1,subscriber/0', color: '#FFB31A' });
    else if (r < 0.84) msg(who, `@${channel} ${withEmotes('you are cracked')}`, { 'reply-parent-msg-id': 'demo-x', 'reply-parent-user-login': channel, 'reply-parent-display-name': channel, 'reply-parent-msg-body': 'what a play' });
    else if (r < 0.86) msg(who, 'Cheer100 here are some bits!', { bits: '100' });
    else if (r < 0.885) notice({ 'msg-id': 'resub', login: who, 'display-name': who, 'msg-param-cumulative-months': String(2 + Math.floor(Math.random() * 30)), 'msg-param-sub-plan': '1000', badges: 'subscriber/12' }, withEmotes('love this channel'));
    else if (r < 0.9) notice({ 'msg-id': 'subgift', login: who, 'display-name': who, 'system-msg': `${who} gifted a Tier 1 sub to ${pick(NAMES)}!` });
    else if (r < 0.91) notice({ 'msg-id': 'raid', login: 'bigstreamer', 'display-name': 'BigStreamer', 'msg-param-displayName': 'BigStreamer', 'msg-param-viewerCount': '342' });
    else if (r < 0.92) notice({ 'msg-id': 'announcement', login: 'ModMandy', 'display-name': 'ModMandy', 'msg-param-color': pick(['PRIMARY', 'GREEN', 'ORANGE', 'PURPLE']), badges: 'moderator/1' }, 'Giveaway starts in 5 minutes! Type !join');
    else if (r < 0.95) bot.emit('eventsub:channel.follow', { user_name: who, user_login: who.toLowerCase() });
    else if (r < 0.97) bot.emit('eventsub:channel.channel_points_custom_reward_redemption.add', { user_name: who, user_login: who.toLowerCase(), reward: { title: 'Hydrate', cost: 500 }, user_input: '' });
    else bot.irc.emit('clearmsg', { tags: { 'target-msg-id': `demo-${n - 2}` }, text: '' });
  };
  const timer = setInterval(tick, 450);
  timer.unref?.();
  return () => clearInterval(timer);
}
