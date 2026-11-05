// One-time boot of the song-request engine: settings, Spotify/Twitch subscriptions and the
// playback controller. Called from the always-mounted MusicEngine, so it runs once per app
// session regardless of which page is open.
import { music, useMusic } from './store.js';
import { initPlayer, kick } from './player.js';
import { handleIncomingRequest, handleChatCommand } from './requests.js';
import { friendly, notify, notifyError } from './util.js';

/** Load the user's playlists into the store. */
export async function loadPlaylists() {
  const s = music();
  s.setLibrary({ loading: true });
  try {
    s.setLibrary({ playlists: await window.songseek.library.playlists(), loading: false });
  } catch (e) {
    s.setLibrary({ loading: false });
    notifyError(friendly(e));
  }
}

/** Apply a Spotify account status (connect/disconnect/reconnect) to the store. */
export function applySpotifyStatus(st) {
  const s = music();
  s.setSpotify(st);
  if (!st.connected) {
    s.setSpotify({ hasDevice: false, isPlaying: false, track: null, availableDevices: [] });
    s.setLibrary({ playlists: [], activeId: null });
  } else if (!st.needsReconnect) {
    loadPlaylists();
    window.songseek.spotify.refresh().catch(() => {});
  }
}

let booted = false;

export async function bootMusic(go) {
  useMusic.setState({ go });
  if (booted || !window.songseek) return;
  booted = true;
  const ss = window.songseek;
  const s = music();

  // Subscribe first so nothing that arrives during boot is lost.
  ss.twitch.onRequest(handleIncomingRequest);
  ss.twitch.onCommand(handleChatCommand);
  ss.twitch.onStatus((st) => music().setTwitch(st));
  ss.spotify.onStatus(applySpotifyStatus);

  try {
    const settings = await ss.settings.get();
    s.setSettings(settings);
    if (Array.isArray(settings.queue) && settings.queue.length) useMusic.setState({ queue: settings.queue });
    initPlayer(settings.volume ?? 0.8);

    const [sp, tw] = await Promise.all([ss.spotify.status(), ss.twitch.status()]);
    s.setTwitch(tw);
    applySpotifyStatus(sp);
    if (!sp.connected) kick(); // no Spotify: queued YouTube/SoundCloud clips can play right away
  } catch (e) {
    notifyError(`Song requests failed to start: ${friendly(e)}`);
  }
  useMusic.setState({ ready: true });
}

// ─── Account actions shared by the player, settings and setup guide ─

export async function connectSpotify() {
  try {
    await window.songseek.spotify.connect(); // the ss:spotify:status event updates the store
    notify('Spotify connected — keep the Spotify app open.');
    return true;
  } catch (e) {
    notifyError(friendly(e));
    return false;
  }
}

export async function disconnectSpotify() {
  try {
    applySpotifyStatus(await window.songseek.spotify.disconnect());
  } catch (e) {
    notifyError(friendly(e));
  }
}

/** Twitch is Steez's shared login (Settings page); this just starts it from here. */
export async function twitchLogin() {
  try {
    await window.steez.twitch.login();
    music().setTwitch(await window.songseek.twitch.status());
  } catch (e) {
    notifyError(`${friendly(e)} — check the Twitch app under Settings.`);
  }
}
