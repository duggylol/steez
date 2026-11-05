// Renderer-side mirror of the QueueUp state that lives in the main process. Subscribed once
// for the life of the app, so the Queue and Gifts pages can unmount freely.
import { create } from 'zustand';
import { useSyncExternalStore } from 'react';

export const useQU = create(() => ({
  ready: false,
  party: [],
  queue: [],
  settings: {},
  overlay: {},
  giftOverlay: {},
  twitch: null,
  tiktok: { status: 'idle', username: '', detail: '', viewers: 0 },
  gifts: null,
  logs: [], // newest first
  baseUrl: '',
  overlayPaths: { queue: '/overlay/queue', gifts: '/overlay/gifts' },
}));

const hq = () => window.hq;
const LOG_KEEP = 120;

// Style edits are applied locally at once and sent to the main process debounced. Until a
// patch has been sent, it is laid over whatever state the main process pushes back, so a
// slider being dragged never jumps back to an older value.
const pending = { overlay: {}, giftOverlay: {} };
const pendingTimers = {};

// Called synchronously before a new party/queue lands (used to animate reordering).
const beforeListChange = new Set();
export function onBeforeListChange(fn) {
  beforeListChange.add(fn);
  return () => beforeListChange.delete(fn);
}

function apply(s) {
  if (!s) return;
  const cur = useQU.getState();
  if ((s.party && s.party !== cur.party) || (s.queue && s.queue !== cur.queue)) beforeListChange.forEach((fn) => fn());
  const next = { ...s, ready: true };
  if (s.overlay) next.overlay = { ...s.overlay, ...pending.overlay };
  if (s.giftOverlay) next.giftOverlay = { ...s.giftOverlay, ...pending.giftOverlay };
  useQU.setState(next);
}

let started = false;
/** Loads state and subscribes to main-process pushes. Safe to call from every view. */
export function startQU() {
  if (started || !hq()) return;
  started = true;
  hq().getState().then(apply);
  hq()
    .getLogs()
    .then((logs) => useQU.setState({ logs: (logs || []).slice(-LOG_KEEP).reverse() }));
  hq().onState(apply);
  hq().onTwitch((twitch) => useQU.setState({ twitch }));
  hq().onLog((item) => useQU.setState((st) => ({ logs: [item, ...st.logs].slice(0, LOG_KEEP) })));
  hq().onTikTok((tiktok) => useQU.setState({ tiktok }));
  hq().onGifts((p) => useQU.setState({ gifts: p.gifts }));
}

/** Edits the queue overlay ('overlay') or gifts overlay ('giftOverlay') style. */
export function editStyle(kind, patch) {
  Object.assign(pending[kind], patch);
  useQU.setState((st) => ({ [kind]: { ...st[kind], ...patch } }));
  clearTimeout(pendingTimers[kind]);
  pendingTimers[kind] = setTimeout(() => {
    const send = pending[kind];
    pending[kind] = {};
    (kind === 'overlay' ? hq().updateOverlay : hq().updateGiftOverlay)(send);
  }, 90);
}

export async function resetStyle(kind) {
  clearTimeout(pendingTimers[kind]);
  pending[kind] = {};
  const next = await (kind === 'overlay' ? hq().resetOverlay() : hq().resetGiftOverlay());
  useQU.setState({ [kind]: next });
}

/** Updates queue rules; the main process echoes the result back as qu:state. */
export function editSettings(patch) {
  useQU.setState((st) => ({ settings: { ...st.settings, ...patch } }));
  return hq().updateSettings(patch);
}

export function clearLog() {
  useQU.setState({ logs: [] });
}

// ─── A shared clock for the wait timers (one interval for every row) ───
let now = Date.now();
const tickSubs = new Set();
let tickTimer = null;
function subscribeTick(fn) {
  tickSubs.add(fn);
  if (!tickTimer) {
    tickTimer = setInterval(() => {
      now = Date.now();
      tickSubs.forEach((f) => f());
    }, 250);
  }
  return () => {
    tickSubs.delete(fn);
    if (!tickSubs.size) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}
export function useNow() {
  return useSyncExternalStore(subscribeTick, () => now);
}

// ─── Formatting ───
export function fmtWait(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function fmtNum(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(n % 1e3 ? 1 : 0) + 'K';
  return n.toLocaleString();
}

export function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}
