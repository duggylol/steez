// Higher-level Twitch API helpers used across modules.
import { helix } from './helix.js';
import { getAccount } from './auth.js';

const userCache = new Map(); // login -> {data, t}
const CACHE_MS = 60 * 60 * 1000;

export const broadcasterId = () => getAccount('broadcaster')?.userId;
export const moderatorId = () => getAccount('bot')?.userId;

export async function getUserByLogin(login) {
  login = String(login || '').toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9_]{1,25}$/.test(login)) return null;
  const c = userCache.get(login);
  if (c && Date.now() - c.t < CACHE_MS) return c.data;
  const r = await helix('broadcaster', 'GET', '/users', { query: { login } });
  const u = r.data[0] || null;
  userCache.set(login, { data: u, t: Date.now() });
  return u;
}

export async function getFollowedAt(userId) {
  const r = await helix('broadcaster', 'GET', '/channels/followers', {
    query: { broadcaster_id: broadcasterId(), user_id: userId },
  });
  return r.data[0]?.followed_at || null;
}

export async function followerCount() {
  const r = await helix('broadcaster', 'GET', '/channels/followers', { query: { broadcaster_id: broadcasterId(), first: 1 } });
  return r.total;
}

export async function subCount() {
  const r = await helix('broadcaster', 'GET', '/subscriptions', { query: { broadcaster_id: broadcasterId(), first: 1 } });
  return r.total;
}

export async function getStream() {
  const r = await helix('broadcaster', 'GET', '/streams', { query: { user_id: broadcasterId() } });
  return r.data[0] || null;
}

export async function getChannel(id = broadcasterId()) {
  const r = await helix('broadcaster', 'GET', '/channels', { query: { broadcaster_id: id } });
  return r.data[0] || null;
}

export async function updateChannel(body) {
  return helix('broadcaster', 'PATCH', '/channels', { query: { broadcaster_id: broadcasterId() }, body });
}

export async function findCategory(name) {
  const r = await helix('broadcaster', 'GET', '/search/categories', { query: { query: name, first: 10 } });
  const list = r.data || [];
  return list.find((g) => g.name.toLowerCase() === name.toLowerCase()) || list[0] || null;
}

export async function createClip() {
  const r = await helix('broadcaster', 'POST', '/clips', { query: { broadcaster_id: broadcasterId() } });
  return r.data[0];
}

export async function shoutout(toId) {
  return helix('bot', 'POST', '/chat/shoutouts', {
    query: { from_broadcaster_id: broadcasterId(), to_broadcaster_id: toId, moderator_id: moderatorId() },
  });
}

export async function announce(message, color = 'primary') {
  return helix('bot', 'POST', '/chat/announcements', {
    query: { broadcaster_id: broadcasterId(), moderator_id: moderatorId() },
    body: { message: message.slice(0, 500), color },
  });
}

export async function setChatSettings(settings) {
  return helix('broadcaster', 'PATCH', '/chat/settings', {
    query: { broadcaster_id: broadcasterId(), moderator_id: broadcasterId() },
    body: settings,
  });
}

export async function getChatters() {
  const out = [];
  let after;
  for (let i = 0; i < 20; i++) {
    const r = await helix('broadcaster', 'GET', '/chat/chatters', {
      query: { broadcaster_id: broadcasterId(), moderator_id: broadcasterId(), first: 1000, after },
    });
    out.push(...r.data);
    after = r.pagination?.cursor;
    if (!after) break;
  }
  return out.map((c) => ({ id: c.user_id, login: c.user_login, display: c.user_name }));
}

export async function timeoutUser(userId, duration, reason = '') {
  return helix('bot', 'POST', '/moderation/bans', {
    query: { broadcaster_id: broadcasterId(), moderator_id: moderatorId() },
    body: { data: { user_id: userId, duration, reason: reason.slice(0, 500) } },
  });
}

export async function banUser(userId, reason = '') {
  return helix('bot', 'POST', '/moderation/bans', {
    query: { broadcaster_id: broadcasterId(), moderator_id: moderatorId() },
    body: { data: { user_id: userId, reason: reason.slice(0, 500) } },
  });
}

export async function deleteMessage(messageId) {
  return helix('bot', 'DELETE', '/moderation/chat', {
    query: { broadcaster_id: broadcasterId(), moderator_id: moderatorId(), message_id: messageId },
  });
}

export async function createEventSubSubscription(type, version, condition, sessionId) {
  return helix('broadcaster', 'POST', '/eventsub/subscriptions', {
    body: { type, version, condition, transport: { method: 'websocket', session_id: sessionId } },
  });
}
