'use strict';
// Viewer queue state: party, queue, rules, and both overlay styles, persisted to
// <userData>/queueup-state.json. Pure Node — no Electron — so it can be unit-tested.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// Twitch connection details (channel, tokens, bot account) are not here any more:
// Steez owns the one shared Twitch connection.
const DEFAULT_SETTINGS = {
  partySize: 3,
  hostName: 'You',
  joinCommand: '!join',
  leaveCommand: '!dequeue',
  listCommand: '!queue',
  allowDuplicates: false,
  subsPriority: true,
  queueOpen: true,
  botReplies: false,
  tiktokUsername: '',
  tiktokAutoConnect: true,
};

/** Settings keys from the standalone QueueUp app that Steez never imports. */
const LEGACY_SETTINGS = ['channel', 'clientId', 'accessToken', 'refreshToken', 'botUsername', 'port', 'autoUpdate', 'autoConnect'];

const DEFAULT_OVERLAY = {
  title: 'NEXT UP',
  showTitle: true,
  showHeaderCount: true,
  maxRows: 5,
  style: 'cards',
  accent: '#a970ff',
  accent2: '#00e5c0',
  textColor: '#ffffff',
  rowBg: '#101218',
  rowOpacity: 0.72,
  radius: 14,
  scale: 1,
  width: 420,
  gap: 10,
  fontFamily: 'Inter',
  fontWeight: 700,
  showRank: true,
  showAvatar: true,
  showTimer: true,
  highlightFirst: true,
  glow: true,
  shimmer: true,
  animSpeed: 1,
  direction: 'down',
  align: 'left',
  emptyText: 'Queue is empty - type !join',
};

const DEFAULT_GIFT_OVERLAY = {
  mode: 'both', // streak | gifter | both (alternates)
  rotateSeconds: 8,
  streakTitle: 'TOP STREAK',
  gifterTitle: 'TOP GIFTER',
  showTitle: true,
  showLiveStreak: true, // jump to a combo while it is being tapped
  showDiamonds: true,
  showGiftName: true,
  showAvatar: true,
  accent: '#ffb547',
  accent2: '#a970ff',
  textColor: '#ffffff',
  bg: '#0b0d14',
  bgOpacity: 0, // 0 = fully transparent card
  ring: true,
  particles: true,
  glow: true,
  fontFamily: 'Inter',
  scale: 1,
  width: 420,
  radius: 22,
  emptyText: 'No gifts yet',
};

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function normalizeEntry(e) {
  return {
    id: e.id || makeId(),
    login: String(e.login || '').toLowerCase(),
    display: e.display || e.login || 'unknown',
    joinedAt: Number(e.joinedAt) || Date.now(),
    partySince: e.partySince ? Number(e.partySince) : undefined,
    color: e.color || null,
    avatar: e.avatar || null,
    isSub: !!e.isSub,
    isMod: !!e.isMod,
    isVip: !!e.isVip,
    source: e.source || 'chat',
    note: e.note || '',
  };
}

/** Drops settings keys that belonged to the standalone app's own Twitch/port handling. */
function stripLegacySettings(settings) {
  const out = { ...(settings || {}) };
  for (const k of LEGACY_SETTINGS) delete out[k];
  return out;
}

/**
 * Builds a Steez state file from a standalone QueueUp state file. Tokens, channel and
 * port are left behind; everything the streamer customised comes across.
 */
function importLegacyState(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    party: Array.isArray(src.party) ? src.party : [],
    queue: Array.isArray(src.queue) ? src.queue : [],
    settings: { ...DEFAULT_SETTINGS, ...stripLegacySettings(src.settings) },
    overlay: { ...DEFAULT_OVERLAY, ...(src.overlay || {}) },
    giftOverlay: { ...DEFAULT_GIFT_OVERLAY, ...(src.giftOverlay || {}) },
    gifts: src.gifts && typeof src.gifts === 'object' ? src.gifts : null,
  };
}

/** Writes through a temp file and renames it into place, so a crash never leaves half a file. */
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

class Store extends EventEmitter {
  constructor(filePath) {
    super();
    this.file = filePath;
    this.data = {
      party: [],
      queue: [],
      settings: { ...DEFAULT_SETTINGS },
      overlay: { ...DEFAULT_OVERLAY },
      giftOverlay: { ...DEFAULT_GIFT_OVERLAY },
      gifts: null, // last saved gift session, restored by the tracker on boot
    };
    this._saveTimer = null;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data.party = Array.isArray(raw.party) ? raw.party.map(normalizeEntry) : [];
        this.data.queue = Array.isArray(raw.queue) ? raw.queue.map(normalizeEntry) : [];
        this.data.settings = { ...DEFAULT_SETTINGS, ...stripLegacySettings(raw.settings) };
        this.data.overlay = { ...DEFAULT_OVERLAY, ...(raw.overlay || {}) };
        this.data.giftOverlay = { ...DEFAULT_GIFT_OVERLAY, ...(raw.giftOverlay || {}) };
        this.data.gifts = raw.gifts && typeof raw.gifts === 'object' ? raw.gifts : null;
      }
    } catch (err) {
      // Never let an unreadable file get silently overwritten by the next save -
      // move it aside so the queue can still be recovered by hand.
      console.error('[queueup] failed to load state:', err.message);
      try {
        fs.renameSync(this.file, this.file + '.corrupt');
      } catch (_) {
        /* nothing more we can do */
      }
    }
  }

  writeNow() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    try {
      writeJsonAtomic(this.file, this.data);
      return true;
    } catch (err) {
      console.error('[queueup] failed to save state:', err.message);
      return false;
    }
  }

  save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.writeNow(), 250);
  }

  /** Forces any pending write out. Call before the app can exit. */
  flush() {
    if (this._saveTimer) return this.writeNow();
    return true;
  }

  changed(reason) {
    this.save();
    this.emit('change', reason || 'update');
  }

  snapshot(extra) {
    return {
      party: this.data.party,
      queue: this.data.queue,
      settings: this.data.settings,
      overlay: this.data.overlay,
      giftOverlay: this.data.giftOverlay,
      serverTime: Date.now(),
      ...extra,
    };
  }

  /* ------------------------- lookups ------------------------- */

  findByLogin(login) {
    const l = String(login || '').toLowerCase();
    const inParty = this.data.party.find((e) => e.login === l);
    if (inParty) return { entry: inParty, list: 'party' };
    const inQueue = this.data.queue.find((e) => e.login === l);
    if (inQueue) return { entry: inQueue, list: 'queue' };
    return null;
  }

  findById(id) {
    let idx = this.data.party.findIndex((e) => e.id === id);
    if (idx >= 0) return { entry: this.data.party[idx], list: 'party', index: idx };
    idx = this.data.queue.findIndex((e) => e.id === id);
    if (idx >= 0) return { entry: this.data.queue[idx], list: 'queue', index: idx };
    return null;
  }

  /* ------------------------- mutations ------------------------- */

  addUser(user, opts = {}) {
    const login = String(user.login || user.display || '').toLowerCase().trim();
    if (!login) return { ok: false, reason: 'invalid' };

    const existing = this.findByLogin(login);
    if (existing && !this.data.settings.allowDuplicates) {
      return {
        ok: false,
        reason: existing.list === 'party' ? 'in_party' : 'already',
        position: existing.list === 'queue' ? this.data.queue.indexOf(existing.entry) + 1 : 0,
        entry: existing.entry,
      };
    }

    const entry = normalizeEntry({
      id: makeId(),
      login,
      display: user.display || user.login,
      joinedAt: Date.now(),
      color: user.color || null,
      isSub: !!user.isSub,
      isMod: !!user.isMod,
      isVip: !!user.isVip,
      source: opts.source || 'chat',
    });

    if (this.data.settings.subsPriority && entry.isSub) {
      // Insert after the trailing subscriber block so FIFO still holds within a tier.
      let idx = this.data.queue.length;
      for (let i = 0; i < this.data.queue.length; i++) {
        if (!this.data.queue[i].isSub) {
          idx = i;
          break;
        }
      }
      this.data.queue.splice(idx, 0, entry);
    } else {
      this.data.queue.push(entry);
    }

    this.changed('add');
    return { ok: true, entry, position: this.data.queue.indexOf(entry) + 1 };
  }

  removeByLogin(login) {
    const found = this.findByLogin(login);
    if (!found) return { ok: false, reason: 'not_found' };
    this.removeById(found.entry.id);
    return { ok: true, entry: found.entry, list: found.list };
  }

  removeById(id) {
    const before = this.data.party.length + this.data.queue.length;
    this.data.party = this.data.party.filter((e) => e.id !== id);
    this.data.queue = this.data.queue.filter((e) => e.id !== id);
    const changed = this.data.party.length + this.data.queue.length !== before;
    if (changed) this.changed('remove');
    return changed;
  }

  /** Moves an entry to (list, index) - the single primitive behind drag & drop. */
  move(id, targetList, targetIndex) {
    const found = this.findById(id);
    if (!found) return false;
    if (targetList !== 'party' && targetList !== 'queue') return false;

    const src = found.list === 'party' ? this.data.party : this.data.queue;
    const [entry] = src.splice(found.index, 1);
    const dst = targetList === 'party' ? this.data.party : this.data.queue;

    let idx = Math.max(0, Math.min(Number(targetIndex) || 0, dst.length));

    if (targetList === 'party') {
      const cap = Math.max(1, Number(this.data.settings.partySize) || 3);
      if (dst.length >= cap) {
        // Party full: bump the last member back to the front of the queue.
        const bumped = dst.pop();
        if (bumped) {
          bumped.joinedAt = Date.now();
          delete bumped.partySince;
          this.data.queue.unshift(bumped);
        }
        idx = Math.max(0, Math.min(idx, dst.length));
      }
      entry.partySince = entry.partySince || Date.now();
    } else if (found.list === 'party') {
      // Dropped back out of the party - restart the wait clock.
      entry.joinedAt = Date.now();
      delete entry.partySince;
    }

    dst.splice(idx, 0, entry);
    this.changed('move');
    return true;
  }

  promote(id) {
    const found = this.findById(id);
    if (!found || found.list === 'party') return false;
    return this.move(id, 'party', this.data.party.length);
  }

  toTop(id) {
    const found = this.findById(id);
    if (!found) return false;
    return this.move(id, found.list, 0);
  }

  clear(which) {
    if (which === 'party' || which === 'all') this.data.party = [];
    if (which === 'queue' || which === 'all') this.data.queue = [];
    this.changed('clear');
  }

  fillParty() {
    const cap = Math.max(1, Number(this.data.settings.partySize) || 3);
    let moved = 0;
    while (this.data.party.length < cap && this.data.queue.length > 0) {
      const entry = this.data.queue.shift();
      entry.partySince = Date.now();
      this.data.party.push(entry);
      moved++;
    }
    if (moved) this.changed('fill');
    return moved;
  }

  nextGame() {
    this.data.party = [];
    const moved = this.fillParty();
    this.changed('next');
    return moved;
  }

  updateSettings(patch) {
    this.data.settings = { ...this.data.settings, ...stripLegacySettings(patch) };
    this.changed('settings');
    return this.data.settings;
  }

  updateOverlay(patch) {
    this.data.overlay = { ...this.data.overlay, ...patch };
    this.changed('overlay');
    return this.data.overlay;
  }

  resetOverlay() {
    this.data.overlay = { ...DEFAULT_OVERLAY };
    this.changed('overlay');
    return this.data.overlay;
  }

  updateGiftOverlay(patch) {
    this.data.giftOverlay = { ...this.data.giftOverlay, ...patch };
    this.changed('giftOverlay');
    return this.data.giftOverlay;
  }

  resetGiftOverlay() {
    this.data.giftOverlay = { ...DEFAULT_GIFT_OVERLAY };
    this.changed('giftOverlay');
    return this.data.giftOverlay;
  }

  /** Persists the gift session without broadcasting a state change. */
  saveGifts(serialized) {
    this.data.gifts = serialized || null;
    this.save();
  }
}

/**
 * Renders the queue for chat, e.g.
 *   Queue (10): 1. lovediddyo⭐, 2. jeffunderdog⭐, 3. fizzyzayizbetter, ...
 * Twitch drops messages over 500 characters, so the tail is folded into a
 * "+N more" marker rather than being silently cut off.
 */
function formatQueueMessage(queue, joinCommand) {
  const q = Array.isArray(queue) ? queue : [];
  if (!q.length) return `The queue is empty — type ${joinCommand || '!join'} to get in line.`;

  const head = `Queue (${q.length}): `;
  const parts = [];
  let len = head.length;

  for (let i = 0; i < q.length; i++) {
    const piece = `${i + 1}. ${q[i].display}${q[i].isSub ? '⭐' : ''}`;
    const cost = (parts.length ? 2 : 0) + piece.length;
    const remaining = q.length - i;
    // Keep room for the "+N more" marker in case the next name doesn't fit.
    if (len + cost + 12 > 480) {
      parts.push(`+${remaining} more`);
      break;
    }
    parts.push(piece);
    len += cost;
  }

  return head + parts.join(', ');
}

module.exports = {
  Store,
  DEFAULT_SETTINGS,
  DEFAULT_OVERLAY,
  DEFAULT_GIFT_OVERLAY,
  LEGACY_SETTINGS,
  makeId,
  formatQueueMessage,
  importLegacyState,
  writeJsonAtomic,
};
