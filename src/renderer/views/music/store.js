// Module-level song-request state. Lives outside React so playback, the request queue and the
// Spotify subscriptions keep running while the Song Requests page is unmounted.
import { create } from 'zustand';

const emptySpotify = {
  connected: false,
  user: null,
  needsReconnect: false,
  hasDevice: false,
  availableDevices: [],
  limited: false,
  error: null,
  isPlaying: false,
  progressMs: 0,
  durationMs: 0,
  volumePercent: null,
  deviceName: null,
  deviceId: null,
  supportsVolume: false,
  track: null,
};

export const useMusic = create((set) => ({
  ready: false,
  settings: null,
  queue: [], // pending requests (removable); persisted in the main-process store
  pushedUri: null, // the request already handed to Spotify's own queue
  spotifyRequest: null, // { uri, requestedBy } — the request Spotify is playing right now
  spotifyQueue: [], // what Spotify says is coming up (display only)
  local: { track: null, playing: false }, // YouTube/SoundCloud playing inside Steez
  playback: { playing: false, positionMs: 0, durationMs: 0 },
  spotify: { ...emptySpotify },
  library: { playlists: [], loading: false, activeId: null },
  twitch: { connected: false, loggedIn: false, user: null },
  go: null, // shell navigation (from MusicEngine)

  setSettings: (settings) => set({ settings }),
  patchSettings: async (patch) => {
    const settings = await window.songseek.settings.set(patch);
    set({ settings });
    return settings;
  },
  setQueue: (queue) => {
    set({ queue });
    window.songseek.settings.set({ queue }).catch(() => {});
  },
  setPushedUri: (pushedUri) => set({ pushedUri }),
  setSpotifyRequest: (spotifyRequest) => set({ spotifyRequest }),
  setSpotifyQueue: (spotifyQueue) => set({ spotifyQueue }),
  setLocal: (local) => set({ local }),
  setPlayback: (p) => set((s) => ({ playback: { ...s.playback, ...p } })),
  setSpotify: (p) => set((s) => ({ spotify: { ...s.spotify, ...p } })),
  setLibrary: (p) => set((s) => ({ library: { ...s.library, ...p } })),
  setTwitch: (p) => set((s) => ({ twitch: { ...s.twitch, ...p } })),
}));

export const music = () => useMusic.getState();

/** What's on right now: a local YouTube/SoundCloud clip takes over while it plays. */
export const selectCurrent = (s) => s.local.track || s.spotify.track || null;
export const selectIsLocal = (s) => !!s.local.track;
/** Who requested what's playing (null for the streamer's own music). */
export const selectRequester = (s) => {
  if (s.local.track) return s.local.track.requestedBy || null;
  const r = s.spotifyRequest;
  return r && s.spotify.track && s.spotify.track.uri === r.uri ? r.requestedBy : null;
};
