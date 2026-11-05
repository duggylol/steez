// Tools the AI can use to control Steez. Each tool has a minimum permission level; the AI is only
// offered the tools the person talking to it is allowed to use (see toolsFor).
import { db, save, findUser } from '../store.js';
import { LEVELS } from '../core/bot.js';
import * as api from '../twitch/api.js';
import { fmtDuration, normLogin } from '../util.js';

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const num = (description, extra = {}) => ({ type: 'number', description, ...extra });
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export function createAiTools(bot) {
  const A = () => db.settings.ai;
  const run = (name, args) => bot.runAction(name, args);

  // level: 'everyone' tools stay open to viewers; 'moderator' tools follow the AI "control level" setting.
  const TOOLS = [
    // ─── Music ───────────────────────────────────────────────
    {
      name: 'queue_song',
      level: 'songs',
      description: 'Add a song to the song-request queue. Accepts "artist - title", a search phrase, or a Spotify/YouTube/SoundCloud link. Use once per song.',
      input: obj({ query: str('Song name, artist and title, or a link') }, ['query']),
      run: ({ query }, ctx) => {
        if (bot.cooldown(`ai:sr:${ctx.user.login}`, 15) > 0 && ctx.user.level !== 'broadcaster') throw new Error('One song every 15 seconds per viewer.');
        return run('songs:request', { query, user: ctx.user.display });
      },
    },
    {
      name: 'now_playing',
      level: 'everyone',
      description: 'What song is playing right now, the volume and whether it is paused.',
      input: obj({}),
      run: () => run('songs:nowPlaying'),
    },
    {
      name: 'music_control',
      level: 'moderator',
      description: 'Control playback: skip the current song, pause, resume, go back to the previous Spotify track, or clear all pending song requests.',
      input: obj({ action: str('What to do', { enum: ['skip', 'pause', 'resume', 'previous', 'clear_requests'] }) }, ['action']),
      run: ({ action }, ctx) =>
        action === 'previous' ? run('songs:previous') : run('songs:command', { cmd: action === 'clear_requests' ? 'clearqueue' : action, user: ctx.user.display }),
    },
    {
      name: 'set_volume',
      level: 'moderator',
      description: 'Set the Spotify volume (0-100).',
      input: obj({ percent: num('Volume 0-100', { minimum: 0, maximum: 100 }) }, ['percent']),
      run: ({ percent }) => run('songs:volume', { percent }),
    },
    {
      name: 'list_playlists',
      level: 'moderator',
      description: "List the streamer's Spotify playlists (names).",
      input: obj({}),
      run: async () => (await run('songs:playlists')).slice(0, 60),
    },
    {
      name: 'play_playlist',
      level: 'moderator',
      description: 'Start playing one of the streamer\'s Spotify playlists by name (fuzzy match), or "Liked Songs". Replaces what is playing on Spotify.',
      input: obj({ name: str('Playlist name'), shuffle: { type: 'boolean', description: 'Shuffle Liked Songs' } }, ['name']),
      run: (a) => run('songs:playPlaylist', a),
    },
    // ─── Stream ──────────────────────────────────────────────
    {
      name: 'stream_status',
      level: 'everyone',
      description: 'Is the stream live, uptime, title, category and viewer count.',
      input: obj({}),
      run: () => {
        const s = bot.state.stream || {};
        return { live: bot.state.live, uptime: bot.state.live && s.startedAt ? fmtDuration(Date.now() - new Date(s.startedAt), 3) : null, title: s.title, category: s.game, viewers: s.viewers };
      },
    },
    {
      name: 'set_stream_info',
      level: 'moderator',
      description: 'Change the stream title and/or category (game). Only when explicitly asked.',
      input: obj({ title: str('New stream title'), category: str('New category / game name') }),
      run: ({ title, category }) => run('stream:update', { title, game: category }),
    },
    {
      name: 'create_clip',
      level: 'everyone',
      description: 'Clip the last ~30 seconds of the live stream and return the link.',
      input: obj({}),
      run: async () => {
        if (!bot.state.live) throw new Error('The stream is offline.');
        if (bot.cooldown('ai:clip', 60) > 0) throw new Error('A clip was made less than a minute ago.');
        const url = await bot.clip?.('ai');
        if (!url) throw new Error('Twitch did not create the clip.');
        return { url };
      },
    },
    {
      name: 'shoutout',
      level: 'moderator',
      description: 'Give another streamer a shoutout in chat (and a Twitch /shoutout when live).',
      input: obj({ username: str('Their Twitch username') }, ['username']),
      run: async ({ username }) => ({ ok: !!(await bot.shoutout?.(normLogin(username))) }),
    },
    {
      name: 'announce',
      level: 'moderator',
      description: 'Post a highlighted Twitch announcement in chat.',
      input: obj({ message: str('Announcement text', { maxLength: 450 }) }, ['message']),
      run: async ({ message }) => (await bot.announce(message), { ok: true }),
    },
    // ─── Community ───────────────────────────────────────────
    {
      name: 'start_poll',
      level: 'moderator',
      description: 'Start a chat poll (viewers vote with !vote <number>).',
      input: obj({ question: str('The question'), options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 }, seconds: num('Optional duration in seconds') }, ['question', 'options']),
      run: (a) => run('poll:start', a),
    },
    { name: 'end_poll', level: 'moderator', description: 'End the running chat poll and post the results.', input: obj({}), run: () => run('poll:end') },
    {
      name: 'open_bets',
      level: 'moderator',
      description: 'Open a points prediction: viewers bet with !bet <option> <amount>.',
      input: obj({ question: str('What will happen?'), options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 } }, ['question', 'options']),
      run: (a) => run('bets:open', a),
    },
    {
      name: 'resolve_bets',
      level: 'moderator',
      description: 'Lock, pay out or refund the running bets. winning_option is 1-based.',
      input: obj({ action: str('lock, payout or refund', { enum: ['lock', 'payout', 'refund'] }), winning_option: num('Winning option number (for payout)') }, ['action']),
      run: ({ action, winning_option }) =>
        action === 'lock' ? run('bets:lock') : action === 'refund' ? run('bets:refund') : run('bets:resolve', { option: Number(winning_option) - 1 }),
    },
    {
      name: 'giveaway',
      level: 'moderator',
      description: 'Run a giveaway: start one (viewers type the keyword), close entries, draw a winner, or cancel.',
      input: obj({ action: str('start, close, draw or cancel', { enum: ['start', 'close', 'draw', 'cancel'] }), title: str('Prize / title (for start)'), keyword: str('Entry keyword, default !enter') }, ['action']),
      run: ({ action, title, keyword }) =>
        action === 'start' ? run('raffle:start', { title: title || 'Giveaway', keyword: keyword || '!enter' }) : run({ close: 'raffle:stop', draw: 'raffle:draw', cancel: 'raffle:cancel' }[action]),
    },
    {
      name: 'viewer_queue',
      level: 'moderator',
      description: 'The play-with-viewers queue: see who is waiting, open or close it, or start the next game.',
      input: obj({ action: str('status, open, close or next', { enum: ['status', 'open', 'close', 'next'] }) }, ['action']),
      run: ({ action }) =>
        action === 'status' ? run('queueup:state') : action === 'next' ? run('queueup:next') : run('queueup:open', { open: action === 'open' }),
    },
    { name: 'start_trivia', level: 'moderator', description: 'Start a trivia round in chat, optionally about a topic.', input: obj({ topic: str('Optional topic') }), run: (a) => run('trivia:start', a) },
    { name: 'spawn_raid_boss', level: 'moderator', description: 'Spawn a co-op raid boss chat fights with !attack.', input: obj({}), run: () => run('boss:spawn', {}) },
    {
      name: 'check_points',
      level: 'everyone',
      description: 'How many loyalty points a viewer has (defaults to the person asking).',
      input: obj({ username: str('Viewer username') }),
      run: ({ username }, ctx) => {
        const u = findUser(normLogin(username) || ctx.user.login);
        return u ? { user: u.display, points: u.points, currency: bot.currency, hoursWatched: Math.round(u.watchMinutes / 6) / 10 } : { error: 'No record of that viewer yet.' };
      },
    },
    {
      name: 'adjust_points',
      level: 'moderator',
      description: 'Give (positive) or take (negative) loyalty points from a viewer. Only when explicitly asked.',
      input: obj({ username: str('Viewer username'), amount: num('Points to add (negative to remove)') }, ['username', 'amount']),
      run: ({ username, amount }) => {
        const n = Math.round(Number(amount));
        if (!n || Math.abs(n) > 100000) throw new Error('Amount must be between 1 and 100,000.');
        return { user: normLogin(username), points: bot.addPoints(normLogin(username), n) };
      },
    },
    {
      name: 'add_command',
      level: 'moderator',
      description: 'Create or update a simple custom chat command (text reply). Supports variables like ${user} and ${touser}.',
      input: obj({ name: str('Command name without !'), response: str('What the bot replies', { maxLength: 450 }) }, ['name', 'response']),
      run: ({ name, response }) => {
        const n = normLogin(name).replace(/^!/, '');
        if (!/^\w{1,30}$/.test(n)) throw new Error('Command names are letters, numbers and _.');
        if (bot.builtins.has(n)) throw new Error(`!${n} is a built-in command.`);
        if (/\$\{eval/i.test(response)) throw new Error('Not allowed.');
        db.commands[n] = { ...(db.commands[n] || { level: 'everyone', cooldown: 5, userCooldown: 0 }), response };
        save();
        return { command: `!${n}` };
      },
    },
    {
      name: 'timeout_user',
      level: 'moderator',
      description: 'Time out a viewer for breaking the rules. Only when the requester explicitly asks. Never the streamer, mods or the bot.',
      input: obj({ username: str('Viewer username'), seconds: num('Duration 1-600', { minimum: 1, maximum: 600 }), reason: str('Reason') }, ['username', 'seconds']),
      run: async ({ username, seconds, reason }) => {
        const login = normLogin(username);
        if ([bot.state.channel, bot.state.botLogin, bot.relay?.info?.login].includes(login)) throw new Error('Not allowed.');
        const u = await api.getUserByLogin(login);
        if (!u) throw new Error('No such user.');
        const ok = await bot.timeout({ login, id: u.id }, Math.min(600, Math.max(1, Number(seconds) || 60)), reason || 'Timed out via AI');
        return { ok };
      },
    },
    { name: 'shield_mode', level: 'moderator', description: 'Turn shield mode (followers-only + slow mode) on or off.', input: obj({ on: { type: 'boolean' } }, ['on']), run: ({ on }) => run('shield', { on }) },
  ];

  const levelValue = (l) => LEVELS[l] ?? 0;
  const required = (t) => {
    if (t.level === 'songs') return A().songRequestLevel || 'everyone';
    if (t.level === 'moderator') return levelValue(A().controlLevel) > levelValue('moderator') ? A().controlLevel : 'moderator';
    return t.level;
  };

  /** The tools a given chatter may make the AI use. */
  function toolsFor(user) {
    if (!A().allowControls) return [];
    return TOOLS.filter((t) => (t.level !== 'songs' || A().songRequests !== false) && bot.hasLevel(user, required(t)));
  }

  return { toolsFor, TOOLS };
}
