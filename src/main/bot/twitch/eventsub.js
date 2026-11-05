// Twitch EventSub over WebSocket — follows, channel points, stream online/offline, ad breaks.
import WebSocket from 'ws';
import { EventEmitter } from 'node:events';

const URL = 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30';

export class EventSubClient extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.stopped = true;
    this.seen = new Set();
    this.keepalive = 30;
  }

  start() {
    this.stopped = false;
    this._connect(URL, false);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.watchdog);
    this.ws?.close();
    this.ws = null;
  }

  _arm(ws) {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      this.emit('log', 'EventSub keepalive missed — reconnecting');
      ws.terminate();
    }, (this.keepalive + 10) * 1000);
  }

  _connect(url, isReconnect) {
    const ws = new WebSocket(url);
    if (!isReconnect) this.ws = ws;
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const type = msg.metadata?.message_type;
      if (ws === this.ws || type === 'session_welcome') this._arm(ws);
      switch (type) {
        case 'session_welcome': {
          const old = this.ws;
          this.ws = ws;
          this.keepalive = msg.payload.session.keepalive_timeout_seconds || 30;
          this._arm(ws);
          if (old && old !== ws) {
            old.removeAllListeners('close');
            old.close();
          }
          if (!isReconnect) this.emit('welcome', msg.payload.session.id);
          else this.emit('log', 'EventSub reconnected (subscriptions carried over)');
          break;
        }
        case 'notification': {
          const id = msg.metadata.message_id;
          if (this.seen.has(id)) return;
          this.seen.add(id);
          if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value);
          this.emit('event', msg.payload.subscription.type, msg.payload.event);
          break;
        }
        case 'session_reconnect':
          this._connect(msg.payload.session.reconnect_url, true);
          break;
        case 'revocation':
          this.emit('log', `EventSub subscription revoked: ${msg.payload.subscription.type} (${msg.payload.subscription.status})`);
          break;
        default:
          break;
      }
    });
    ws.on('close', () => {
      if (ws !== this.ws || this.stopped) return;
      this.ws = null;
      this.emit('closed');
      setTimeout(() => !this.stopped && !this.ws && this._connect(URL, false), 5000);
    });
    ws.on('error', (e) => this.emit('log', `EventSub socket error: ${e.message}`));
  }
}
