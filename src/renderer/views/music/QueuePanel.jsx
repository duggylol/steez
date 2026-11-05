import { Icon, Panel, Empty } from '../../ui.jsx';
import { useMusic } from './store.js';
import { removeFromQueue, playFromQueue, clearQueue } from './player.js';
import { fmtTime, sourceLabel, notify } from './util.js';

function Art({ src }) {
  return <div className="mu-thumb">{src ? <img src={src} alt="" draggable={false} /> : <Icon name="music" />}</div>;
}

function RequestRow({ track, index, onDeck }) {
  return (
    <div className={`mu-row ${onDeck ? 'deck' : ''}`}>
      <span className="mu-idx">{index + 1}</span>
      <Art src={track.artwork} />
      <div className="mu-row-text">
        <div className="mu-row-title" title={track.title}>
          {track.title}
        </div>
        <div className="mu-row-sub">
          {track.artist}
          {track.requestedBy ? ` · ${track.requestedBy}` : ''}
        </div>
        <div className="mu-row-tags">
          <span className="tag">{sourceLabel(track.source)}</span>
          {onDeck && <span className="tag mu-deck-tag">In Spotify queue</span>}
        </div>
      </div>
      <span className="mu-time">{track.durationMs ? fmtTime(track.durationMs) : ''}</span>
      <div className="mu-row-actions">
        <button className="icon ghost" title="Play now" onClick={() => playFromQueue(track.id)}>
          <Icon name="play" />
        </button>
        <button className="icon ghost" title={onDeck ? 'Already in Spotify’s queue — skip it instead' : 'Remove'} disabled={onDeck} onClick={() => removeFromQueue(track.id)}>
          <Icon name="x" />
        </button>
      </div>
    </div>
  );
}

export default function QueuePanel() {
  const queue = useMusic((s) => s.queue);
  const pushedUri = useMusic((s) => s.pushedUri);
  const spotifyQueue = useMusic((s) => s.spotifyQueue);
  const hasDevice = useMusic((s) => s.spotify.hasDevice);

  // Spotify's own upcoming tracks, minus requests we already show (the on-deck one is in both).
  const requestUris = new Set(queue.map((t) => t.uri).filter(Boolean));
  const upNext = spotifyQueue.filter((t) => !requestUris.has(t.uri)).slice(0, 12);
  const clearable = queue.filter((t) => !(t.uri && t.uri === pushedUri)).length;

  return (
    <Panel
      className="mu-queue"
      title={`Requests${queue.length ? ` · ${queue.length}` : ''}`}
      actions={
        clearable > 0 && (
          <button
            className="sm ghost"
            onClick={() => {
              const n = clearQueue();
              notify(`Cleared ${n} request${n === 1 ? '' : 's'}`);
            }}
          >
            <Icon name="trash" />
            Clear
          </button>
        )
      }
    >
      <div className="mu-list">
        {queue.map((t, i) => (
          <RequestRow key={t.id} track={t} index={i} onDeck={!!t.uri && t.uri === pushedUri} />
        ))}
        {!queue.length && (
          <Empty>
            No requests yet
            <div className="small" style={{ marginTop: 4 }}>
              {hasDevice ? 'Requests play next, then Spotify continues where it left off.' : 'Viewer song requests appear here.'}
            </div>
          </Empty>
        )}
        {upNext.length > 0 && (
          <>
            <div className="mu-sublabel">Up next on Spotify</div>
            {upNext.map((t, i) => (
              <div className="mu-row ghost" key={`${t.uri}-${i}`}>
                <span className="mu-idx">{i + 1}</span>
                <Art src={t.artwork} />
                <div className="mu-row-text">
                  <div className="mu-row-title" title={t.title}>
                    {t.title}
                  </div>
                  <div className="mu-row-sub">{t.artist}</div>
                </div>
                <span className="mu-time">{t.durationMs ? fmtTime(t.durationMs) : ''}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </Panel>
  );
}
