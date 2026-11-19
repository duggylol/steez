// Every chat message, kept on disk so the AI can look back at what viewers said in earlier streams.
// One JSON-lines file per day in <data>/chat/ ({t, l: login, u: display, m: text, b: 1 for the bot}).
// Nothing is held in memory: searches read the files newest first and stop once they have enough.
import fs from 'node:fs';
import path from 'node:path';

const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

export function createChatHistory(dir) {
  let pending = [];
  let timer = null;

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!pending.length) return;
    const byDay = new Map();
    for (const r of pending) {
      const d = dayOf(r.t);
      byDay.set(d, (byDay.get(d) || '') + JSON.stringify(r) + '\n');
    }
    pending = [];
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const [d, text] of byDay) fs.appendFileSync(path.join(dir, `${d}.jsonl`), text);
    } catch {
      // a full or locked disk only costs history, never chat
    }
  }

  function add({ t = Date.now(), login, user, text, bot = false }) {
    if (!text || !login) return;
    pending.push({ t, l: String(login).toLowerCase(), u: user || login, m: String(text).slice(0, 500), ...(bot ? { b: 1 } : {}) });
    if (pending.length >= 200) flush();
    else if (!timer) timer = setTimeout(flush, 2000);
  }

  const days = () => {
    try {
      return fs
        .readdirSync(dir)
        .map((f) => f.match(FILE)?.[1])
        .filter(Boolean)
        .sort()
        .reverse();
    } catch {
      return [];
    }
  };

  /**
   * Messages matching every filter, oldest first (the newest `limit` of them).
   * login: one viewer · contains: words that must all appear · since/until: ms timestamps · bots: include the bot's own lines
   */
  function search({ login, contains, since = 0, until = Infinity, limit = 50, bots = true } = {}) {
    flush();
    const who = login ? String(login).toLowerCase().replace(/^@/, '') : '';
    const words = String(contains || '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const quick = who ? `"l":${JSON.stringify(who)}` : '';
    const out = [];
    const firstDay = since ? dayOf(since) : '';
    for (const d of days()) {
      if (d < firstDay) break;
      if (until !== Infinity && d > dayOf(until)) continue;
      let lines;
      try {
        lines = fs.readFileSync(path.join(dir, `${d}.jsonl`), 'utf8').split('\n');
      } catch {
        continue;
      }
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line || (quick && !line.includes(quick))) continue;
        let r;
        try {
          r = JSON.parse(line);
        } catch {
          continue;
        }
        if (r.t < since || r.t > until || (!bots && r.b)) continue;
        if (who && r.l !== who) continue;
        if (words.length) {
          const m = r.m.toLowerCase();
          if (!words.every((w) => m.includes(w))) continue;
        }
        out.push(r);
        if (out.length >= limit) return out.reverse();
      }
    }
    return out.reverse();
  }

  /** How far back the history goes and how much there is. */
  function info() {
    flush();
    const all = days();
    let bytes = 0;
    for (const d of all) {
      try {
        bytes += fs.statSync(path.join(dir, `${d}.jsonl`)).size;
      } catch {
        // gone
      }
    }
    return { days: all.length, since: all.at(-1) || null, bytes };
  }

  process.on('exit', flush);
  return { add, flush, search, info, dir };
}

/** "2026-11-02 21:14 Duggy: gg" lines for the AI, trimmed to fit `maxChars` (keeping the newest). */
export function formatLines(records, maxChars = 3500) {
  const lines = records.map((r) => {
    const d = new Date(r.t);
    const pad = (n) => String(n).padStart(2, '0');
    const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return `${when} ${r.u}${r.b ? ' (bot)' : ''}: ${r.m}`;
  });
  let total = 0;
  let start = lines.length;
  while (start > 0 && total + lines[start - 1].length + 1 <= maxChars) total += lines[--start].length + 1;
  return lines.slice(start).join('\n');
}
