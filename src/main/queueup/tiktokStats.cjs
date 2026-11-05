'use strict';
// TikTok LIVE daily gaming rank + Gift Gallery progress, for the two small "stats" overlays.
//
// The data rides the same tiktok-live-connector socket as gifts:
//   rankUpdate       (WebcastRankUpdateMessage)      updates[].{rankType, ownRank, currentScore, defaultContent}
//   gameRankNotify   (WebcastGameRankNotifyMessage)  {msgType, notifyText}
//   giftPanelUpdate  (WebcastGiftPanelUpdateMessage) galleryData.{progress{giftId: {goalCount, currentSponsorId}}, period, endTimeInMs}
// None of these have been seen live yet, so every parser is forgiving: enums may arrive as
// numbers or as their names, numbers as strings, and anything missing is simply ignored.
// Pure Node — no Electron — so it can be unit-tested.
const fs = require('fs');

/** ProfitRankType from tiktok-live-proto v3. */
const RANK_TYPES = {
  TYPE_HOURLY_RANK: 0,
  TYPE_WEEKLY_RANK: 1,
  TYPE_HOURLY_STAR_RANK: 2,
  TYPE_WEEKLY_RISING_RANK_ACTIVITY: 3,
  TYPE_WEEKLY_RISING_RANK: 4,
  TYPE_WEEKLY_ROOKIE: 5,
  TYPE_E_COMMERCE_WEEKLY: 6,
  TYPE_E_COMMERCE_DAILY: 7,
  TYPE_DAILY_RANK: 8,
  TYPE_FIRST_GIFT_RANK: 9,
  TYPE_GAME_RANK: 10,
  TYPE_DAILY_GAME: 11,
  TYPE_HALL_OF_FAME_RANK: 12,
  TYPE_RANK_LEAGUE: 13,
  DAILY_ROOKIE: 14,
  TYPE_TEAM_RANK: 15,
  TYPE_CLASS_RANK: 16,
  TYPE_DAILY_GAME_PUB_G: 20,
  TYPE_DAILY_GAME_MLB_B: 21,
  TYPE_DAILY_GAME_FREE_FIRE: 22,
  TYPE_CAMPAIGN_LEAGUEMATCH_RANK: 101,
};
const DAILY_GAME = RANK_TYPES.TYPE_DAILY_GAME;
const GAME_RANK = RANK_TYPES.TYPE_GAME_RANK;

/** GameRankNotifyMessageMsgType from tiktok-live-proto v3. */
const NOTIFY_TYPES = {
  MSG_TYPE_RANK_IN_OUT: 0,
  MSG_TYPE_RANK_CHANGE: 1,
  MSG_TYPE_ANCHOR_ENCOURAGE: 2,
  MSG_TYPE_UN_KNOW: 255,
};

const DEFAULT_STATS_STYLE = {
  rankLabel: 'GAMING · DAILY',
  galleryLabel: 'GIFT GALLERY',
  showLabel: true,
  showScore: true,
  showBar: true,
  unrankedText: 'Unranked',
  accent: '#d4d4d4',
  textColor: '#f2f2f2',
  bg: '#121212',
  bgOpacity: 0.82,
  scale: 1,
};

const DEFAULT_MANUAL = {
  rankEnabled: false,
  rankValue: '',
  galleryEnabled: false,
  galleryCollected: 0,
  galleryTotal: 25,
};

function emptyRank() {
  return { value: '', score: '', type: null, content: '', source: '', notice: '', noticeType: null, noticeAt: 0, updatedAt: 0 };
}
function emptyGallery() {
  return { collected: 0, total: 0, period: '', endsAt: 0, updatedAt: 0 };
}

/* ------------------------------------------------------------------ */
/* parsing                                                             */
/* ------------------------------------------------------------------ */

/** An enum that may be a number, a numeric string or its name; null when unknown. */
function enumValue(v, names) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^-?\d+$/.test(s)) return Number(s);
    const key = s.toUpperCase();
    if (key in names) return names[key];
    if ('TYPE_' + key in names) return names['TYPE_' + key];
  }
  return null;
}
const rankTypeNum = (v) => enumValue(v, RANK_TYPES);
const notifyTypeNum = (v) => enumValue(v, NOTIFY_TYPES);

/** "12" -> "12", "099" -> "99", "99+" -> "99+", "0" / "" / "-1" -> "" (not ranked). */
function parseOwnRank(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const m = /^#?\s*(\d{1,6})\s*(\+?)$/.exec(s);
  if (m) {
    const n = parseInt(m[1], 10);
    return n > 0 ? String(n) + m[2] : '';
  }
  return rankFromText(s);
}

/** Pulls a rank out of free text: "#12", "No. 12", "ranked 12", "12th", "Top 99+". */
function rankFromText(text) {
  const s = String(text || '');
  const patterns = [
    /#\s*(\d{1,6})(\+?)/,
    /\bNo\.?\s*(\d{1,6})(\+?)/i,
    /\brank(?:ed|ing)?\s*(?:#|no\.?|number)?\s*(\d{1,6})(\+?)/i,
    /\b(\d{1,6})(?:st|nd|rd|th)\b()/i,
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > 0) return String(n) + (m[2] || '');
    }
  }
  return '';
}

function pieceText(p) {
  if (!p || typeof p !== 'object') return '';
  const u = p.userValue && p.userValue.user;
  return String(
    p.stringValue ||
      (u && (u.nickname || u.uniqueId || u.displayId)) ||
      (p.giftValue && p.giftValue.nameRef && p.giftValue.nameRef.defaultPattern) ||
      (p.patternRefValue && p.patternRefValue.defaultPattern) ||
      '',
  );
}

/**
 * TikTok's Text: a defaultPattern like "{0:user} moved up to {1:string}" whose holes are
 * filled from pieces[]. Falls back to joining the pieces when there is no pattern.
 */
function textToString(t) {
  if (!t) return '';
  if (typeof t === 'string') return t.replace(/\s+/g, ' ').trim();
  if (typeof t !== 'object') return '';
  const pieces = Array.isArray(t.pieces) ? t.pieces : [];
  let out = '';
  if (t.defaultPattern) {
    out = String(t.defaultPattern).replace(/\{(\d+)(?::[^}]*)?\}/g, (_m, i) => pieceText(pieces[Number(i)]));
  } else {
    out = pieces.map(pieceText).filter(Boolean).join(' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

function cleanScore(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s === '0') return '';
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s.slice(0, 16);
}

/** The daily gaming entry from a rankUpdate (type 11, falling back to the gaming rank, 10). */
function pickDailyGame(updates) {
  const list = Array.isArray(updates) ? updates : [];
  return list.find((u) => u && rankTypeNum(u.rankType) === DAILY_GAME) || list.find((u) => u && rankTypeNum(u.rankType) === GAME_RANK) || null;
}

/** -> { value, score, type, content } or null when the message has no gaming rank. */
function parseRankUpdate(msg) {
  const u = pickDailyGame(msg && msg.updates);
  if (!u) return null;
  const content = textToString(u.defaultContent);
  let value = parseOwnRank(u.ownRank);
  // Some updates leave ownRank empty but say it in words ("You're #12 in Gaming").
  if (!value && content) value = rankFromText(content);
  return { value, score: cleanScore(u.currentScore), type: rankTypeNum(u.rankType), content };
}

/** -> { notice, msgType, value } or null when there is nothing readable. */
function parseGameRankNotify(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const notice = textToString(msg.notifyText);
  if (!notice) return null;
  return { notice: notice.slice(0, 200), msgType: notifyTypeNum(msg.msgType), value: rankFromText(notice) };
}

function sponsored(id) {
  const s = String(id ?? '').trim();
  return !!s && s !== '0';
}

/** -> { collected, total, period, endsAt } or null when there is no gallery data. */
function parseGalleryPanel(msg) {
  const gd = msg && msg.galleryData;
  if (!gd || typeof gd !== 'object' || !gd.progress || typeof gd.progress !== 'object') return null;
  // Decoded protobuf maps are plain objects; tolerate the [{key, value}] entry form too.
  const entries = Array.isArray(gd.progress) ? gd.progress.map((e) => (e && 'value' in e ? e.value : e)) : Object.values(gd.progress);
  if (!entries.length) return null;
  const collected = entries.filter((e) => e && sponsored(e.currentSponsorId)).length;
  return { collected, total: entries.length, period: String(gd.period ?? ''), endsAt: Number(gd.endTimeInMs) || 0 };
}

/* ------------------------------------------------------------------ */
/* manual values and what the overlays show                            */
/* ------------------------------------------------------------------ */

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanManualRank(v) {
  const m = /(\d{1,6})\s*(\+?)/.exec(String(v ?? ''));
  if (!m) return '';
  const n = parseInt(m[1], 10);
  return n > 0 ? String(n) + m[2] : '';
}

function cleanManual(cur, patch) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const next = { ...cur };
  if ('rankEnabled' in p) next.rankEnabled = !!p.rankEnabled;
  if ('rankValue' in p) next.rankValue = cleanManualRank(p.rankValue);
  if ('galleryEnabled' in p) next.galleryEnabled = !!p.galleryEnabled;
  if ('galleryTotal' in p) next.galleryTotal = clampInt(p.galleryTotal, 0, 999, next.galleryTotal);
  if ('galleryCollected' in p) next.galleryCollected = clampInt(p.galleryCollected, 0, 999, next.galleryCollected);
  if (next.galleryTotal > 0 && next.galleryCollected > next.galleryTotal) next.galleryCollected = next.galleryTotal;
  return next;
}

/**
 * What the overlays show. Manual values win when switched on; otherwise the last values
 * TikTok sent; for the gallery, distinct gallery gifts seen this session stand in until
 * the first gift-panel update arrives.
 */
function resolveDisplay(st) {
  const manual = st.manual || DEFAULT_MANUAL;
  const style = st.style || DEFAULT_STATS_STYLE;
  const unranked = style.unrankedText || 'Unranked';

  let rank;
  if (manual.rankEnabled) {
    rank = { source: 'manual', value: manual.rankValue || '', score: '' };
    rank.text = rank.value ? '#' + rank.value : unranked;
  } else {
    const r = st.rank || emptyRank();
    rank = { source: r.updatedAt ? 'live' : 'none', value: r.value || '', score: r.score || '' };
    rank.text = rank.value ? '#' + rank.value : r.updatedAt ? unranked : '—';
  }
  rank.ranked = !!rank.value;

  let gallery;
  if (manual.galleryEnabled) {
    gallery = { source: 'manual', collected: manual.galleryCollected || 0, total: manual.galleryTotal || 0 };
  } else if (st.gallery && st.gallery.updatedAt) {
    gallery = { source: 'live', collected: st.gallery.collected || 0, total: st.gallery.total || 0 };
  } else {
    const n = Array.isArray(st.galleryGiftIds) ? st.galleryGiftIds.length : 0;
    gallery = { source: n ? 'gifts' : 'none', collected: n, total: 0 };
  }
  gallery.text = gallery.total > 0 ? `${gallery.collected}/${gallery.total}` : gallery.source === 'none' ? '—' : String(gallery.collected);
  gallery.ratio = gallery.total > 0 ? Math.min(1, gallery.collected / gallery.total) : 0;
  return { rank, gallery };
}

/* ------------------------------------------------------------------ */
/* tracker                                                             */
/* ------------------------------------------------------------------ */

/**
 * Holds the rank + gallery state. onChange(reason) fires after every real change; the
 * caller persists serialize() and pushes snapshot() to the app and the overlays.
 */
function createTiktokStats({ onChange, now = () => Date.now() } = {}) {
  let st = defaults();

  function defaults() {
    return { rank: emptyRank(), gallery: emptyGallery(), galleryGiftIds: [], manual: { ...DEFAULT_MANUAL }, style: { ...DEFAULT_STATS_STYLE } };
  }
  const changed = (reason) => onChange && onChange(reason);

  function load(raw) {
    st = defaults();
    if (!raw || typeof raw !== 'object') return;
    st.rank = { ...st.rank, ...(raw.rank || {}) };
    st.gallery = { ...st.gallery, ...(raw.gallery || {}) };
    st.galleryGiftIds = Array.isArray(raw.galleryGiftIds) ? raw.galleryGiftIds.map(String).slice(0, 500) : [];
    st.manual = cleanManual({ ...DEFAULT_MANUAL }, raw.manual || {});
    st.style = { ...DEFAULT_STATS_STYLE, ...(raw.style || {}) };
  }

  function serialize() {
    return JSON.parse(JSON.stringify(st));
  }

  function snapshot() {
    return { ...serialize(), display: resolveDisplay(st) };
  }

  function handleRankUpdate(msg) {
    const p = parseRankUpdate(msg);
    if (!p) return false;
    st.rank = { ...st.rank, value: p.value, score: p.score, type: p.type, content: p.content, source: 'rankUpdate', updatedAt: now() };
    changed('rank');
    return true;
  }

  function handleGameRankNotify(msg) {
    const p = parseGameRankNotify(msg);
    if (!p) return false;
    st.rank = { ...st.rank, notice: p.notice, noticeType: p.msgType, noticeAt: now() };
    // The notice only sets the number when no rankUpdate has told us one.
    if (p.value && !(st.rank.source === 'rankUpdate' && st.rank.value)) {
      st.rank.value = p.value;
      st.rank.source = 'notice';
      st.rank.updatedAt = now();
    }
    changed('rankNotice');
    return true;
  }

  function handleGiftPanel(msg) {
    const p = parseGalleryPanel(msg);
    if (!p) return false;
    st.gallery = { ...p, updatedAt: now() };
    changed('gallery');
    return true;
  }

  /** Normalized gift (see tiktok.cjs). Gallery gifts count towards the fallback total. */
  function handleGift(gift) {
    if (!gift || !gift.isGalleryGift || !gift.giftId) return false;
    const id = String(gift.giftId);
    if (st.galleryGiftIds.includes(id)) return false;
    st.galleryGiftIds.push(id);
    changed('galleryGift');
    return true;
  }

  function setManual(patch) {
    st.manual = cleanManual(st.manual, patch);
    changed('manual');
    return st.manual;
  }

  function setStyle(patch) {
    const clean = {};
    for (const [k, v] of Object.entries(patch || {})) if (k in DEFAULT_STATS_STYLE) clean[k] = v;
    st.style = { ...st.style, ...clean };
    changed('style');
    return st.style;
  }

  function resetStyle() {
    st.style = { ...DEFAULT_STATS_STYLE };
    changed('style');
    return st.style;
  }

  /** Forgets what TikTok sent (rank, notice, gallery); manual values and style stay. */
  function reset() {
    st.rank = emptyRank();
    st.gallery = emptyGallery();
    st.galleryGiftIds = [];
    changed('reset');
  }

  return { load, serialize, snapshot, handleRankUpdate, handleGameRankNotify, handleGiftPanel, handleGift, setManual, setStyle, resetStyle, reset };
}

/* ------------------------------------------------------------------ */
/* raw payload samples                                                 */
/* ------------------------------------------------------------------ */

/** JSON that survives protobuf output: Buffers become a byte count, BigInts strings. */
function safeJson(data, maxBytes) {
  let s;
  try {
    s = JSON.stringify(data, (_k, v) => {
      if (typeof v === 'bigint') return String(v);
      if (v && v.type === 'Buffer' && Array.isArray(v.data)) return `<${v.data.length} bytes>`;
      if (v instanceof Uint8Array) return `<${v.length} bytes>`;
      return v;
    });
  } catch (err) {
    s = JSON.stringify({ unserializable: String(err && err.message) });
  }
  s = s === undefined ? 'undefined' : s;
  return s.length > maxBytes ? s.slice(0, maxBytes) + '…[truncated]' : s;
}

/**
 * Appends the first few raw payloads of each event per session to a log file, so the
 * real shapes can be checked later. reset() starts a new session (new LIVE).
 */
function createSampleLogger({ file, perEvent = 5, maxBytes = 4096, append = fs.appendFile, onError } = {}) {
  const counts = new Map();
  return {
    log(event, data) {
      const n = counts.get(event) || 0;
      if (!file || n >= perEvent) return false;
      counts.set(event, n + 1);
      const line = `${new Date().toISOString()} ${event} #${n + 1} ${safeJson(data, maxBytes)}\n`;
      try {
        append(file, line, (err) => err && onError && onError(err));
      } catch (err) {
        if (onError) onError(err);
      }
      return true;
    },
    reset() {
      counts.clear();
    },
  };
}

module.exports = {
  RANK_TYPES,
  NOTIFY_TYPES,
  DEFAULT_STATS_STYLE,
  DEFAULT_MANUAL,
  rankTypeNum,
  notifyTypeNum,
  parseOwnRank,
  rankFromText,
  textToString,
  pickDailyGame,
  parseRankUpdate,
  parseGameRankNotify,
  parseGalleryPanel,
  resolveDisplay,
  createTiktokStats,
  createSampleLogger,
  safeJson,
};
