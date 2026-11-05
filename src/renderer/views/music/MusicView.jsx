// Song Requests page. Pure view: all state and playback live in the always-mounted engine
// (MusicEngine + store.js), so leaving this page never interrupts the music.
import { useEffect, useState } from 'react';
import { PageHeader, Tabs, Pill } from '../../ui.jsx';
import { useMusic } from './store.js';
import { togglePlay } from './player.js';
import NowPlaying from './NowPlaying.jsx';
import QueuePanel from './QueuePanel.jsx';
import SearchBox from './SearchBox.jsx';
import Library from './Library.jsx';
import Setup from './Setup.jsx';
import MusicSettings from './MusicSettings.jsx';
import './music.css';

let lastTab = 'player'; // remembered across page switches

function StatusPills() {
  const spotify = useMusic((s) => s.spotify);
  const twitch = useMusic((s) => s.twitch);
  const local = useMusic((s) => !!s.local.track);
  return (
    <>
      {local && <Pill tone="good">Playing in Steez</Pill>}
      {!spotify.connected ? (
        <Pill>Spotify off</Pill>
      ) : spotify.needsReconnect ? (
        <Pill tone="warn">Spotify: reconnect</Pill>
      ) : (
        <Pill tone={spotify.hasDevice ? 'good' : 'warn'}>{spotify.hasDevice ? `Spotify · ${spotify.deviceName || 'active'}` : 'Spotify idle'}</Pill>
      )}
      <Pill tone={twitch.connected ? 'good' : undefined}>{twitch.connected ? 'Twitch chat' : 'Twitch off'}</Pill>
    </>
  );
}

export default function MusicView() {
  const ready = useMusic((s) => s.ready);
  const setupComplete = useMusic((s) => !!s.settings?.setupComplete);
  const hasSettings = useMusic((s) => !!s.settings);
  const [tab, setTabState] = useState(lastTab);
  const setTab = (t) => setTabState((lastTab = t));

  // Space toggles play/pause while this page is open (not while typing).
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space' || e.repeat) return;
      const el = document.activeElement;
      if (el && (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName) || el.isContentEditable)) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!window.songseek) {
    return (
      <>
        <PageHeader title="Song Requests" />
        <div className="banner bad">The song-request module didn’t load. Check the logs.</div>
      </>
    );
  }
  if (!ready || !hasSettings) {
    return (
      <>
        <PageHeader title="Song Requests" sub="Spotify, YouTube and SoundCloud requests from chat" />
        <div className="faint">Loading…</div>
      </>
    );
  }
  if (!setupComplete) return <Setup />;

  return (
    <>
      <PageHeader title="Song Requests" sub="Spotify, YouTube and SoundCloud requests from chat">
        <StatusPills />
      </PageHeader>
      <Tabs
        tabs={[
          { id: 'player', label: 'Player' },
          { id: 'settings', label: 'Settings' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'player' ? (
        <div className="mu-layout">
          <Library />
          <div className="mu-main">
            <SearchBox />
            <NowPlaying />
          </div>
          <QueuePanel />
        </div>
      ) : (
        <MusicSettings />
      )}
    </>
  );
}
