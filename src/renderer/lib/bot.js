// Client for the chat-bot API + the shared /ws event socket.
import { toast } from '../ui.jsx';

let infoPromise = null;
export const steezInfo = () => (infoPromise ||= window.steez.info());

async function req(method, url, body) {
  const { apiKey } = await steezInfo();
  const r = await fetch(url, {
    method,
    headers: { 'x-steez-key': apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    toast(j.error || `Request failed (${r.status})`, { error: true });
    throw new Error(j.error || `HTTP ${r.status}`);
  }
  return j;
}

export const api = {
  get: (u) => req('GET', u),
  put: (u, b) => req('PUT', u, b),
  post: (u, b) => req('POST', u, b || {}),
  del: (u) => req('DELETE', u),
  action: (name, args) => req('POST', `/api/action/${name}`, args || {}).then((r) => r.result),
};

// ─── Event socket ────────────────────────────────────────────
const subs = new Map(); // type → Set<fn>
export const buffers = { chat: [], log: [], hype: { mpm: 0, level: 0, score: 0, baseline: 0 } };
let ws = null;

export function onBot(type, fn) {
  if (!subs.has(type)) subs.set(type, new Set());
  subs.get(type).add(fn);
  return () => subs.get(type)?.delete(fn);
}
const emit = (type, data) => subs.get(type)?.forEach((fn) => fn(data));

export async function connectBotSocket() {
  if (ws) return;
  const { apiKey } = await steezInfo();
  const open = () => {
    ws = new WebSocket(`ws://${location.host}/ws?key=${apiKey}`);
    ws.onmessage = (ev) => {
      const { type, data } = JSON.parse(ev.data);
      if (type === 'chat:message') {
        buffers.chat.push(data);
        if (buffers.chat.length > 300) buffers.chat.shift();
        emit('chat', data);
      } else if (type === 'chat:bot') {
        const m = { ...data, bot: true };
        buffers.chat.push(m);
        if (buffers.chat.length > 300) buffers.chat.shift();
        emit('chat', m);
      } else if (type === 'log') {
        buffers.log.push(data);
        if (buffers.log.length > 500) buffers.log.shift();
        emit('log', data);
      } else if (type === 'hype') {
        buffers.hype = data;
        emit('hype', data);
      } else emit(type, data);
    };
    ws.onclose = () => {
      ws = null;
      setTimeout(open, 2500);
    };
  };
  open();
  api.get('/api/logs').then((l) => buffers.log.push(...l)).catch(() => {});
}
