import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../ui.jsx';
import { useMusic, selectCurrent, selectIsLocal, selectRequester } from './store.js';
import { togglePlay, next, prev, seek, setVolume } from './player.js';
import { connectSpotify } from './engine.js';
import { fmtTime, sourceLabel, friendly, notifyError } from './util.js';

function Progress() {
  const playback = useMusic((s) => s.playback);
  const barRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const duration = playback.durationMs || 0;
  const position = drag != null ? drag : Math.min(playback.positionMs, duration);
  const pct = duration ? (position / duration) * 100 : 0;

  const at = (e) => {
    const r = barRef.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * duration;
  };
  return (
    <div className="mu-progress">
      <span className="mu-time">{fmtTime(position)}</span>
      <div
        ref={barRef}
        className={`mu-bar ${duration ? '' : 'off'} ${drag != null ? 'drag' : ''}`}
        onPointerDown={(e) => {
          if (!duration) return;
          barRef.current.setPointerCapture(e.pointerId);
          setDrag(at(e));
        }}
        onPointerMove={(e) => drag != null && setDrag(at(e))}
        onPointerUp={(e) => {
          if (drag == null) return;
          seek(at(e));
          setDrag(null);
        }}
      >
        <i style={{ width: `${pct}%` }} />
        <b style={{ left: `${pct}%` }} />
      </div>
      <span className="mu-time">{fmtTime(duration)}</span>
    </div>
  );
}

function Volume() {
  const spotifyVol = useMusic((s) => s.spotify.volumePercent);
  const saved = useMusic((s) => s.settings?.volume ?? 0.8);
  // Spotify's own device level is the truth when known — it's what the stream hears.
  const value = typeof spotifyVol === 'number' && spotifyVol >= 0 ? spotifyVol / 100 : saved;
  return (
    <div className="mu-volume" title={`Volume ${Math.round(value * 100)}%`}>
      <Icon name="volume" />
      <input type="range" min="0" max="1" step="0.01" value={value} onChange={(e) => setVolume(parseFloat(e.target.value))} />
    </div>
  );
}

function DevicePicker() {
  const spotify = useMusic((s) => s.spotify);
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState(null);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => boxRef.current && !boxRef.current.contains(e.target) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  if (!spotify.connected || spotify.needsReconnect) return null;
  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    setDevices(null);
    try {
      setDevices(await window.songseek.spotify.devices());
    } catch (e) {
      setDevices([]);
      notifyError(friendly(e));
    }
  };
  const pick = async (d) => {
    setOpen(false);
    if (d.id === spotify.deviceId) return;
    try {
      await window.songseek.spotify.transfer(d.id);
    } catch (e) {
      notifyError(friendly(e));
    }
  };
  return (
    <div className="mu-device" ref={boxRef}>
      <button className="sm ghost" onClick={toggle} title="Spotify device">
        <Icon name="link" />
        <span className="nowrap-text">{spotify.deviceName || 'No device'}</span>
      </button>
      {open && (
        <div className="mu-pop">
          <div className="mu-pop-label">Play on</div>
          {devices == null && <div className="mu-pop-hint">Looking for devices…</div>}
          {devices && !devices.length && <div className="mu-pop-hint">No devices — open Spotify on this PC or your phone.</div>}
          {devices &&
            devices.map((d) => (
              <button key={d.id} className={`mu-pop-item ${d.id === spotify.deviceId ? 'on' : ''}`} onClick={() => pick(d)}>
                <span className="grow nowrap-text">{d.name}</span>
                <span className="faint small">{d.type}</span>
                {d.id === spotify.deviceId && <Icon name="check" />}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/** Explains why Spotify isn't being controlled, with the one action that fixes it. */
function DeviceBanner() {
  const spotify = useMusic((s) => s.spotify);
  const waitingCount = useMusic((s) => s.queue.length);
  const allowSpotify = useMusic((s) => s.settings?.allowSpotify !== false);
  const [busy, setBusy] = useState(false);
  const waiting = waitingCount ? ` ${waitingCount} request${waitingCount === 1 ? '' : 's'} waiting.` : '';

  const run = async (fn) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };

  if (!spotify.connected) {
    if (!allowSpotify) return null;
    return (
      <div className="banner">
        <div className="grow">Spotify isn't connected — Spotify requests can't be queued.</div>
        <button className="sm" disabled={busy} onClick={() => run(connectSpotify)}>
          {busy ? 'Waiting for browser…' : 'Connect Spotify'}
        </button>
      </div>
    );
  }
  if (spotify.needsReconnect) {
    return (
      <div className="banner warn">
        <div className="grow">Reconnect Spotify to allow playback control.</div>
        <button className="sm" disabled={busy} onClick={() => run(connectSpotify)}>
          {busy ? 'Waiting for browser…' : 'Reconnect'}
        </button>
      </div>
    );
  }
  if (spotify.limited) return <div className="banner warn">Spotify is rate limiting requests — catching up in a moment. Requests are still being saved.</div>;
  if (spotify.error) return <div className="banner bad">Spotify: {spotify.error}</div>;
  if (spotify.hasDevice) return null;

  const d = (spotify.availableDevices || [])[0];
  if (d) {
    return (
      <div className="banner warn">
        <div className="grow">Spotify is open but not playing.{waiting}</div>
        <button
          className="sm"
          disabled={busy}
          onClick={() =>
            run(async () => {
              try {
                await window.songseek.spotify.transfer(d.id);
              } catch (e) {
                notifyError(friendly(e));
              }
            })
          }
        >
          {busy ? 'Starting…' : `Start on ${d.name}`}
        </button>
      </div>
    );
  }
  return <div className="banner">Open Spotify and press play — requests are queued into it from there.{waiting}</div>;
}

export default function NowPlaying() {
  const current = useMusic(selectCurrent);
  const isLocal = useMusic(selectIsLocal);
  const requester = useMusic(selectRequester);
  const playing = useMusic((s) => s.playback.playing);
  const canPlay = useMusic((s) => !!selectCurrent(s) || s.queue.length > 0 || s.spotify.hasDevice);
  const key = current ? current.uri || current.sourceId || current.id : 'none';

  return (
    <div className="panel mu-np">
      <DeviceBanner />
      <div className="mu-np-body">
        <div className="mu-art">
          {current && current.artwork ? <img key={key} src={current.artwork} alt="" draggable={false} /> : <Icon name="music" size={44} />}
        </div>
        <div className="mu-np-info">
          <div className="mu-np-meta">
            {current ? (
              <>
                <span className="tag">{sourceLabel(current.source)}</span>
                {isLocal && <span className="faint small">playing in Steez</span>}
                {requester && <span className="faint small">requested by {requester}</span>}
              </>
            ) : (
              <span className="faint small">Idle</span>
            )}
          </div>
          <div className="mu-np-text" key={key}>
            <div className="mu-np-title" title={current ? current.title : ''}>
              {current ? current.title : 'Nothing playing'}
            </div>
            <div className="mu-np-artist">{current ? current.artist : 'Play something in Spotify, or queue a request'}</div>
          </div>
          <Progress />
          <div className="mu-transport">
            <button className="icon ghost" onClick={prev} title="Previous">
              <Icon name="prev" />
            </button>
            <button className="mu-play primary" onClick={togglePlay} disabled={!canPlay} title={playing ? 'Pause' : 'Play'}>
              <Icon name={playing ? 'pause' : 'play'} size={16} />
            </button>
            <button className="icon ghost" onClick={next} title="Skip">
              <Icon name="next" />
            </button>
            <div className="grow" />
            <Volume />
            <DevicePicker />
          </div>
        </div>
      </div>
    </div>
  );
}
