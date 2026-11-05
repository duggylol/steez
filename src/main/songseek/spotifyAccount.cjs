// The single Spotify account connection: one user login (PKCE, no client secret) that powers
// BOTH library reading and playback control. Steez never plays Spotify audio itself — it
// remote-controls the user's own Spotify app through the Web API.
const http = require('http');
const crypto = require('crypto');

const REDIRECT_PORT = 8888;
// Must exactly match a Redirect URI registered on the Spotify app. Kept identical to the
// standalone SongSeek so an imported "own Spotify app" keeps working without changes.
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}`;

const LIBRARY_SCOPES = ['playlist-read-private', 'playlist-read-collaborative', 'user-library-read'];
const PLAYER_SCOPES = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing'];
const SCOPES = [...LIBRARY_SCOPES, ...PLAYER_SCOPES].join(' ');

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const codeError = (message, code, extra) => Object.assign(new Error(message), { code }, extra);

// The user's OWN Spotify app wins (they own it, so there is no development-mode allowlist);
// otherwise the bundled/imported built-in app id.
function clientId(store) {
  const id = (store.get('spotifyUserClientId') || '').trim() || store.get('spotifySearchClientId');
  if (!id) throw new Error('No Spotify app configured — add your Client ID under Song Requests → Settings.');
  return id;
}

async function tokenRequest(params) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  if (!r.ok) throw new Error(`Spotify token error (${r.status}): ${await r.text()}`);
  return r.json();
}

function saveTokens(store, tokens, prev) {
  store.set('spotifyLibraryTokens', {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || (prev && prev.refresh_token),
    expires_at: Date.now() + (tokens.expires_in - 60) * 1000,
    scope: tokens.scope || (prev && prev.scope) || '',
  });
}

const callbackPage = (ok) =>
  `<!doctype html><meta charset="utf-8"><title>Steez</title><body style="margin:0;background:#161616;color:#e6e6e6;font:15px 'Segoe UI',system-ui,sans-serif;display:grid;place-items:center;height:100vh"><div style="border:1px solid #383838;background:#1c1c1c;padding:22px 28px">${
    ok ? 'Spotify connected. You can close this tab and return to Steez.' : 'Spotify connection failed. You can close this tab.'
  }</div></body>`;

let connecting = false;

/** Browser login (Authorization Code + PKCE) with a one-shot callback server on :8888. */
async function connect(store, openExternal) {
  if (connecting) throw new Error('A Spotify login is already in progress — finish it in your browser.');
  connecting = true;
  try {
    const id = clientId(store);
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const stateParam = b64url(crypto.randomBytes(12));

    const code = await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const u = new URL(req.url, REDIRECT_URI);
        if (u.pathname !== '/' || (!u.searchParams.get('code') && !u.searchParams.get('error'))) {
          res.writeHead(404);
          res.end();
          return;
        }
        const error = u.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(callbackPage(!error));
        clearTimeout(timer);
        server.close();
        if (error) reject(new Error(`Spotify authorization refused: ${error}`));
        else if (u.searchParams.get('state') !== stateParam) reject(new Error('OAuth state mismatch'));
        else resolve(u.searchParams.get('code'));
      });
      server.on('error', (e) =>
        reject(e.code === 'EADDRINUSE' ? new Error('Port 8888 is busy — close other apps using it and try again.') : e),
      );
      const timer = setTimeout(() => {
        server.close();
        reject(new Error('Timed out waiting for the Spotify login'));
      }, 5 * 60 * 1000);

      server.listen(REDIRECT_PORT, '127.0.0.1', () => {
        const authUrl = new URL('https://accounts.spotify.com/authorize');
        authUrl.search = new URLSearchParams({
          client_id: id,
          response_type: 'code',
          redirect_uri: REDIRECT_URI,
          code_challenge_method: 'S256',
          code_challenge: challenge,
          scope: SCOPES,
          state: stateParam,
        }).toString();
        openExternal(authUrl.toString());
      });
    });

    const tokens = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: id,
      code_verifier: verifier,
    });
    saveTokens(store, tokens, null);

    // Who's connected (display only).
    try {
      const me = await api(store, '/me');
      store.set('spotifyUser', { id: me.id, name: me.display_name || me.id, product: me.product });
    } catch {
      /* non-fatal */
    }
    return status(store);
  } finally {
    connecting = false;
  }
}

async function getToken(store) {
  const t = store.get('spotifyLibraryTokens');
  if (!t) return null;
  if (Date.now() < t.expires_at) return t.access_token;
  if (!t.refresh_token) return null;
  const nt = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: clientId(store) });
  saveTokens(store, nt, t);
  return nt.access_token;
}

function disconnect(store) {
  store.merge({ spotifyLibraryTokens: null, spotifyUser: null });
}

// Tokens issued before playback control existed lack the player scopes; reconnect once.
function hasPlayerScopes(store) {
  const t = store.get('spotifyLibraryTokens');
  if (!t) return false;
  const granted = String(t.scope || '').split(/\s+/);
  return PLAYER_SCOPES.every((s) => granted.includes(s));
}

function status(store) {
  const connected = !!store.get('spotifyLibraryTokens');
  return { connected, user: store.get('spotifyUser') || null, needsReconnect: connected && !hasPlayerScopes(store) };
}

/** Raw Web API request. Returns parsed JSON, or null for empty (202/204) responses. */
async function request(store, method, pathname, { body, expectEmpty } = {}) {
  const token = await getToken(store);
  if (!token) throw codeError('Spotify is not connected', 'NO_AUTH');
  const r = await fetch(pathname.startsWith('http') ? pathname : 'https://api.spotify.com/v1' + pathname, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (r.status === 204 || r.status === 202) return null;
  if (r.status === 401) {
    const j = await r.json().catch(() => ({}));
    // "Permissions missing" = token lacks the newer scopes, not a dead session.
    if (/permission/i.test((j.error && j.error.message) || '')) {
      throw codeError('Reconnect Spotify to allow playback control.', 'NEEDS_RECONNECT');
    }
    disconnect(store);
    throw codeError('Spotify login expired — reconnect.', 'NO_AUTH');
  }
  // Spotify says WHY in error.reason. A missing device is 404/NO_ACTIVE_DEVICE, not a Premium issue.
  if (r.status === 403 || r.status === 404) {
    const j = await r.json().catch(() => ({}));
    const err = (j && j.error) || {};
    const reason = err.reason || '';
    if (reason === 'NO_ACTIVE_DEVICE') throw codeError('Spotify is open but not playing — press play in Spotify first.', 'NO_DEVICE');
    if (reason === 'PREMIUM_REQUIRED') throw codeError('Spotify Premium is required to control playback (this account is on Free).', 'PREMIUM');
    if (r.status === 404) throw codeError(err.message || 'Spotify could not find that.', 'NOT_FOUND');
    throw codeError(err.message || `Spotify refused the request (${reason || 403}).`, 'FORBIDDEN', { reason });
  }
  if (r.status === 429) {
    const retryAfter = parseInt(r.headers.get('retry-after') || '', 10);
    throw codeError('Spotify is rate limiting requests.', 'RATE_LIMIT', { retryAfter: Number.isFinite(retryAfter) ? retryAfter : null });
  }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j.error && j.error.message) || `Spotify API error ${r.status}`);
  }
  if (expectEmpty) return null;
  return r.json().catch(() => null);
}

const api = (store, pathname) => request(store, 'GET', pathname);

// ─── Library ─────────────────────────────────────────────────────

/** Spotify track → the unified track shape { source, sourceId, uri, url, title, artist, artwork, durationMs }. */
function mapTrack(t) {
  if (!t || !t.id) return null;
  return {
    source: 'spotify',
    sourceId: t.id,
    uri: t.uri,
    url: t.external_urls && t.external_urls.spotify,
    title: t.name,
    artist: (t.artists || []).map((a) => a.name).join(', '),
    artwork: (t.album && t.album.images && t.album.images[0] && t.album.images[0].url) || '',
    durationMs: t.duration_ms || 0,
  };
}

async function playlists(store) {
  const out = [{ id: 'liked', name: 'Liked Songs', trackCount: null, artwork: null, kind: 'liked' }];
  let url = '/me/playlists?limit=50';
  while (url) {
    const j = await api(store, url);
    for (const p of (j && j.items) || []) {
      if (!p) continue;
      out.push({
        id: p.id,
        uri: p.uri,
        name: p.name,
        trackCount: p.tracks ? p.tracks.total : null,
        artwork: (p.images && p.images[0] && p.images[0].url) || null,
        owner: p.owner && p.owner.display_name,
        kind: 'playlist',
      });
    }
    url = j && j.next;
  }
  return out;
}

async function likedTracks(store, limit = 200) {
  const tracks = [];
  let url = '/me/tracks?limit=50';
  while (url && tracks.length < limit) {
    const j = await api(store, url);
    for (const it of (j && j.items) || []) tracks.push(mapTrack(it.track));
    url = j && j.next;
  }
  return tracks.filter(Boolean);
}

async function playlistTracks(store, id, limit = 500) {
  if (id === 'liked') return likedTracks(store, limit);
  const tracks = [];
  let url = `/playlists/${encodeURIComponent(id)}/tracks?limit=100&fields=next,items(track(id,uri,name,duration_ms,external_urls,artists(name),album(images)))`;
  while (url && tracks.length < limit) {
    const j = await api(store, url);
    for (const it of (j && j.items) || []) tracks.push(mapTrack(it.track));
    url = j && j.next;
  }
  return tracks.filter(Boolean);
}

module.exports = {
  connect,
  disconnect,
  status,
  request,
  api,
  mapTrack,
  playlists,
  playlistTracks,
  hasPlayerScopes,
  REDIRECT_URI,
};
