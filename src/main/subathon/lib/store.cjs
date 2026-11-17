'use strict';
// JSON-file persistence for the subathon (same shape as the standalone Subathon Media Player's
// data/db.json, so its data can be imported as-is). Lives in <userData>/subathon.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function randomCode(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function defaults() {
  return {
    auth: { hash: null, salt: null, secret: crypto.randomBytes(32).toString('hex') },
    tvCode: randomCode(6),
    // Steez only: the TV & viewer server on the home network (off until the streamer turns it on,
    // so Windows doesn't ask about the firewall for people who never run a subathon).
    lan: { enabled: false, port: 3000 },
    // Steez only: a short viewer link hosted on Vercel (hosted/viewer-link). Steez tells it the
    // tunnel's current address; the key proves it's this Steez. Never sent to any page.
    hosted: { link: '', key: '' },
    settings: {
      enabled: false, // Steez: the whole subathon is off until the streamer turns it on
      channel: '', // blank = the Twitch account logged into Steez
      title: 'SUBATHON',
      accent: '#a970ff',
      accent2: '#00e5ff',
      currencySymbol: '$',
      triggerPrefix: '#',
      matchMode: 'exact', // 'exact' | 'tier'
      mediaPaused: false,
      publicUrl: '',
      time: {
        prime: 300, tier1: 300, tier2: 600, tier3: 1500, // seconds per sub
        per100Bits: 120, // seconds per 100 bits
        perDollar: 60, // seconds per 1 unit of donation currency
        per100Coins: 60, // seconds per 100 TikTok coins (Steez)
        multiplier: 1,
        // Steez: subs, bits, donations and TikTok gifts only add time when the streamer turns this on
        eventsAddTime: false,
        capHours: 0, // 0 = no cap on total subathon length
        initialHours: 4,
      },
      donation: { provider: 'none', token: '', kofiToken: '' },
      tv: { showChat: true, showFeed: true, showGoals: true, alertSeconds: 6, volume: 100, showNames: true },
      viewer: { intro: 'Use the menu below to wake me up!', showRecent: true, previews: true },
      // Steez: TikTok gifts (from the TikTok Gifts page connection)
      tiktok: { enabled: true, alertMinCoins: 1 },
      // Steez: alert effects by size. A tier applies when the event reaches any of its thresholds
      // (0 = that kind never reaches this tier). The highest tier reached wins.
      effects: {
        enabled: true,
        tiers: [
          { effect: 'pop', subs: 1, bits: 1, donation: 0.01, tiktok: 1 },
          { effect: 'glow', subs: 3, bits: 500, donation: 10, tiktok: 100 },
          { effect: 'confetti', subs: 5, bits: 1000, donation: 25, tiktok: 500 },
          { effect: 'fireworks', subs: 10, bits: 5000, donation: 50, tiktok: 1000 },
          { effect: 'rainbow', subs: 25, bits: 10000, donation: 100, tiktok: 5000 },
        ],
      },
      // Steez: the OBS "wake-up menu" overlay
      overlay: { style: 'steez', interval: 3, showDescription: true, showPrices: true, showCode: true, showTiktok: true, header: 'WAKE-UP MENU' },
    },
    timer: { running: false, endsAt: 0, remaining: 4 * 3600 * 1000, ended: false, startedAt: 0 },
    stats: { subs: 0, bits: 0, donations: 0, timeAdded: 0, tiktokCoins: 0 },
    media: [],
    // Steez: which TikTok gift plays which media: { id, gift, giftId, image, coins, mediaId, minCount, addSeconds, enabled }
    tiktokRules: [],
    // TikTok gifts seen on stream (name → { name, giftId, image, coins, lastSeen }) for the gift picker
    tiktokCatalog: {},
    goals: [],
    feed: [],
  };
}

function merge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === 'object') {
    const out = { ...base };
    if (over && typeof over === 'object' && !Array.isArray(over)) {
      for (const k of Object.keys(over)) out[k] = k in base ? merge(base[k], over[k]) : over[k];
    }
    return out;
  }
  return over === undefined ? base : over;
}

/**
 * Write a file atomically (tmp + rename). On Windows, antivirus or file indexing can briefly lock
 * the target so the rename fails — fall back to a direct write instead of losing the save.
 */
function writeFileSafe(file, text) {
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch {
    fs.writeFileSync(file, text);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function createDb(dataDir, log) {
  const uploadDir = path.join(dataDir, 'uploads');
  const dbFile = path.join(dataDir, 'db.json');
  fs.mkdirSync(uploadDir, { recursive: true });
  let db;
  let existed = false;
  try {
    db = merge(defaults(), JSON.parse(fs.readFileSync(dbFile, 'utf8')));
    existed = true;
  } catch {
    db = defaults();
  }
  let saveTimer = null;
  const write = () => {
    try {
      writeFileSafe(dbFile, JSON.stringify(db, null, 2));
    } catch (e) {
      log?.error?.('Could not save subathon data: ' + e.message);
    }
  };
  const store = {
    get db() {
      return db;
    },
    set db(next) {
      db = next;
    },
    existed,
    file: dbFile,
    dataDir,
    uploadDir,
    save() {
      if (saveTimer) return;
      saveTimer = setTimeout(() => {
        saveTimer = null;
        write();
      }, 300);
    },
    saveNow() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      write();
    },
    /** Replace everything with data from the standalone app (keeps Steez-only fields). */
    importFrom(data) {
      const lan = db.lan;
      const hosted = db.hosted;
      const enabled = db.settings.enabled; // importing doesn't switch the subathon on or off
      db = merge(defaults(), data);
      db.lan = merge(lan, data.lan || {});
      db.settings.enabled = enabled;
      db.hosted = hosted;
      write();
    },
  };
  if (!existed) store.save();
  return store;
}

module.exports = { createDb, defaults, merge, randomCode, writeFileSafe };
