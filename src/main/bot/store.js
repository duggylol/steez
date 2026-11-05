import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { defaultSettings, defaultCommands, defaultTimers } from './defaults.js';
import { log } from './logger.js';

const DIR = path.resolve(config.dataDir);
const FILE = path.join(DIR, 'db.json');

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

/** Add keys from `defaults` that are missing in `target` (recursively). Arrays are not merged. */
export function fillDefaults(target, defaults) {
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in target)) target[k] = structuredClone(v);
    else if (isObj(v) && isObj(target[k])) fillDefaults(target[k], v);
  }
  return target;
}

function load() {
  fs.mkdirSync(DIR, { recursive: true });
  let data = {};
  let fresh = true;
  if (fs.existsSync(FILE)) {
    try {
      data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      fresh = false;
    } catch (e) {
      const bad = FILE + '.corrupt-' + Date.now();
      fs.copyFileSync(FILE, bad);
      log.error(`Database was unreadable; backed up to ${bad} and starting fresh.`, e);
    }
  }
  fillDefaults(data, {
    settings: {},
    auth: {},
    commands: fresh ? defaultCommands : {},
    builtins: {},
    timers: fresh ? defaultTimers : [],
    users: {},
    quotes: [],
    counters: {},
    hypeMoments: [],
    clips: [],
    streams: [],
    modlog: [],
    songHistory: [],
    meta: { quoteSeq: 0 },
  });
  fillDefaults(data.settings, defaultSettings);
  return data;
}

export const db = load();
db.secrets ||= {};
globalThis.__steezSecrets = db.secrets;

let timer = null;
export function save() {
  if (timer) return;
  timer = setTimeout(flush, 1500);
}

export function flush() {
  clearTimeout(timer);
  timer = null;
  try {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, FILE);
  } catch (e) {
    log.error('Failed to save database', e);
  }
}

// Rolling daily backup (keeps 7)
export function backup() {
  try {
    flush();
    const bdir = path.join(DIR, 'backups');
    fs.mkdirSync(bdir, { recursive: true });
    const name = `db-${new Date().toISOString().slice(0, 10)}.json`;
    fs.copyFileSync(FILE, path.join(bdir, name));
    const files = fs.readdirSync(bdir).filter((f) => f.startsWith('db-')).sort();
    while (files.length > 7) fs.unlinkSync(path.join(bdir, files.shift()));
  } catch (e) {
    log.warn('Backup failed', e);
  }
}

export function findUser(login) {
  return db.users[String(login || '').toLowerCase().replace(/^@/, '')];
}

export function getUser(login, display) {
  login = String(login).toLowerCase().replace(/^@/, '');
  let u = db.users[login];
  if (!u) {
    u = db.users[login] = {
      login,
      display: display || login,
      id: null,
      points: db.settings.loyalty.startingPoints || 0,
      watchMinutes: 0,
      messages: 0,
      firstSeen: Date.now(),
      lastSeen: 0,
      isSub: false,
      achievements: {},
      stats: {},
    };
    save();
  } else if (display && u.display !== display) {
    u.display = display;
  }
  return u;
}

export function bumpStat(u, key, by = 1) {
  u.stats ||= {};
  u.stats[key] = (u.stats[key] || 0) + by;
  save();
  return u.stats[key];
}

process.on('exit', flush);
