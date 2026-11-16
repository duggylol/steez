// Donation listeners. Twitch itself does not expose donations, so we connect
// to the tip service the streamer uses: Streamlabs, StreamElements or Ko-fi.
const WebSocket = require('ws');
const ioClient = require('socket.io-client');
const crypto = require('crypto');
const { EventEmitter } = require('events');

class Donations extends EventEmitter {
  constructor() {
    super();
    this.provider = 'none';
    this.token = '';
    this.conn = null;
    this.status = 'off';
    this.seen = new Set();
    this.retry = 0;
    this.timer = null;
  }

  setStatus(s, detail) {
    this.status = s;
    this.emit('status', { status: s, detail: detail || '', provider: this.provider });
  }

  configure(provider, token) {
    if (provider === this.provider && token === this.token && this.conn) return;
    this.stop();
    this.provider = provider || 'none';
    this.token = (token || '').trim();
    if (this.provider === 'kofi') return this.setStatus('connected', 'Waiting for Ko-fi webhooks');
    if (this.provider === 'none') return this.setStatus('off');
    if (!this.token) return this.setStatus('error', 'Token missing');
    if (this.provider === 'streamlabs') this.startStreamlabs();
    else if (this.provider === 'streamelements') this.startStreamElements();
  }

  stop() {
    clearTimeout(this.timer);
    if (this.conn) {
      try { this.conn.removeAllListeners && this.conn.removeAllListeners(); } catch (e) {}
      try { this.conn.close ? this.conn.close() : this.conn.disconnect(); } catch (e) {}
    }
    this.conn = null;
    this.setStatus('off');
  }

  emitTip(tip) {
    const id = tip.id || crypto.createHash('sha1').update(JSON.stringify([tip.user, tip.amount, tip.message, Math.floor(Date.now() / 5000)])).digest('hex');
    if (this.seen.has(id)) return;
    this.seen.add(id);
    if (this.seen.size > 500) this.seen = new Set([...this.seen].slice(-250));
    const amount = Number(tip.amount);
    if (!(amount > 0)) return;
    this.emit('event', {
      type: 'donation', user: tip.user || 'Anonymous', amount: Math.round(amount * 100) / 100,
      message: tip.message || '', currency: tip.currency || '',
    });
  }

  // --- Streamlabs: Socket API token (Dashboard > Settings > API Settings > API Tokens)
  startStreamlabs() {
    this.setStatus('connecting');
    const socket = ioClient('https://sockets.streamlabs.com?token=' + encodeURIComponent(this.token), {
      transports: ['websocket'], reconnection: true, reconnectionDelayMax: 30000,
    });
    this.conn = socket;
    socket.on('connect', () => this.setStatus('connected', 'Streamlabs'));
    socket.on('disconnect', () => this.setStatus('reconnecting'));
    socket.on('connect_error', (e) => this.setStatus('error', 'Streamlabs: ' + (e && e.message || 'connection failed')));
    socket.on('event', (ev) => {
      if (!ev || ev.type !== 'donation') return;
      const list = Array.isArray(ev.message) ? ev.message : [ev.message];
      for (const d of list) {
        if (!d) continue;
        this.emitTip({ id: 'sl-' + (d._id || d.id || d.donation_id || ''), user: d.name || d.from, amount: d.amount, message: d.message, currency: d.currency });
      }
    });
  }

  // --- StreamElements: Astro gateway with the channel JWT (Dashboard > Account > Channels > JWT)
  startStreamElements() {
    this.setStatus('connecting');
    const ws = new WebSocket('wss://astro.streamelements.com');
    this.conn = ws;
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'subscribe', nonce: crypto.randomUUID(),
        data: { topic: 'channel.activities', token: this.token, token_type: 'jwt' },
      }));
    });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
      if (msg.type === 'response') {
        if (msg.error) this.setStatus('error', 'StreamElements: ' + (msg.data && msg.data.message || msg.error));
        else { this.retry = 0; this.setStatus('connected', 'StreamElements'); }
      } else if (msg.type === 'message' && msg.topic === 'channel.activities') {
        const act = msg.data || {};
        if (act.type !== 'tip') return;
        const d = act.data || {};
        this.emitTip({ id: 'se-' + (act._id || act.activityId || ''), user: d.username || d.displayName, amount: d.amount, message: d.message, currency: d.currency });
      } else if (msg.type === 'reconnect') {
        try { ws.close(); } catch (e) {}
      }
    });
    ws.on('close', () => {
      if (this.conn !== ws) return;
      const delay = Math.min(30000, 1000 * Math.pow(2, this.retry++));
      this.setStatus('reconnecting', 'Retrying in ' + Math.round(delay / 1000) + 's');
      this.timer = setTimeout(() => { if (this.conn === ws) this.startStreamElements(); }, delay);
    });
    ws.on('error', (e) => this.setStatus('error', 'StreamElements: ' + e.message));
  }

  // --- Ko-fi: webhook POST to /webhook/kofi (needs the server to be public)
  handleKofi(body, verificationToken) {
    let data;
    try { data = typeof body.data === 'string' ? JSON.parse(body.data) : body; } catch (e) { return false; }
    if (!data || !verificationToken || data.verification_token !== verificationToken) return false;
    if (data.type && !/donation|subscription|commission|shop/i.test(data.type)) return true;
    this.emitTip({
      id: 'kofi-' + (data.message_id || data.kofi_transaction_id || ''),
      user: data.is_public === false ? 'Anonymous' : data.from_name,
      amount: data.amount, message: data.is_public === false ? '' : data.message, currency: data.currency,
    });
    return true;
  }
}

module.exports = Donations;
