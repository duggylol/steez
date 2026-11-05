import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../ui.jsx';
import { allowedSources, resolveRequest } from './requests.js';
import { enqueue, playNow } from './player.js';
import { fmtTime, SOURCE_LABEL, parseRequest, notify } from './util.js';

const SECTIONS = ['spotify', 'youtube', 'soundcloud'];

/** Search Spotify, YouTube and SoundCloud at once; click a result to queue it. */
export default function SearchBox() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const seq = useRef(0);

  useEffect(() => {
    const onDown = (e) => boxRef.current && !boxRef.current.contains(e.target) && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      seq.current++;
      setResults(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      // A pasted link resolves to exactly that track.
      const parsed = parseRequest(query);
      if (parsed.type !== 'query') {
        const r = await resolveRequest(query).catch(() => ({}));
        if (mine !== seq.current) return;
        const empty = { spotify: [], youtube: [], soundcloud: [] };
        setResults(r.track ? { ...empty, [r.track.source]: [r.track] } : empty);
        setBusy(false);
        setOpen(true);
        return;
      }
      const allow = allowedSources();
      const S = window.songseek.search;
      const top = (p) => p.then((r) => (r || []).slice(0, 4)).catch(() => []);
      const [spotify, youtube, soundcloud] = await Promise.all([
        allow.spotify ? top(S.spotify(query, 4)) : [],
        allow.youtube ? top(S.youtube(query)) : [],
        allow.soundcloud ? top(S.soundcloud(query)) : [],
      ]);
      if (mine !== seq.current) return;
      setResults({ spotify, youtube, soundcloud });
      setBusy(false);
      setOpen(true);
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const add = async (track, now = false) => {
    setOpen(false);
    setQ('');
    if (now) return playNow({ ...track, requestedBy: 'You' });
    const r = await enqueue({ ...track, requestedBy: 'You' });
    if (r.status === 'no-device') notify(`Saved "${track.title}" (#${r.position}) — it goes to Spotify once Spotify is playing`);
    else if (r.status !== 'error') notify(`Queued "${track.title}" (#${r.position})`);
  };

  const hasAny = results && SECTIONS.some((k) => results[k].length);

  return (
    <div className="mu-search" ref={boxRef}>
      <div className="mu-search-input">
        <Icon name="search" />
        <input
          value={q}
          placeholder="Search Spotify, YouTube and SoundCloud, or paste a link…"
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'Enter' && results) {
              const first = SECTIONS.map((k) => results[k][0]).find(Boolean);
              if (first) add(first);
            }
          }}
          spellCheck={false}
        />
        {busy && <span className="mu-spin" />}
      </div>
      {open && results && (
        <div className="mu-results">
          {!hasAny && <div className="mu-pop-hint">No results</div>}
          {SECTIONS.map((key) =>
            results[key].length ? (
              <div key={key}>
                <div className="mu-pop-label">{SOURCE_LABEL[key]}</div>
                {results[key].map((t) => (
                  <div key={`${key}-${t.sourceId}`} className="mu-result" onClick={() => add(t)} title="Add to queue">
                    <div className="mu-thumb">{t.artwork ? <img src={t.artwork} alt="" draggable={false} /> : <Icon name="music" />}</div>
                    <div className="mu-row-text">
                      <div className="mu-row-title">{t.title}</div>
                      <div className="mu-row-sub">{t.artist}</div>
                    </div>
                    <span className="mu-time">{t.durationMs ? fmtTime(t.durationMs) : ''}</span>
                    <button className="icon ghost" title="Add to queue" onClick={(e) => (e.stopPropagation(), add(t))}>
                      <Icon name="plus" />
                    </button>
                    <button className="icon ghost" title="Play now" onClick={(e) => (e.stopPropagation(), add(t, true))}>
                      <Icon name="play" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
