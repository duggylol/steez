import { useEffect, useState } from 'react';
import { Panel, Field, Toggle, Icon, copyText } from '../../ui.jsx';
import { useMusic } from './store.js';
import { disconnectSpotify } from './engine.js';
import { handleIncomingRequest } from './requests.js';
import { OwnAppSteps, SpotifyButtons, SpotifyStatusLine, TextSetting, TwitchStatus, open } from './parts.jsx';
import { friendly, notify } from './util.js';

function SpotifyPanel() {
  const settings = useMusic((s) => s.settings);
  const patchSettings = useMusic((s) => s.patchSettings);
  const connected = useMusic((s) => s.spotify.connected);
  const [diag, setDiag] = useState('');
  const builtIn = !!settings._bundled?.spotifyApp;

  return (
    <Panel title="Spotify" actions={<SpotifyStatusLine />}>
      <p className="muted" style={{ marginTop: 0 }}>
        Requests go into your Spotify app’s own queue, so your playlist keeps going. Spotify Premium is required.
      </p>
      <div className="row">
        <SpotifyButtons />
        <button
          onClick={async () => {
            setDiag('Testing…');
            try {
              setDiag(await window.songseek.spotify.diagnose());
            } catch (e) {
              setDiag(friendly(e));
            }
          }}
        >
          Test connection
        </button>
      </div>
      {diag && <pre className="mu-diag">{diag}</pre>}
      <div className="divider" />
      <div className="mu-subhead">Use your own Spotify app</div>
      <OwnAppSteps />
      <Field label="Your Client ID" help={builtIn ? 'Leave empty to use the built-in Spotify app.' : 'Required — Steez ships without a Spotify app.'}>
        <TextSetting
          value={settings.spotifyUserClientId}
          placeholder="paste it here"
          mono
          onSave={async (v) => {
            // A login belongs to the app that issued it — switching apps means logging in again.
            if (connected) await disconnectSpotify();
            await patchSettings({ spotifyUserClientId: v });
            notify(v ? 'Client ID saved — now click Connect Spotify' : 'Using the built-in Spotify app');
          }}
        />
      </Field>
    </Panel>
  );
}

function RequestsPanel() {
  const settings = useMusic((s) => s.settings);
  const patchSettings = useMusic((s) => s.patchSettings);
  const go = useMusic((s) => s.go);
  const set = (patch) => patchSettings(patch);
  const allOff = settings.allowSpotify === false && settings.allowYoutube === false && settings.allowSoundcloud === false;

  return (
    <Panel title="Requests">
      <Field label="Channel point reward" help="Must match the reward title on your channel exactly (not case-sensitive).">
        <TextSetting value={settings.rewardName} placeholder="Song Request" onSave={(v) => set({ rewardName: v })} />
      </Field>
      <Toggle value={settings.chatCommandEnabled} onChange={(v) => set({ chatCommandEnabled: v })} label="!sr chat command" help="Works without Affiliate. Permission, cooldown and aliases are on the Commands page." />
      <Toggle value={settings.modCommandsEnabled} onChange={(v) => set({ modCommandsEnabled: v })} label="Playback commands" help="!skip !pause !play !clearqueue for mods, !song for everyone." />
      <Toggle value={settings.chatAnnounce} onChange={(v) => set({ chatAnnounce: v })} label="Announce in chat" help="Confirm each request in chat as it’s queued." />
      <button className="sm ghost" onClick={() => (go ? go('commands') : (location.hash = 'commands'))}>
        <Icon name="terminal" />
        Open Commands
      </button>
      <div className="divider" />
      <div className="mu-subhead">Allowed sources</div>
      <Toggle value={settings.allowSpotify !== false} onChange={(v) => set({ allowSpotify: v })} label="Spotify" help="Queued in your Spotify app." />
      <Toggle value={settings.allowYoutube !== false} onChange={(v) => set({ allowYoutube: v })} label="YouTube" help="Plays in Steez at Spotify’s volume." />
      <Toggle value={settings.allowSoundcloud !== false} onChange={(v) => set({ allowSoundcloud: v })} label="SoundCloud" help="Plays in Steez at Spotify’s volume." />
      {allOff && <div className="banner bad">All sources are off — no requests can be taken.</div>}
    </Panel>
  );
}

function PlaybackPanel() {
  const volume = useMusic((s) => s.settings.volume ?? 0.8);
  const patchSettings = useMusic((s) => s.patchSettings);
  const [v, setV] = useState(volume);
  useEffect(() => setV(volume), [volume]);
  return (
    <Panel title="Playback">
      <Field label={`Fallback volume — ${Math.round(v * 100)}%`} help="YouTube and SoundCloud follow Spotify’s device volume. This level is used when Spotify’s is unknown.">
        <input type="range" min="0" max="1" step="0.01" value={v} onChange={(e) => setV(parseFloat(e.target.value))} onPointerUp={() => patchSettings({ volume: v })} onKeyUp={() => patchSettings({ volume: v })} />
      </Field>
    </Panel>
  );
}

function OverlayPanel() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    window.songseek.appInfo().then(setInfo);
  }, []);
  return (
    <Panel title="OBS overlay — now playing">
      <p className="muted" style={{ marginTop: 0 }}>
        Add a <b>Browser Source</b> in OBS at 800×160. A card slides in on every new song and on <code>!song</code>. SongSeek’s overlay URL keeps working.
      </p>
      <div className="mu-field">
        <span>URL</span>
        <div className="row nowrap mu-copy">
          <code className="grow nowrap-text">{info?.overlayUrl || '—'}</code>
          <button className="sm" disabled={!info?.overlayUrl} onClick={() => copyText(info.overlayUrl, 'Overlay URL copied')}>
            <Icon name="copy" />
            Copy
          </button>
          <button className="sm" disabled={!info?.overlayUrl} onClick={() => open(info.overlayUrl)}>
            <Icon name="external" />
            Open
          </button>
        </div>
      </div>
      {/* Not a <label>: a label forwards clicks on the path text to its first button. */}
      <div className="mu-field">
        <span>Local file</span>
        <div className="row nowrap mu-copy">
          <code className="grow nowrap-text">{info?.overlayFile || '—'}</code>
          <button className="sm" disabled={!info?.overlayFile} onClick={() => copyText(info.overlayFile, 'Overlay file path copied')}>
            <Icon name="copy" />
            Copy
          </button>
        </div>
        <div className="help">Tick “Local file” in OBS and pick this — it loads even when OBS starts before Steez.</div>
      </div>
      {info?.overlayPortMoved && <div className="banner warn">Another program took port 43112, so the URL changed. Re-copy it into OBS or use the local file.</div>}
      <div className="row">
        <button className="sm" onClick={() => window.songseek.overlay.show()}>
          <Icon name="play" />
          Replay card
        </button>
        <button className="sm ghost" onClick={() => window.songseek.overlay.hide()}>
          Hide card
        </button>
      </div>
    </Panel>
  );
}

function TestPanel() {
  const patchSettings = useMusic((s) => s.patchSettings);
  const [text, setText] = useState('');
  const send = () => {
    if (!text.trim()) return;
    handleIncomingRequest({ user: 'TestViewer', input: text.trim(), via: 'test' });
    setText('');
  };
  return (
    <Panel title="Test a request">
      <p className="muted" style={{ marginTop: 0 }}>
        Queue something as if a viewer asked for it — name or link.
      </p>
      <div className="row nowrap">
        <input value={text} placeholder="song name or link" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
        <button className="primary" disabled={!text.trim()} onClick={send}>
          Send
        </button>
      </div>
      <div className="divider" />
      <button className="sm ghost" onClick={() => patchSettings({ setupComplete: false })}>
        Run the setup guide again
      </button>
    </Panel>
  );
}

export default function MusicSettings() {
  return (
    <div className="grid2">
      <div>
        <SpotifyPanel />
        <Panel title="Twitch">
          <p className="muted" style={{ marginTop: 0 }}>
            Uses Steez’s shared Twitch connection for chat commands, announcements and channel points.
          </p>
          <TwitchStatus />
        </Panel>
        <OverlayPanel />
      </div>
      <div>
        <RequestsPanel />
        <PlaybackPanel />
        <TestPanel />
      </div>
    </div>
  );
}
