// Viewer requests (channel points / !sr / the "Test request" box) and the playback chat commands.
import { music, selectCurrent, selectRequester } from './store.js';
import { enqueue, next, togglePlay, clearQueue } from './player.js';
import { parseRequest, SOURCE_LABEL, notify, notifyError } from './util.js';

/** Which platforms the streamer accepts requests from. */
export function allowedSources() {
  const st = music().settings || {};
  return { spotify: st.allowSpotify !== false, youtube: st.allowYoutube !== false, soundcloud: st.allowSoundcloud !== false };
}

/**
 * Resolve a link or free text into a track, honouring the enabled platforms.
 * Free-text priority: Spotify → YouTube → SoundCloud. Returns { track } or { blocked: '<platform>' }.
 */
export async function resolveRequest(text) {
  const p = parseRequest(text);
  if (!p) return { track: null };
  const allow = allowedSources();
  const S = window.songseek.search;

  if (p.type !== 'query') {
    if (!allow[p.type]) return { blocked: SOURCE_LABEL[p.type] };
    if (p.type === 'spotify') return { track: await S.resolveSpotify(p.id) };
    if (p.type === 'youtube') return { track: await S.resolveYoutube(p.id) };
    if (p.type === 'soundcloud') return { track: await S.resolveSoundcloud(p.url) };
    return { track: null };
  }
  const tries = [
    allow.spotify && (() => S.spotify(p.q, 1)),
    allow.youtube && (() => S.youtube(p.q)),
    allow.soundcloud && (() => S.soundcloud(p.q)),
  ].filter(Boolean);
  for (const run of tries) {
    try {
      const list = await run();
      if (list && list[0]) return { track: list[0] };
    } catch {
      /* fall through to the next source */
    }
  }
  return { track: null };
}

/** Chat confirmation, only when "Announce in chat" is on. */
function announce(text) {
  const s = music().settings;
  if (s && s.chatAnnounce) window.songseek.twitch.say(text).catch(() => {});
}

/** Entry point for Twitch redemptions, !sr and the test box. */
export async function handleIncomingRequest({ user, input }) {
  if (!input) {
    announce(`@${user} include a song name or link with your request!`);
    return;
  }
  let track = null;
  let blocked = null;
  try {
    ({ track, blocked } = await resolveRequest(input));
  } catch (e) {
    console.error('[songseek] request resolve failed:', e);
  }
  if (blocked) {
    notifyError(`${user} requested a ${blocked} link — ${blocked} requests are turned off`);
    announce(`@${user} ${blocked} requests are turned off on this stream.`);
    return;
  }
  if (!track) {
    notifyError(`Couldn't find "${input}" (requested by ${user})`);
    const names = Object.entries(allowedSources())
      .filter(([, on]) => on)
      .map(([k]) => SOURCE_LABEL[k]);
    announce(names.length ? `@${user} sorry, couldn't find "${input}" on ${names.join(', ')}.` : `@${user} song requests are turned off right now.`);
    return;
  }

  const r = await enqueue({ ...track, requestedBy: user });
  const label = `${track.title} — ${track.artist}`;
  if (r.status === 'error') {
    // The player already showed the error.
    announce(`@${user} couldn't queue "${track.title}" — ${r.error}`);
  } else if (r.status === 'rate-limited') {
    notify(`${user} requested "${track.title}" — Spotify is busy, queueing shortly`);
    announce(`@${user} "${label}" is queued (#${r.position}) — Spotify is rate limiting us, it'll go in shortly.`);
  } else if (r.status === 'no-device') {
    // Kept in our list; it goes to Spotify the moment playback starts.
    notifyError(`${user} requested "${track.title}" — start playing in Spotify to queue it`);
    announce(`@${user} "${label}" is saved (#${r.position}) — it'll queue once the stream's Spotify is playing.`);
  } else {
    notify(`${user} queued "${track.title}"`);
    announce(`@${user} added "${label}" to the queue (#${r.position})`);
  }
}

// Permissions and per-command cooldowns are enforced by the bot's command system. This short
// debounce only stops two mods firing the same action back to back (mods can bypass cooldowns).
const lastRun = {};

export function handleChatCommand({ cmd, user }) {
  const now = Date.now();
  if (now - (lastRun[cmd] || 0) < 2000) return;
  lastRun[cmd] = now;

  const s = music();
  const cur = selectCurrent(s);
  switch (cmd) {
    case 'skip':
      if (!cur) return;
      next();
      notify(`${user} skipped "${cur.title}" via chat`);
      announce(`@${user} skipped "${cur.title}"`);
      break;
    case 'pause':
      if (!s.playback.playing) return;
      togglePlay();
      notify(`${user} paused via chat`);
      announce(`@${user} paused playback`);
      break;
    case 'resume':
      if (s.playback.playing) return;
      togglePlay();
      notify(`${user} resumed via chat`);
      announce(`@${user} resumed playback`);
      break;
    case 'clearqueue': {
      const n = clearQueue();
      if (!n) return;
      notify(`${user} cleared ${n} request${n === 1 ? '' : 's'} via chat`);
      announce(`@${user} cleared the pending requests (${n} song${n === 1 ? '' : 's'})`);
      break;
    }
    case 'song': {
      // A viewer asked — always answer, regardless of the announce setting.
      const by = selectRequester(s);
      window.songseek.twitch
        .say(cur ? `Now playing: ${cur.title} — ${cur.artist}${by ? ` (requested by ${by})` : ''}` : 'Nothing is playing right now.')
        .catch(() => {});
      if (cur) window.songseek.overlay.show().catch(() => {}); // replay the OBS card
      break;
    }
  }
}
