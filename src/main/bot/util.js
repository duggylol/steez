export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function weightedPick(items, weightKey = 'weight') {
  const total = items.reduce((s, i) => s + (i[weightKey] || 0), 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item[weightKey] || 0;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export const normLogin = (s) => String(s || '').trim().replace(/^@/, '').toLowerCase();

export const fmtNum = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');

/** "2h 5m", "3d 4h", "45s" */
export function fmtDuration(ms, parts = 2) {
  let s = Math.max(0, Math.floor(ms / 1000));
  const units = [
    ['y', 31536000],
    ['mo', 2592000],
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ];
  const out = [];
  for (const [u, sec] of units) {
    if (s >= sec) {
      out.push(`${Math.floor(s / sec)}${u}`);
      s %= sec;
    }
    if (out.length >= parts) break;
  }
  return out.length ? out.join(' ') : '0s';
}

/** Human "2 years, 3 months, 4 days" since a date */
export function since(date) {
  const start = new Date(date);
  const now = new Date();
  let y = now.getFullYear() - start.getFullYear();
  let m = now.getMonth() - start.getMonth();
  let d = now.getDate() - start.getDate();
  if (d < 0) {
    m--;
    d += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  }
  if (m < 0) {
    y--;
    m += 12;
  }
  const out = [];
  if (y) out.push(`${y} year${y > 1 ? 's' : ''}`);
  if (m) out.push(`${m} month${m > 1 ? 's' : ''}`);
  if (d || !out.length) out.push(`${d} day${d !== 1 ? 's' : ''}`);
  return out.join(', ');
}

/**
 * Parse a points amount: "100", "1k", "2.5m", "all", "half", "50%".
 * Returns NaN when invalid.
 */
export function parseAmount(input, balance) {
  if (input == null) return NaN;
  const s = String(input).trim().toLowerCase().replace(/,/g, '');
  if (s === 'all' || s === 'allin' || s === 'max') return Math.floor(balance);
  if (s === 'half') return Math.floor(balance / 2);
  let m = s.match(/^(\d+(?:\.\d+)?)%$/);
  if (m) return Math.floor((balance * Math.min(100, Number(m[1]))) / 100);
  m = s.match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!m) return NaN;
  const mult = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1;
  return Math.floor(Number(m[1]) * mult);
}

/** Make text safe to send to Twitch chat: no leading command chars, single line, length-capped. */
export function sanitizeChat(text, max = 490) {
  let t = String(text ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  while (/^[/.\\]/.test(t)) t = t.slice(1).trim();
  if (t.length > max) t = t.slice(0, max - 1) + '…';
  return t;
}

export function splitMessage(text, max = 490) {
  const out = [];
  let t = text;
  while (t.length > max) {
    let cut = t.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max;
    out.push(t.slice(0, cut));
    t = t.slice(cut).trim();
  }
  if (t) out.push(t);
  return out;
}

export const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Loose answer comparison for trivia etc. */
export function normalizeAnswer(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]/g, '');
}

export function isPrivateHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h.startsWith('127.') ||
    h.startsWith('10.') ||
    h.startsWith('192.168.') ||
    h.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h.startsWith('fc') ||
    h.startsWith('fd') ||
    h.startsWith('fe80')
  );
}
