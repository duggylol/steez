// Anonymous, read-only Twitch chat connection. Needs only the channel name.
// Gives us chat messages, cheers (bits), subs, resubs and gift subs.
const WebSocket = require('ws');
const { EventEmitter } = require('events');

function unescapeTag(v) {
  return v.replace(/\\(.)/g, (m, c) => ({ s: ' ', ':': ';', '\\': '\\', r: '\r', n: '\n' }[c] || c));
}

function parseLine(line) {
  let tags = {}, prefix = null, rest = line;
  if (rest[0] === '@') {
    const i = rest.indexOf(' ');
    for (const pair of rest.slice(1, i).split(';')) {
      const eq = pair.indexOf('=');
      const k = eq < 0 ? pair : pair.slice(0, eq);
      tags[k] = eq < 0 ? '' : unescapeTag(pair.slice(eq + 1));
    }
    rest = rest.slice(i + 1);
  }
  if (rest[0] === ':') {
    const i = rest.indexOf(' ');
    prefix = rest.slice(1, i);
    rest = rest.slice(i + 1);
  }
  let trailing = null;
  const ti = rest.indexOf(' :');
  if (ti >= 0) { trailing = rest.slice(ti + 2); rest = rest.slice(0, ti); }
  const params = rest.split(' ').filter(Boolean);
  const command = params.shift();
  return { tags, prefix, command, params, trailing };
}

function tierOf(plan) {
  if (plan === 'Prime') return 'prime';
  if (plan === '2000') return 'tier2';
  if (plan === '3000') return 'tier3';
  return 'tier1';
}

class TwitchChat extends EventEmitter {
  constructor() {
    super();
    this.channel = '';
    this.ws = null;
    this.status = 'disconnected';
    this.retry = 0;
    this.reconnectTimer = null;
  }

  setStatus(s, detail) {
    this.status = s;
    this.emit('status', { status: s, detail: detail || '' });
  }

  connect(channel) {
    channel = (channel || '').trim().toLowerCase().replace(/^#/, '').replace(/^https?:\/\/(www\.)?twitch\.tv\//, '');
    if (channel === this.channel && this.ws) return;
    this.disconnect();
    this.channel = channel;
    if (!channel) return this.setStatus('disconnected', 'No Twitch username set');
    this.open();
  }

  disconnect() {
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    this.setStatus('disconnected');
  }

  open() {
    this.setStatus('connecting');
    const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    this.ws = ws;
    ws.on('open', () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send('PASS SCHMOOPIIE');
      ws.send('NICK justinfan' + Math.floor(10000 + Math.random() * 80000));
      ws.send('JOIN #' + this.channel);
    });
    ws.on('message', (buf) => {
      for (const line of buf.toString().split('\r\n')) if (line) this.handle(parseLine(line));
    });
    ws.on('close', () => this.scheduleReconnect());
    ws.on('error', (err) => this.setStatus('error', err.message));
  }

  scheduleReconnect() {
    if (!this.channel) return;
    this.ws = null;
    const delay = Math.min(30000, 1000 * Math.pow(2, this.retry++));
    this.setStatus('reconnecting', 'Retrying in ' + Math.round(delay / 1000) + 's');
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  handle(m) {
    const t = m.tags;
    switch (m.command) {
      case 'PING':
        this.ws && this.ws.send('PONG :' + (m.trailing || 'tmi.twitch.tv'));
        break;
      case 'RECONNECT':
        try { this.ws.close(); } catch (e) {}
        break;
      case 'JOIN':
        this.retry = 0;
        this.setStatus('connected', '#' + this.channel);
        break;
      case 'NOTICE':
        if (/(not exist|suspended|banned)/i.test(m.trailing || '')) this.setStatus('error', m.trailing);
        break;
      case 'CLEARCHAT':
        this.emit('clear', { user: m.trailing || null });
        break;
      case 'CLEARMSG':
        this.emit('clear', { id: t['target-msg-id'] });
        break;
      case 'PRIVMSG': {
        // Ignore messages mirrored from other channels during Shared Chat
        if (t['source-room-id'] && t['room-id'] && t['source-room-id'] !== t['room-id']) return;
        const user = t['display-name'] || (m.prefix || '').split('!')[0];
        const text = m.trailing || '';
        const isAction = /^\u0001ACTION (.*)\u0001$/.exec(text);
        this.emit('chat', {
          id: t.id, user, color: t.color || '', text: isAction ? isAction[1] : text,
          emotes: t.emotes || '', badges: t.badges || '', action: !!isAction,
        });
        const bits = parseInt(t.bits, 10);
        if (bits > 0) this.emit('event', { type: 'bits', user, amount: bits, message: text });
        break;
      }
      case 'USERNOTICE': {
        const id = t['msg-id'];
        if (t['source-room-id'] && t['room-id'] && t['source-room-id'] !== t['room-id']) return;
        const user = t['display-name'] || t.login || 'Someone';
        const tier = tierOf(t['msg-param-sub-plan']);
        if (id === 'sub' || id === 'resub') {
          this.emit('event', {
            type: id, user, tier, amount: 1, message: m.trailing || '',
            months: parseInt(t['msg-param-cumulative-months'], 10) || 1,
          });
        } else if (id === 'subgift' || id === 'anonsubgift') {
          this.emit('event', {
            type: 'gift', user: id === 'anonsubgift' || t.login === 'ananonymousgifter' ? 'Anonymous' : user,
            tier, amount: 1, recipient: t['msg-param-recipient-display-name'] || '',
            partOfBomb: !!t['msg-param-community-gift-id'], message: '',
          });
        } else if (id === 'submysterygift' || id === 'anonsubmysterygift') {
          this.emit('event', {
            type: 'giftbomb', user: id === 'anonsubmysterygift' || t.login === 'ananonymousgifter' ? 'Anonymous' : user,
            tier, amount: parseInt(t['msg-param-mass-gift-count'], 10) || 1, message: '',
          });
        } else if (id === 'giftpaidupgrade' || id === 'anongiftpaidupgrade' || id === 'primepaidupgrade') {
          this.emit('event', { type: 'sub', user, tier: id === 'primepaidupgrade' ? tier : 'tier1', amount: 1, message: '', months: 1 });
        }
        break;
      }
    }
  }
}

module.exports = TwitchChat;
module.exports.parseLine = parseLine;
