'use strict';
const { EventEmitter } = require('events');

/**
 * Watches a TikTok LIVE stream for gifts.
 *
 * TikTok has no official gifts API for creators, so this rides the same
 * websocket the TikTok website uses, via `tiktok-live-connector`. Nothing is
 * needed from the user beyond their @username: the app finds their live room,
 * connects, and stays connected. If they aren't live yet it waits and checks
 * back until they are, so it can be left running from before the stream starts.
 *
 * The connection handshake is signed by a free third-party service (Euler
 * Stream). Only the free route is used here - the connector's optional
 * `enableExtendedGiftInfo` would call a paid one, so it stays off and gift
 * names, values and pictures are read from the gift event itself instead.
 */

const OFFLINE_RETRY_MS = 30 * 1000;   // how often to re-check while they're not live
const RECONNECT_MS = 5 * 1000;        // after the socket drops mid-stream
const MAX_BACKOFF_MS = 60 * 1000;

function firstUrl(img) {
  if (!img) return '';
  if (typeof img === 'string') return img;
  const list = img.mUrls || img.urlList || img.url_list || img.urls || img.url;
  if (Array.isArray(list)) return list.find(u => typeof u === 'string' && u) || '';
  if (typeof list === 'string') return list;
  return '';
}

/**
 * Turns a raw gift message into the small, stable shape the rest of the app
 * uses. The library has changed field names between versions, so every
 * spelling seen so far is read.
 */
function normalizeGift(d) {
  if (!d || typeof d !== 'object') return null;
  const u = d.user || {};
  const g = d.gift || d.giftDetails || d.extendedGiftInfo || {};

  const login = String(u.uniqueId || u.displayId || u.display_id || '').toLowerCase();
  if (!login) return null;

  const avatar =
    u.profilePictureUrl ||
    firstUrl(u.avatarThumb) || firstUrl(u.avatarMedium) || firstUrl(u.avatarLarge) ||
    firstUrl(u.profilePicture) || firstUrl(u.profilePictureMedium) || '';

  const giftType = Number(g.type ?? g.giftType ?? g.gift_type ?? d.giftType ?? 0);

  return {
    login,
    name: u.nickname || login,
    avatar,
    userId: String(u.id || u.userId || u.idStr || ''),
    giftId: String(d.giftId ?? g.id ?? ''),
    giftName: g.name || g.giftName || d.giftName || 'Gift',
    giftImage: firstUrl(g.image) || firstUrl(g.giftImage) || firstUrl(g.icon) || d.giftPictureUrl || '',
    diamonds: Number(g.diamondCount ?? g.diamond_count ?? 0) || 0,
    giftType,
    repeatCount: Math.max(1, Number(d.repeatCount) || 1),
    repeatEnd: !!(d.repeatEnd && Number(d.repeatEnd) !== 0),
    isGalleryGift: !!(g.isGalleryGift || d.isGalleryGift),
    at: Date.now()
  };
}

class TikTokLive extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {Function} [opts.connectionFactory] - (username, options) => connection; injectable for tests
   */
  constructor(opts = {}) {
    super();
    this.factory = opts.connectionFactory || null;
    this.conn = null;
    this.username = '';
    this.status = 'idle';      // idle | checking | waiting | connecting | live | error
    this.detail = '';
    this.roomId = '';
    this.viewers = 0;
    this.timer = null;
    this.stopped = true;
    this.failures = 0;
    this._lib = null;
    this._libPromise = null;
  }

  get state() {
    return {
      status: this.status,
      username: this.username,
      detail: this.detail,
      roomId: this.roomId,
      viewers: this.viewers
    };
  }

  setStatus(status, detail) {
    this.status = status;
    this.detail = detail || '';
    this.emit('status', this.state);
  }

  /**
   * Loads the connector once, lazily - it's a big module most launches never
   * touch. It ships as ESM only, and the Node inside Electron can't require()
   * an ES module, so fall back to a dynamic import() when require refuses.
   * (Plain Node 22+ can require it, which also lets tests stub it.)
   */
  async loadLib() {
    if (this.factory) return null;
    if (this._lib) return this._lib;
    if (!this._libPromise) {
      this._libPromise = (async () => {
        try {
          return require('tiktok-live-connector');
        } catch (err) {
          if (err && err.code !== 'ERR_REQUIRE_ESM' && !/ES Module/i.test(String(err.message))) throw err;
          const mod = await import('tiktok-live-connector');
          return mod && mod.TikTokLiveConnection ? mod : (mod.default || mod);
        }
      })();
    }
    this._lib = await this._libPromise;
    return this._lib;
  }

  makeConnection(username) {
    const options = { enableExtendedGiftInfo: false, processInitialData: false, fetchRoomInfoOnConnect: true };
    if (this.factory) return this.factory(username, options);
    const { TikTokLiveConnection } = this._lib;
    return new TikTokLiveConnection(username, options);
  }

  eventNames() {
    const stats = { RANK_UPDATE: 'rankUpdate', GAME_RANK_NOTIFY: 'gameRankNotify', GIFT_PANEL_UPDATE: 'giftPanelUpdate' };
    if (this.factory) return { GIFT: 'gift', ROOM_USER: 'roomUser', STREAM_END: 'streamEnd', DISCONNECTED: 'disconnected', ERROR: 'error', ...stats };
    const { WebcastEvent, ControlEvent } = this._lib;
    return {
      GIFT: WebcastEvent.GIFT,
      ROOM_USER: WebcastEvent.ROOM_USER,
      STREAM_END: WebcastEvent.STREAM_END,
      DISCONNECTED: ControlEvent.DISCONNECTED,
      ERROR: ControlEvent.ERROR,
      // Daily gaming rank and Gift Gallery progress (see tiktokStats.cjs).
      RANK_UPDATE: WebcastEvent.RANK_UPDATE || stats.RANK_UPDATE,
      GAME_RANK_NOTIFY: WebcastEvent.GAME_RANK_NOTIFY || stats.GAME_RANK_NOTIFY,
      GIFT_PANEL_UPDATE: WebcastEvent.GIFT_PANEL_UPDATE || stats.GIFT_PANEL_UPDATE
    };
  }

  static cleanUsername(raw) {
    return String(raw || '')
      .trim()
      .replace(/^https?:\/\/(www\.)?tiktok\.com\//i, '')
      .replace(/\/live.*$/i, '')
      .replace(/^@/, '')
      .replace(/[^a-z0-9._]/gi, '')
      .toLowerCase();
  }

  /** Start watching. Safe to call while not live - it waits. */
  start(username) {
    const u = TikTokLive.cleanUsername(username);
    this.stop(true);
    if (!u) {
      this.setStatus('error', 'Enter your TikTok username');
      return;
    }
    this.username = u;
    this.stopped = false;
    this.failures = 0;
    this.attempt();
  }

  stop(silent) {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    this.teardown();
    this.roomId = '';
    this.viewers = 0;
    if (!silent) this.setStatus('idle', '');
  }

  teardown() {
    const c = this.conn;
    this.conn = null;
    if (!c) return;
    try { c.removeAllListeners && c.removeAllListeners(); } catch (_) {}
    try { const p = c.disconnect && c.disconnect(); if (p && p.catch) p.catch(() => {}); } catch (_) {}
  }

  schedule(ms) {
    clearTimeout(this.timer);
    if (this.stopped) return;
    this.timer = setTimeout(() => this.attempt(), ms);
  }

  async attempt() {
    if (this.stopped) return;
    this.teardown();

    let conn;
    try {
      await this.loadLib();
      if (this.stopped) return;
      conn = this.makeConnection(this.username);
    } catch (err) {
      this.setStatus('error', 'TikTok support failed to load: ' + String(err && err.message || err).slice(0, 200));
      this.emit('log', { type: 'error', text: 'TikTok: ' + String(err && err.message || err).slice(0, 200) });
      return;
    }
    this.conn = conn;
    const ev = this.eventNames();

    conn.on(ev.GIFT, d => {
      const gift = normalizeGift(d);
      if (gift) this.emit('gift', gift);
    });
    // Raw payloads, passed through untouched: parsing lives in tiktokStats.cjs.
    conn.on(ev.RANK_UPDATE, d => this.emit('rankUpdate', d));
    conn.on(ev.GAME_RANK_NOTIFY, d => this.emit('gameRankNotify', d));
    conn.on(ev.GIFT_PANEL_UPDATE, d => this.emit('giftPanelUpdate', d));
    conn.on(ev.ROOM_USER, d => {
      const n = Number(d && d.viewerCount);
      if (Number.isFinite(n)) { this.viewers = n; this.emit('viewers', n); }
    });
    conn.on(ev.STREAM_END, () => {
      if (this.stopped) return;
      this.emit('log', { type: 'info', text: `@${this.username} ended the LIVE - waiting for the next one.` });
      this.teardown();
      this.roomId = '';
      this.setStatus('waiting', 'Stream ended - waiting for you to go live');
      this.schedule(OFFLINE_RETRY_MS);
    });
    conn.on(ev.DISCONNECTED, () => {
      if (this.stopped || this.conn !== conn) return;
      this.setStatus('connecting', 'Reconnecting...');
      this.schedule(RECONNECT_MS);
    });
    conn.on(ev.ERROR, () => { /* surfaced through connect() rejections and status below */ });

    // Only poll for liveness first when we can; skip straight to connect otherwise.
    this.setStatus(this.roomId ? 'connecting' : 'checking', `Checking @${this.username}`);
    try {
      if (typeof conn.fetchIsLive === 'function') {
        const live = await conn.fetchIsLive();
        if (this.stopped || this.conn !== conn) return;
        if (!live) {
          this.teardown();
          this.setStatus('waiting', `@${this.username} isn't live yet - watching for the stream to start`);
          this.schedule(OFFLINE_RETRY_MS);
          return;
        }
      }
      this.setStatus('connecting', `Joining @${this.username}'s LIVE`);
      const st = await conn.connect();
      if (this.stopped || this.conn !== conn) return;
      this.failures = 0;
      this.roomId = String((st && st.roomId) || conn.roomId || '');
      this.setStatus('live', `Connected to @${this.username}'s LIVE`);
      this.emit('log', { type: 'info', text: `Watching gifts on @${this.username}'s LIVE` });
    } catch (err) {
      if (this.stopped || this.conn !== conn) return;
      const msg = String((err && err.message) || err);
      this.teardown();
      const offline = /offline|isn't online|not online|status.*4/i.test(msg) || (err && err.name === 'UserOfflineError');
      if (offline) {
        this.setStatus('waiting', `@${this.username} isn't live yet - watching for the stream to start`);
        this.schedule(OFFLINE_RETRY_MS);
        return;
      }
      if (/not found|Failed to retrieve|Invalid.*unique/i.test(msg)) {
        this.setStatus('error', `Couldn't find @${this.username} on TikTok`);
        this.emit('log', { type: 'error', text: `TikTok: ${msg.slice(0, 160)}` });
        return;
      }
      this.failures++;
      const wait = Math.min(RECONNECT_MS * Math.pow(2, this.failures - 1), MAX_BACKOFF_MS);
      this.setStatus('connecting', `Retrying in ${Math.round(wait / 1000)}s`);
      this.emit('log', { type: 'warn', text: `TikTok connection failed: ${msg.slice(0, 160)}` });
      this.schedule(wait);
    }
  }
}

module.exports = { TikTokLive, normalizeGift, OFFLINE_RETRY_MS, RECONNECT_MS };
