// Playback controller. Steez is a REMOTE CONTROL for the streamer's own Spotify app — it never
// plays Spotify audio itself. Requests are held in our queue (so they can be removed) and handed
// to Spotify's native queue ONE AT A TIME, which makes them play next and then return to whatever
// playlist/album was already on.
//
// YouTube / SoundCloud can't go into Spotify's queue, so they play here: at the next Spotify track
// boundary we pause Spotify, play the clip, then resume Spotify. When Spotify isn't connected or
// has no device, clips simply play back to back.
import { music } from './store.js';
import { friendly, notifyError } from './util.js';

const P = {
  yt: { audio: null, token: 0 },
  sc: { widget: null, iframe: null, playing: false },
  local: { track: null, playing: false },
  pushedUri: null, // request currently handed to Spotify
  lastSpotifyUri: undefined,
  lastSpotifyVolume: undefined,
  volume: 0.8,
  resumeSpotifyAfterLocal: false,
  starting: false,
};

const SP = () => window.songseek.spotify;
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

function setPushed(uri) {
  P.pushedUri = uri;
  music().setPushedUri(uri);
}

// A clip must come out at the SAME level as Spotify or it blasts over a quiet stream. Spotify's
// own device volume is the source of truth when known; the in-app slider is the fallback.
function effectiveVolume() {
  const pct = music().spotify.volumePercent;
  if (typeof pct === 'number' && pct >= 0) return (P.lastSpotifyVolume = pct / 100);
  if (typeof P.lastSpotifyVolume === 'number') return P.lastSpotifyVolume; // Spotify idle — reuse the last level
  return P.volume;
}

function applyLocalVolume(v) {
  const x = Math.max(0, Math.min(1, v));
  try {
    if (P.yt.audio) P.yt.audio.volume = x;
  } catch {
    /* ignore */
  }
  try {
    if (P.sc.widget) P.sc.widget.setVolume(x * 100);
  } catch {
    /* ignore */
  }
}

// ─── Request queue ─────────────────────────────────────────────────

/**
 * Add a request. Resolves with what ACTUALLY happened to THIS request ({ position, status,
 * error? }) so chat isn't told "queued!" when Spotify can't take it:
 * 'queued' | 'rate-limited' | 'no-device' | 'error'.
 */
export async function enqueue(track) {
  const s = music();
  const item = { id: newId(), ...track };
  s.setQueue([...s.queue, item]);
  const position = music().queue.length;
  const r = await reconcile();
  if (r.status === 'error' && r.id === item.id) return { position, status: 'error', error: r.error };
  if (item.source === 'spotify') {
    const sp = music().spotify;
    if (!spotifyLive(music())) return { position, status: 'no-device' };
    if (sp.limited) return { position, status: 'rate-limited' };
  }
  return { position, status: 'queued' };
}

export function removeFromQueue(id) {
  const s = music();
  const item = s.queue.find((t) => t.id === id);
  // The on-deck song already lives in Spotify's queue and Spotify has no remove-from-queue API.
  if (item && item.uri && item.uri === P.pushedUri) {
    notifyError('That song is already queued in Spotify — skip it when it comes up.');
    return;
  }
  s.setQueue(s.queue.filter((t) => t.id !== id));
}

/** Clears pending requests (the one already handed to Spotify can't be pulled back). */
export function clearQueue() {
  const s = music();
  const kept = s.queue.filter((t) => t.uri && t.uri === P.pushedUri);
  const removed = s.queue.length - kept.length;
  s.setQueue(kept);
  return removed;
}

/** "Play now": Spotify tracks are queued then skipped to, so the user's context is preserved. */
export async function playNow(track) {
  const s = music();
  try {
    if (track.source === 'spotify') {
      stopLocal();
      await SP().addToQueue(track.uri);
      await SP().next();
    } else {
      const item = { id: newId(), ...track };
      s.setQueue([item, ...s.queue]);
      await startLocal(item);
    }
  } catch (e) {
    notifyError(friendly(e));
  }
}

export async function playFromQueue(id) {
  const s = music();
  const track = s.queue.find((t) => t.id === id);
  if (!track) return;
  s.setQueue([track, ...s.queue.filter((t) => t.id !== id)]);
  if (track.source !== 'spotify') return startLocal(track);
  try {
    stopLocal();
    if (track.uri !== P.pushedUri) await SP().addToQueue(track.uri);
    await SP().next();
    if (track.uri === P.pushedUri) setPushed(null);
    music().setQueue(music().queue.filter((t) => t.id !== id));
  } catch (e) {
    notifyError(friendly(e));
  }
}

// ─── Transport (Spotify, or the local clip while one plays) ────────

export function next() {
  if (P.local.track) return endLocal();
  SP()
    .next()
    .catch((e) => notifyError(friendly(e)));
}

export function prev() {
  if (P.local.track) return seek(0);
  SP()
    .previous()
    .catch((e) => notifyError(friendly(e)));
}

export function togglePlay() {
  if (P.local.track) {
    const el = P.yt.audio;
    if (el && P.local.track.source === 'youtube') {
      if (el.paused) el.play().catch(() => {});
      else el.pause();
      return;
    }
    if (P.sc.widget) P.sc.widget.toggle();
    return;
  }
  const playing = music().playback.playing;
  (playing ? SP().pause() : SP().resume()).catch((e) => notifyError(friendly(e)));
}

export function seek(ms) {
  if (P.local.track) {
    if (P.yt.audio && P.local.track.source === 'youtube') {
      try {
        P.yt.audio.currentTime = ms / 1000;
      } catch {
        /* ignore */
      }
    } else if (P.sc.widget) P.sc.widget.seekTo(ms);
  } else {
    SP()
      .seek(ms)
      .catch(() => {});
  }
  music().setPlayback({ positionMs: ms });
}

// Volume slider: local players follow instantly; Spotify and the saved setting are debounced so
// dragging doesn't fire dozens of Web API calls.
let volTimer = null;
export function setVolume(v) {
  P.volume = v;
  P.lastSpotifyVolume = v;
  applyLocalVolume(v);
  music().setSpotify({ volumePercent: music().spotify.hasDevice ? Math.round(v * 100) : music().spotify.volumePercent });
  clearTimeout(volTimer);
  volTimer = setTimeout(() => {
    if (music().spotify.hasDevice) SP().setVolume(Math.round(v * 100)).catch(() => {});
    music()
      .patchSettings({ volume: v })
      .catch(() => {});
  }, 250);
}

// ─── Playlists (started on Spotify) ────────────────────────────────

export async function playPlaylist(tracks, meta) {
  const s = music();
  try {
    stopLocal();
    if (meta.uri) await SP().playContext({ contextUri: meta.uri, offset: 0 });
    else {
      // Liked Songs (or a shuffled list) has no context URI — send a batch of track URIs instead.
      await SP().playContext({ uris: (tracks || []).slice(0, 100).map((t) => t.uri).filter(Boolean) });
    }
    s.setLibrary({ activeId: meta.id });
    return true;
  } catch (e) {
    notifyError(friendly(e));
    return false;
  }
}

// ─── Local (YouTube / SoundCloud) playback ─────────────────────────

function ensureYtAudio() {
  if (P.yt.audio) return P.yt.audio;
  const el = new Audio();
  el.preload = 'auto';
  el.volume = effectiveVolume();
  el.addEventListener('ended', () => P.local.track && P.local.track.source === 'youtube' && endLocal());
  el.addEventListener('playing', () => music().setPlayback({ playing: true }));
  el.addEventListener('pause', () => {
    if (P.local.track && !el.ended) music().setPlayback({ playing: false });
  });
  el.addEventListener('error', () => {
    if (P.local.track && P.local.track.source === 'youtube' && el.getAttribute('src')) {
      notifyError('YouTube audio failed — skipping');
      endLocal();
    }
  });
  P.yt.audio = el;
  return el;
}

function ensureScIframe() {
  if (P.sc.iframe) return P.sc.iframe;
  const iframe = document.createElement('iframe');
  iframe.allow = 'autoplay';
  iframe.title = 'SoundCloud player';
  iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:480px;height:166px;border:0;';
  document.body.appendChild(iframe);
  P.sc.iframe = iframe;
  return iframe;
}

/** Silence both in-app players. */
function silenceLocal() {
  try {
    if (P.yt.audio) {
      P.yt.token++; // cancel a stream that is still resolving
      P.yt.audio.pause();
      P.yt.audio.removeAttribute('src');
      P.yt.audio.load();
    }
  } catch {
    /* ignore */
  }
  try {
    if (P.sc.widget) P.sc.widget.pause();
  } catch {
    /* ignore */
  }
  P.sc.playing = false;
}

/** Drop the current clip without resuming Spotify (something else is taking over). */
function stopLocal() {
  if (!P.local.track) return;
  silenceLocal();
  P.local = { track: null, playing: false };
  P.resumeSpotifyAfterLocal = false;
  music().setLocal({ track: null, playing: false });
}

async function startLocal(track) {
  if (P.starting) return;
  P.starting = true;
  const s = music();
  try {
    // Take over the airwaves. If a clip is already on, keep its "resume Spotify after" decision.
    if (P.local.track) silenceLocal();
    else {
      const wasPlaying = s.spotify.isPlaying;
      if (wasPlaying) await SP().pause().catch(() => {});
      P.resumeSpotifyAfterLocal = wasPlaying;
    }
    P.local = { track, playing: true };
    s.setLocal({ track, playing: true });
    s.setPlayback({ playing: true, positionMs: 0, durationMs: track.durationMs || 0 });
    // It's on now, not pending.
    s.setQueue(music().queue.filter((t) => t.id !== track.id));
    pushOverlay(track);

    if (track.source === 'youtube') {
      const el = ensureYtAudio();
      const token = ++P.yt.token;
      const info = await window.songseek.search.resolveYoutubeStream(track.sourceId);
      if (token !== P.yt.token) return; // superseded while resolving
      el.src = info.streamUrl;
      el.volume = effectiveVolume();
      if (info.durationMs) music().setPlayback({ durationMs: info.durationMs });
      await el.play();
    } else {
      playSoundcloud(track);
    }
  } catch (e) {
    notifyError(`Couldn't play "${track.title}" — skipping (${friendly(e)})`);
    music().setQueue(music().queue.filter((t) => t.id !== track.id));
    P.starting = false;
    endLocal();
  } finally {
    P.starting = false;
  }
}

function endLocal() {
  silenceLocal();
  P.local = { track: null, playing: false };
  music().setLocal({ track: null, playing: false });
  // Back to mirroring Spotify (the next state poll fills this in again).
  const sp = music().spotify;
  music().setPlayback({ playing: false, positionMs: sp.progressMs || 0, durationMs: sp.durationMs || 0 });
  if (P.resumeSpotifyAfterLocal) {
    P.resumeSpotifyAfterLocal = false;
    SP()
      .resume()
      .catch(() => {});
  }
  setTimeout(reconcile, 300); // let the reconcile loop pick up whatever is next
}

function playSoundcloud(track) {
  const iframe = ensureScIframe();
  iframe.src = 'https://w.soundcloud.com/player/?' + new URLSearchParams({ url: track.url, auto_play: 'true', visual: 'false' });
  const bind = () => {
    const widget = window.SC.Widget(iframe);
    P.sc.widget = widget;
    const E = window.SC.Widget.Events;
    const mine = () => P.local.track && P.local.track.id === track.id;
    widget.bind(E.READY, () => {
      if (!mine()) return;
      widget.setVolume(effectiveVolume() * 100);
      widget.play();
    });
    widget.bind(E.FINISH, () => mine() && endLocal());
    widget.bind(E.PLAY, () => {
      P.sc.playing = true;
      if (mine()) music().setPlayback({ playing: true });
    });
    widget.bind(E.PAUSE, () => {
      P.sc.playing = false;
      if (mine()) music().setPlayback({ playing: false });
    });
    widget.bind(E.ERROR, () => {
      if (!mine()) return;
      notifyError(`SoundCloud couldn't play "${track.title}" — skipping`);
      endLocal();
    });
  };
  loadScApi()
    .then(bind)
    .catch(() => {
      notifyError('SoundCloud player failed to load — skipping');
      endLocal();
    });
}

let scApi = null;
function loadScApi() {
  if (window.SC && window.SC.Widget) return Promise.resolve();
  scApi ||= new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'https://w.soundcloud.com/player/api.js';
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scApi = null;
      el.remove();
      reject(new Error('SoundCloud API unavailable'));
    };
    document.head.appendChild(el);
  });
  return scApi;
}

// ─── Reconciliation with Spotify's real state ──────────────────────

/** Hand the next request to Spotify (one at a time) or start a local clip; reports what happened. */
async function reconcile() {
  const s = music();
  if (P.local.track || P.starting) return { status: 'busy' };
  const head = s.queue[0];
  if (!head) return { status: 'empty' };
  if (!spotifyLive(s)) {
    // No Spotify playback, so no track boundary to wait for: play clips back to back. Spotify
    // requests stay saved until Spotify is playing again.
    const clip = s.queue.find((t) => t.source !== 'spotify');
    if (clip) startLocal(clip);
    return { status: clip ? 'playing' : 'no-device' };
  }
  if (head.source !== 'spotify') return { status: 'local-pending' }; // waits for the current Spotify song to end
  // A rate limit is temporary — the song stays queued and goes over on the next good poll.
  if (s.spotify.limited) return { status: 'rate-limited' };
  if (P.pushedUri) return { status: 'waiting' }; // one already on deck

  setPushed(head.uri);
  try {
    await SP().addToQueue(head.uri);
    return { status: 'pushed', id: head.id };
  } catch (e) {
    // Dropped rather than retried on every poll (Premium/permission errors never clear by themselves).
    setPushed(null);
    const error = friendly(e);
    music().setQueue(music().queue.filter((t) => t.id !== head.id));
    notifyError(`Couldn't queue "${head.title}" in Spotify: ${error}`);
    return { status: 'error', error, id: head.id };
  }
}

const spotifyLive = (s) => s.spotify.connected && s.spotify.hasDevice;

export function onSpotifyState(state) {
  const s = music();
  s.setSpotify(state);

  // Follow Spotify's level so a later clip matches it, and keep a playing clip in step.
  if (typeof state.volumePercent === 'number' && state.volumePercent >= 0) {
    const v = state.volumePercent / 100;
    if (P.lastSpotifyVolume !== v) {
      P.lastSpotifyVolume = v;
      if (P.local.track) applyLocalVolume(v);
    }
  }

  const uri = state.track && state.track.uri;
  const boundary = P.lastSpotifyUri !== undefined && uri !== P.lastSpotifyUri;
  P.lastSpotifyUri = uri;

  // Our on-deck request started playing → it's no longer pending.
  if (P.pushedUri && uri === P.pushedUri) {
    setPushed(null);
    s.setQueue(music().queue.filter((t) => t.uri !== uri));
  }

  if (!P.local.track) {
    s.setPlayback({ playing: state.isPlaying, positionMs: state.progressMs, durationMs: state.durationMs });
    if (boundary && uri) {
      // `s` is the snapshot from before the on-deck request was removed above.
      const req = s.queue.find((t) => t.uri === uri);
      s.setSpotifyRequest(req ? { uri, requestedBy: req.requestedBy } : null);
      pushOverlay(req ? { ...state.track, requestedBy: req.requestedBy } : state.track);
    }
    // A queued YouTube/SoundCloud clip gets its turn at a track boundary.
    const head = music().queue[0];
    if (boundary && head && head.source !== 'spotify') {
      startLocal(head);
      return;
    }
  }
  reconcile();
}

/** Spotify's own upcoming queue (display) + releasing the on-deck slot once it's gone. */
export function onSpotifyQueue(list) {
  const s = music();
  s.setSpotifyQueue(list);
  if (!P.pushedUri) return;
  const stillQueued = list.some((t) => t.uri === P.pushedUri);
  const nowPlaying = s.spotify.track && s.spotify.track.uri === P.pushedUri;
  if (!stillQueued && !nowPlaying) {
    const gone = P.pushedUri;
    setPushed(null);
    s.setQueue(music().queue.filter((t) => t.uri !== gone));
    reconcile();
  }
}

/** Kick the queue (e.g. after Spotify connects). */
export const kick = () => reconcile();

function pushOverlay(track) {
  if (!track) return;
  window.songseek.overlay
    .update({
      title: track.title,
      artist: track.artist,
      artwork: track.artwork || '',
      requestedBy: track.requestedBy && track.requestedBy !== 'You' ? track.requestedBy : null,
    })
    .catch(() => {});
}

// ─── Init ──────────────────────────────────────────────────────────

let started = false;
export function initPlayer(volume) {
  if (started) return;
  started = true;
  P.volume = volume ?? 0.8;
  SP().onState(onSpotifyState);
  SP().onQueue(onSpotifyQueue);

  // Smooth progress between Spotify polls; read the clip position while one plays.
  setInterval(() => {
    const s = music();
    if (P.local.track) {
      const el = P.yt.audio;
      if (P.local.track.source === 'youtube' && el && el.getAttribute('src')) {
        s.setPlayback({
          playing: !el.paused,
          positionMs: (el.currentTime || 0) * 1000,
          durationMs: el.duration && isFinite(el.duration) ? el.duration * 1000 : s.playback.durationMs,
        });
      } else if (P.local.track.source === 'soundcloud' && P.sc.widget) {
        try {
          P.sc.widget.getPosition((pos) => music().setPlayback({ positionMs: pos || 0, playing: P.sc.playing }));
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (s.playback.playing && s.playback.durationMs) {
      s.setPlayback({ positionMs: Math.min(s.playback.positionMs + 250, s.playback.durationMs) });
    }
  }, 250);
}
