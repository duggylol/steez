import { useState } from 'react';
import { Icon, Panel } from '../../ui.jsx';
import { useMusic } from './store.js';
import { playPlaylist } from './player.js';
import { loadPlaylists, connectSpotify } from './engine.js';
import { friendly, notify, notifyError } from './util.js';

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The streamer's Spotify playlists; clicking one starts it on their Spotify device. */
export default function Library() {
  const library = useMusic((s) => s.library);
  const spotify = useMusic((s) => s.spotify);
  const [loadingId, setLoadingId] = useState(null);
  const [shuffle, setShuffle] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const connected = spotify.connected && !spotify.needsReconnect;

  const play = async (pl) => {
    setLoadingId(pl.id);
    try {
      let ok;
      // A playlist starts as a Spotify context so "up next" stays intact; Liked Songs and
      // shuffled lists are sent as track URIs.
      if (pl.uri && !shuffle) ok = await playPlaylist(null, { id: pl.id, uri: pl.uri });
      else {
        const tracks = await window.songseek.library.tracks(pl.id);
        if (!tracks.length) notifyError(`"${pl.name}" has no playable tracks`);
        else ok = await playPlaylist(shuffle ? shuffled(tracks) : tracks, { id: pl.id });
      }
      if (ok) notify(`Playing "${pl.name}" on Spotify`);
    } catch (e) {
      notifyError(friendly(e));
    }
    setLoadingId(null);
  };

  return (
    <Panel
      className="mu-lib"
      title="Library"
      actions={
        connected && (
          <>
            <button className={`sm ghost ${shuffle ? 'mu-on' : ''}`} onClick={() => setShuffle((v) => !v)} title="Shuffle when starting a playlist">
              Shuffle {shuffle ? 'on' : 'off'}
            </button>
            <button className="icon ghost" title="Reload playlists" onClick={loadPlaylists}>
              <Icon name="refresh" />
            </button>
          </>
        )
      }
    >
      {!connected ? (
        <div className="mu-lib-empty">
          <p className="muted small">Connect Spotify to start your playlists and Liked Songs from here.</p>
          <button
            disabled={connecting}
            onClick={async () => {
              setConnecting(true);
              await connectSpotify();
              setConnecting(false);
            }}
          >
            {connecting ? 'Waiting for browser…' : spotify.needsReconnect ? 'Reconnect Spotify' : 'Connect Spotify'}
          </button>
        </div>
      ) : (
        <div className="mu-list">
          {library.loading && !library.playlists.length && <div className="mu-pop-hint">Loading…</div>}
          {library.playlists.map((pl) => (
            <button key={pl.id} className={`mu-pl ${library.activeId === pl.id ? 'on' : ''}`} onClick={() => play(pl)} disabled={loadingId === pl.id}>
              <div className="mu-thumb">{pl.artwork ? <img src={pl.artwork} alt="" draggable={false} /> : <Icon name={pl.kind === 'liked' ? 'check' : 'music'} />}</div>
              <div className="mu-row-text">
                <div className="mu-row-title">{pl.name}</div>
                <div className="mu-row-sub">{pl.kind === 'liked' ? 'Liked Songs' : `Playlist${pl.trackCount != null ? ` · ${pl.trackCount}` : ''}`}</div>
              </div>
              {loadingId === pl.id ? <span className="mu-spin" /> : library.activeId === pl.id ? <span className="mu-eq"><i /><i /><i /></span> : null}
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}
