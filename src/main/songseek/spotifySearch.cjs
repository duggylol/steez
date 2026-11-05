// Spotify catalogue search.
// Primary path: the signed-in user's own token (only a Client ID is ever needed, no secret).
// Fallback: if a build bundles an app id + secret, an app-only Client-Credentials token so search
// works before anyone logs in.
const account = require('./spotifyAccount.cjs');

let appToken = null; // { token, expires_at }

async function getAppToken(store) {
  const id = store.get('spotifySearchClientId');
  const secret = store.get('spotifySearchClientSecret');
  if (!id || !secret) return null;
  if (appToken && Date.now() < appToken.expires_at) return appToken.token;
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  appToken = { token: j.access_token, expires_at: Date.now() + (j.expires_in - 60) * 1000 };
  return appToken.token;
}

async function api(store, pathname) {
  // `market=from_token` needs the user-read-private scope, which we deliberately don't request
  // (Spotify rejects the whole call without it). Results stay queueable by URI without a market.
  if (store.get('spotifyLibraryTokens')) return account.request(store, 'GET', pathname);
  const token = await getAppToken(store);
  if (!token) throw Object.assign(new Error('Connect Spotify to search its catalogue'), { code: 'NO_SPOTIFY' });
  const sep = pathname.includes('?') ? '&' : '?';
  const r = await fetch(`https://api.spotify.com/v1${pathname}${sep}market=US`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j.error && j.error.message) || `Spotify API error ${r.status}`);
  }
  return r.json();
}

async function search(store, q, limit = 6) {
  // Development-mode apps are capped at 10.
  const n = Math.max(1, Math.min(Number(limit) || 6, 10));
  const j = await api(store, `/search?type=track&limit=${n}&q=${encodeURIComponent(String(q || ''))}`);
  return (((j && j.tracks) || {}).items || []).map(account.mapTrack).filter(Boolean);
}

async function getTrack(store, id) {
  return account.mapTrack(await api(store, `/tracks/${encodeURIComponent(id)}`));
}

module.exports = { search, getTrack };
