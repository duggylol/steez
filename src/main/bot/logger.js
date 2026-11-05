const ring = [];
let sink = null;

export function setLogSink(fn) {
  sink = fn;
}

function fmt(a) {
  if (a instanceof Error) return a.message;
  if (typeof a === 'string') return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function write(level, args) {
  const line = { t: Date.now(), level, msg: args.map(fmt).join(' ') };
  ring.push(line);
  if (ring.length > 500) ring.shift();
  const stamp = new Date().toLocaleTimeString();
  const out = `[${stamp}] ${level.toUpperCase().padEnd(5)} ${line.msg}`;
  if (level === 'error') console.error(out);
  else console.log(out);
  try {
    sink?.(line);
  } catch {
    /* ignore */
  }
}

export const log = {
  info: (...a) => write('info', a),
  warn: (...a) => write('warn', a),
  error: (...a) => write('error', a),
  chat: (...a) => write('chat', a),
};

export const recentLogs = () => ring.slice();
