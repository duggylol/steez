// WebSocket hub shared by the Steez UI and the bot overlays (path /ws).
// The UI connects with ?key=<launch key> and also receives dashboard-only events (chat, logs).
import { WebSocketServer } from 'ws';

const clients = new Set();
const handlers = new Map();

/** Create the hub socket server; route upgrades for /ws to it (noServer mode). */
export function createHub({ isAuthed }) {
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws, req) => {
    ws.isDashboard = isAuthed(req);
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const h = handlers.get(msg.type);
      if (h) h(msg.data || {}, ws);
    });
    handlers.get('$connect')?.({}, ws);
  });
  return wss;
}

export function onSocket(type, fn) {
  handlers.set(type, fn);
}

/** Send to every connected client. `dashboardOnly` limits to the Steez UI. */
export function broadcast(type, data, { dashboardOnly = false } = {}) {
  const payload = JSON.stringify({ type, data });
  for (const ws of clients) {
    if (ws.readyState !== 1) continue;
    if (dashboardOnly && !ws.isDashboard) continue;
    ws.send(payload);
  }
}

export function sendTo(ws, type, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type, data }));
}
