// Remote control for the user's own Spotify app: polls playback state / queue and issues
// commands (queue, next, pause, play, seek, volume, transfer). Adding to Spotify's native queue
// is what keeps the streamer's playlist context intact — the request plays next, then Spotify
// returns to whatever was on.
const { EventEmitter } = require('events');
const account = require('./spotifyAccount.cjs');

// Development-mode quota is small and shared by everyone on the same Client ID, so poll
// conservatively. The renderer interpolates progress between polls.
const STATE_ACTIVE_MS = 5000; // something is playing
const STATE_IDLE_MS = 12000; // paused / no device
const QUEUE_MS = 30000; // upcoming queue (also refreshed right after we add)
const DEVICES_MS = 20000; // device list while idle
const MAX_BACKOFF_MS = 5 * 60 * 1000;

function emptyState() {
  return {
    hasDevice: false,
    needsReconnect: false,
    availableDevices: [],
    limited: false,
    limitedUntil: 0,
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
}

class SpotifyControl extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.timer = null;
    this.queueTimer = null;
    this.state = emptyState();
    this.queue = [];
    this.backoffUntil = 0;
    this.stopped = true;
  }

  start() {
    this.stop();
    this.stopped = false;
    this.scheduleState(0);
    this.scheduleQueue(2000);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.queueTimer);
    this.timer = this.queueTimer = null;
  }

  // Self-scheduling so the cadence adapts and respects backoff; jitter keeps installs out of lockstep.
  scheduleState(delay) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      await this.pollState();
      const base = this.state.hasDevice && this.state.isPlaying ? STATE_ACTIVE_MS : STATE_IDLE_MS;
      this.scheduleState(Math.max(base, this.backoffUntil - Date.now()) + Math.floor(Math.random() * 600));
    }, delay);
  }

  scheduleQueue(delay) {
    if (this.stopped) return;
    clearTimeout(this.queueTimer);
    this.queueTimer = setTimeout(async () => {
      await this.pollQueue();
      this.scheduleQueue(Math.max(QUEUE_MS, this.backoffUntil - Date.now()) + Math.floor(Math.random() * 1500));
    }, delay);
  }

  emitState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.state);
  }

  async pollState() {
    if (Date.now() < this.backoffUntil) return;
    if (!this.store.get('spotifyLibraryTokens')) return;
    if (!account.hasPlayerScopes(this.store)) {
      this.emitState({ needsReconnect: true, hasDevice: false });
      return;
    }
    try {
      const j = await account.request(this.store, 'GET', '/me/player');
      if (!j) {
        // 204 = connected, nothing active. Spotify may still be open and idle, so list its
        // devices and let the user wake one up from Steez.
        let devices = this.idleDevices || [];
        if (Date.now() - (this.idleDevicesAt || 0) > DEVICES_MS) {
          try {
            devices = await this.devices();
            this.idleDevices = devices;
            this.idleDevicesAt = Date.now();
          } catch {
            /* keep the previous list */
          }
        }
        this.emitState({ ...emptyState(), availableDevices: devices });
        return;
      }
      this.idleDevices = null;
      const item = j.item || null;
      const d = j.device || null;
      this.emitState({
        hasDevice: true,
        needsReconnect: false,
        availableDevices: [],
        error: null,
        limited: false,
        isPlaying: !!j.is_playing,
        progressMs: j.progress_ms || 0,
        durationMs: (item && item.duration_ms) || 0,
        volumePercent: d && typeof d.volume_percent === 'number' ? d.volume_percent : null,
        deviceName: (d && d.name) || null,
        deviceId: (d && d.id) || null,
        supportsVolume: !!(d && d.supports_volume),
        track: item ? account.mapTrack(item) : null,
      });
    } catch (e) {
      this.handleError(e);
    }
  }

  async pollQueue() {
    if (Date.now() < this.backoffUntil) return;
    if (!this.store.get('spotifyLibraryTokens') || !account.hasPlayerScopes(this.store)) return;
    try {
      const j = await account.request(this.store, 'GET', '/me/player/queue');
      this.queue = ((j && j.queue) || []).map(account.mapTrack).filter(Boolean);
      this.emit('queue', this.queue);
    } catch (e) {
      if (e.code === 'RATE_LIMIT') this.rateLimited(e);
    }
  }

  // A shared quota limit isn't the user's fault — back off and say so plainly.
  rateLimited(e) {
    const secs = e.retryAfter && e.retryAfter > 0 ? e.retryAfter : 10;
    this.backoffUntil = Date.now() + Math.min(secs * 1000, MAX_BACKOFF_MS);
    this.emitState({ limited: true, limitedUntil: this.backoffUntil });
  }

  handleError(e) {
    if (e.code === 'RATE_LIMIT') return this.rateLimited(e);
    if (e.code === 'NO_DEVICE') return this.emitState({ hasDevice: false, isPlaying: false });
    if (e.code === 'NEEDS_RECONNECT') return this.emitState({ needsReconnect: true, hasDevice: false });
    if (e.code === 'NO_AUTH') return this.emitState({ ...emptyState(), error: e.message });
    this.emitState({ error: e.message });
  }

  // ─── Commands (all target the user's active device) ─────────────

  async addToQueue(uri) {
    await account.request(this.store, 'POST', `/me/player/queue?uri=${encodeURIComponent(uri)}`, { expectEmpty: true });
    this.scheduleQueue(600);
  }

  async next() {
    await account.request(this.store, 'POST', '/me/player/next', { expectEmpty: true });
    this.scheduleState(400);
    this.scheduleQueue(900);
  }

  async previous() {
    await account.request(this.store, 'POST', '/me/player/previous', { expectEmpty: true });
    this.scheduleState(400);
  }

  async pause() {
    await account.request(this.store, 'PUT', '/me/player/pause', { expectEmpty: true });
    this.emitState({ isPlaying: false });
    this.scheduleState(400);
  }

  async play(body) {
    await account.request(this.store, 'PUT', '/me/player/play', { body, expectEmpty: true });
    this.emitState({ isPlaying: true });
    this.scheduleState(550);
    this.scheduleQueue(1100);
  }

  async seek(ms) {
    await account.request(this.store, 'PUT', `/me/player/seek?position_ms=${Math.max(0, Math.round(ms))}`, { expectEmpty: true });
    this.emitState({ progressMs: Math.round(ms) });
    this.scheduleState(450);
  }

  async setVolume(percent) {
    const v = Math.max(0, Math.min(100, Math.round(percent)));
    await account.request(this.store, 'PUT', `/me/player/volume?volume_percent=${v}`, { expectEmpty: true });
    this.emitState({ volumePercent: v });
  }

  /** Start a playlist (or Liked Songs, which has no context uri) on the user's device. */
  async playContext({ contextUri, uris, offset } = {}) {
    const body = contextUri ? { context_uri: contextUri } : { uris };
    if (offset != null) body.offset = { position: offset };
    await this.play(body);
  }

  async devices() {
    const j = await account.request(this.store, 'GET', '/me/player/devices');
    return (j && j.devices) || [];
  }

  /** Move playback to a device (wakes one up when Spotify is open but idle). */
  async transferTo(deviceId, play = true) {
    await account.request(this.store, 'PUT', '/me/player', { body: { device_ids: [deviceId], play }, expectEmpty: true });
    this.scheduleState(750);
  }

  /** Poll right now (used when the UI boots so it doesn't wait for the next tick). */
  refresh() {
    this.scheduleState(0);
    this.scheduleQueue(300);
  }
}

module.exports = { SpotifyControl };
