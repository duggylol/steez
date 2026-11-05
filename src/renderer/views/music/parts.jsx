// Small pieces shared by the setup guide and the settings tab.
import { useEffect, useState } from 'react';
import { Icon, copyText } from '../../ui.jsx';
import { useMusic } from './store.js';
import { connectSpotify, disconnectSpotify, twitchLogin } from './engine.js';

export const SPOTIFY_REDIRECT = 'http://127.0.0.1:8888';
export const SPOTIFY_DASHBOARD = 'https://developer.spotify.com/dashboard';

export const open = (url) => window.steez.open(url);

/** Text input that saves on blur / Enter. */
export function TextSetting({ value, onSave, placeholder, mono }) {
  const [v, setV] = useState(value || '');
  useEffect(() => setV(value || ''), [value]);
  return (
    <input
      className={mono ? 'mono' : undefined}
      value={v}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() !== (value || '') && onSave(v.trim())}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

/** A value with a copy button (redirect URI, overlay URL…). */
export function CopyLine({ value, message = 'Copied' }) {
  return (
    <div className="row nowrap mu-copy">
      <code className="grow nowrap-text">{value || '—'}</code>
      <button className="sm" disabled={!value} onClick={() => copyText(value, message)}>
        <Icon name="copy" />
        Copy
      </button>
    </div>
  );
}

/** Connect / Reconnect / Disconnect for the Spotify account. */
export function SpotifyButtons({ allowDisconnect = true }) {
  const spotify = useMusic((s) => s.spotify);
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    await connectSpotify();
    setBusy(false);
  };
  if (spotify.connected && !spotify.needsReconnect) {
    return allowDisconnect ? (
      <button className="danger" onClick={disconnectSpotify}>
        Disconnect
      </button>
    ) : null;
  }
  return (
    <button className="primary" disabled={busy} onClick={connect}>
      {busy ? 'Waiting for your browser…' : spotify.needsReconnect ? 'Reconnect Spotify' : 'Connect Spotify'}
    </button>
  );
}

export function SpotifyStatusLine() {
  const spotify = useMusic((s) => s.spotify);
  if (!spotify.connected) return <span className="pill">Not connected</span>;
  if (spotify.needsReconnect) return <span className="pill warn">Reconnect needed</span>;
  return (
    <span className="pill good">
      {spotify.user ? spotify.user.name : 'Connected'}
      {spotify.hasDevice ? ` · ${spotify.deviceName || 'Spotify'}` : ' · no active device'}
    </span>
  );
}

/** Twitch is Steez's shared connection: status here, login via the shell. */
export function TwitchStatus() {
  const twitch = useMusic((s) => s.twitch);
  const go = useMusic((s) => s.go);
  const [busy, setBusy] = useState(false);
  return (
    <div className="row">
      {twitch.connected ? (
        <span className="pill good">#{twitch.user?.login}</span>
      ) : twitch.loggedIn ? (
        <span className="pill warn">Connecting to chat…</span>
      ) : twitch.expired ? (
        <span className="pill bad">Login expired</span>
      ) : (
        <span className="pill">Not connected</span>
      )}
      {!twitch.loggedIn && (
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await twitchLogin();
            setBusy(false);
          }}
        >
          {busy ? 'Waiting for your browser…' : 'Log in with Twitch'}
        </button>
      )}
      <button className="ghost" onClick={() => (go ? go('settings') : (location.hash = 'settings'))}>
        Twitch settings
      </button>
    </div>
  );
}

/** The "create your own Spotify app" walkthrough (dashboard steps + redirect URI). */
export function OwnAppSteps() {
  return (
    <ol className="mu-steps">
      <li>
        Open the{' '}
        <a href="#" onClick={(e) => (e.preventDefault(), open(SPOTIFY_DASHBOARD))}>
          Spotify Developer Dashboard
        </a>{' '}
        and click <b>Create app</b> (log in with your normal Spotify account).
      </li>
      <li>
        Name it anything — <b>Steez</b> works. Add this <b>Redirect URI</b> exactly:
        <CopyLine value={SPOTIFY_REDIRECT} message="Redirect URI copied" />
      </li>
      <li>
        Tick <b>Web API</b>, accept the terms and <b>Save</b>.
      </li>
      <li>
        Open the app's <b>Settings</b> and copy its <b>Client ID</b> (never the Client Secret).
      </li>
    </ol>
  );
}
