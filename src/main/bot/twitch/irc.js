// Minimal, dependency-free Twitch IRC (WebSocket) client with a rate-limited send queue.
import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import { splitMessage } from '../util.js';

const UNESCAPE = { '\\s': ' ', '\\:': ';', '\\\\': '\\', '\\r': '\r', '\\n': '\n' };

export function parseLine(line) {
  const tags = {};
  let prefix = '';
  if (line[0] === '@') {
    const sp = line.indexOf(' ');
    for (const kv of line.slice(1, sp).split(';')) {
      const eq = kv.indexOf('=');
      const k = eq < 0 ? kv : kv.slice(0, eq);
      const v = eq < 0 ? '' : kv.slice(eq + 1);
      tags[k] = v.replace(/\\[s:\\rn]/g, (m) => UNESCAPE[m]);
    }
    line = line.slice(sp + 1);
  }
  if (line[0] === ':') {
    const sp = line.indexOf(' ');
    prefix = line.slice(1, sp);
    line = line.slice(sp + 1);
  }
  let trailing = '';
  const ti = line.indexOf(' :');
  if (ti >= 0) {
    trailing = line.slice(ti + 2);
    line = line.slice(0, ti);
  } else if (line.startsWith(':')) {
    trailing = line.slice(1);
    line = '';
  }
  const params = line.split(' ').filter(Boolean);
  const command = params.shift() || '';
  return { tags, prefix, nick: prefix.split('!')[0], command, params, trailing };
}

export class TwitchIRC extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.queue = [];
    this.pumping = false;
    this.isMod = false;
    this.connected = false;
    this.want = false;
    this.backoff = 1000;
    this.lastText = '';
    this.lastTextAt = 0;
    this.dupToggle = false;
  }

  connect({ login, token, channel }) {
    this.creds = { login: login.toLowerCase(), token, channel: channel.toLowerCase() };
    this.want = true;
    if (this.ws) this.ws.close();
    else this._open();
  }

  updateToken(token) {
    if (this.creds) this.creds.token = token;
  }

  disconnect() {
    this.want = false;
    this.ws?.close();
  }

  _open() {
    const ws = (this.ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443'));
    let pingTimer;
    ws.on('open', () => {
      const { login, token } = this.creds;
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send(`PASS oauth:${token}`);
      ws.send(`NICK ${login}`);
      pingTimer = setInterval(() => ws.readyState === 1 && ws.send('PING :keepalive'), 4 * 60 * 1000);
    });
    ws.on('message', (data) => {
      for (const l of data.toString().split('\r\n')) if (l) this._line(l);
    });
    ws.on('close', () => {
      clearInterval(pingTimer);
      const was = this.connected;
      this.connected = false;
      if (this.ws === ws) this.ws = null;
      if (was) this.emit('disconnected');
      if (this.want) {
        setTimeout(() => !this.ws && this.want && this._open(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 60000);
      }
    });
    ws.on('error', (e) => this.emit('error', e));
  }

  _raw(s) {
    if (this.ws?.readyState === 1) this.ws.send(s);
  }

  _line(line) {
    const m = parseLine(line);
    switch (m.command) {
      case 'PING':
        this._raw(`PONG :${m.trailing}`);
        break;
      case '001':
        this._raw(`JOIN #${this.creds.channel}`);
        break;
      case 'JOIN':
        if (m.nick === this.creds.login) {
          this.connected = true;
          this.backoff = 1000;
          this.emit('connected');
          this._pump();
        }
        break;
      case 'RECONNECT':
        this.ws?.close();
        break;
      case 'NOTICE':
        if (/authentication failed|improperly formatted auth/i.test(m.trailing)) this.emit('authfail');
        else this.emit('notice', m.trailing, m.tags);
        break;
      case 'USERSTATE': {
        const b = m.tags.badges || '';
        this.isMod = m.tags.mod === '1' || b.includes('broadcaster') || b.includes('moderator');
        break;
      }
      case 'PRIVMSG':
        this.emit('message', { tags: m.tags, login: m.nick, channel: (m.params[0] || '').slice(1), text: m.trailing });
        break;
      case 'USERNOTICE':
        this.emit('usernotice', { tags: m.tags, text: m.trailing });
        break;
      default:
        break;
    }
  }

  /** Queue a chat message. opts: { replyTo: messageId, action: bool } */
  say(text, opts = {}) {
    for (const part of splitMessage(text)) this.queue.push({ text: part, t: Date.now(), ...opts });
    if (this.queue.length > 50) this.queue.splice(0, this.queue.length - 50);
    this._pump();
  }

  _pump() {
    if (this.pumping) return;
    this.pumping = true;
    const next = () => {
      if (!this.queue.length || !this.connected) {
        this.pumping = false;
        return;
      }
      const item = this.queue.shift();
      // Don't flush stale messages (e.g. queued while disconnected) into chat later
      if (Date.now() - item.t > 30000) return next();
      let text = item.text;
      // Twitch drops identical consecutive messages within 30s — add an invisible char.
      if (text === this.lastText && Date.now() - this.lastTextAt < 30000) {
        this.dupToggle = !this.dupToggle;
        if (this.dupToggle) text += ' \u{E0000}';
      }
      this.lastText = item.text;
      this.lastTextAt = Date.now();
      const body = item.action ? `\x01ACTION ${text}\x01` : text;
      const tagPrefix = item.replyTo ? `@reply-parent-msg-id=${item.replyTo} ` : '';
      this._raw(`${tagPrefix}PRIVMSG #${this.creds.channel} :${body}`);
      this.emit('sent', text);
      setTimeout(next, this.isMod ? 350 : 1600);
    };
    next();
  }
}
