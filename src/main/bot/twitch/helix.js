import { config } from '../config.js';
import { getAccount, refresh } from './auth.js';

export class HelixError extends Error {
  constructor(status, body, path) {
    super(`Helix ${status} on ${path}: ${body?.message || JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

function qs(query = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
    else p.append(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Call the Twitch Helix API as the broadcaster or the bot account. */
export async function helix(role, method, path, { query, body } = {}, retried = false) {
  const acct = getAccount(role);
  if (!acct) throw new Error(`The ${role} Twitch account is not connected`);
  const res = await fetch(`https://api.twitch.tv/helix${path}${qs(query)}`, {
    method,
    headers: {
      'Client-Id': acct.clientId || config.clientId,
      Authorization: `Bearer ${acct.accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !retried) {
    await refresh(role); // throws (and flags the login as expired) if the token is dead
    return helix(role, method, path, { query, body }, true);
  }
  if (res.status === 204) return null;
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new HelixError(res.status, json, path);
  return json;
}
