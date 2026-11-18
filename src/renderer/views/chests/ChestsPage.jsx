// Fortnite chest tracker page. Data and controls come from src/main/chests (which runs
// ChestTracker.exe); live updates arrive over /chests/api/stream.
import { useEffect, useRef, useState } from 'react';
import { PageHeader, Panel, Button, Toggle, Field, Seg, Stat, Pill, Empty, toast, copyText } from '../../ui.jsx';
import { steezInfo } from '../../lib/bot.js';

const fmt = (n) => Number(n || 0).toLocaleString();
const when = (t) => {
  const d = new Date(t);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};
const pct = (p) => (p >= 0.995 ? '>99%' : p < 0.001 ? '<0.1%' : p < 0.1 ? (p * 100).toFixed(1) + '%' : Math.round(p * 100) + '%');
const PERIODS = [
  { id: 'day', label: '24 hours' },
  { id: 'week', label: '7 days' },
  { id: 'season', label: 'Season' },
  { id: 'all', label: 'All time' },
];

async function call(method, path, body) {
  const { apiKey } = await steezInfo();
  const r = await fetch(path, { method, headers: { 'x-steez-key': apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
const act = (fn, ok) =>
  Promise.resolve()
    .then(fn)
    .then((r) => (ok && toast(ok), r))
    .catch((e) => toast(e.message || String(e), { error: true }));

function useChests() {
  const [st, setSt] = useState(null);
  useEffect(() => {
    let es;
    let stop = false;
    steezInfo().then(({ apiKey }) => {
      if (stop) return;
      es = new EventSource('/chests/api/stream?key=' + encodeURIComponent(apiKey));
      es.onmessage = (e) => setSt(JSON.parse(e.data));
    });
    return () => {
      stop = true;
      es?.close();
    };
  }, []);
  return [st, setSt];
}

export default function ChestsPage() {
  const [st, setSt] = useChests();
  const [period, setPeriod] = useState('season');
  if (!st) return <div className="faint">Loading…</div>;
  const s = st.settings;
  const H = st.helper;
  const save = (patch, ok) => act(() => call('PUT', '/chests/api/settings', patch).then(setSt), ok);
  const on = s.enabled;
  const running = H.status === 'running';
  const scanning = !!st.scan;

  return (
    <>
      <PageHeader title="Fortnite Chests" sub="Counts every chest you open: live while you play, and exactly from your replays after each match. Normal Build and Zero Build Battle Royale only.">
        {on && running && (
          <Button icon="refresh" disabled={scanning} onClick={() => act(() => call('POST', '/chests/api/scan'))}>
            {scanning ? `Reading replays ${st.scan.done}/${st.scan.total}` : 'Read new replays'}
          </Button>
        )}
      </PageHeader>

      {on && H.status === 'missing' && <div className="banner bad"><div className="grow">{H.error}</div></div>}
      {on && H.status === 'error' && <div className="banner warn"><div className="grow">{H.error}</div></div>}
      {on && running && H.demosExists === false && (
        <div className="banner warn">
          <div className="grow">Fortnite’s replay folder wasn’t found. In Fortnite: Settings → Game → Replays → turn on <b>Record Replays</b>. The live counter still works without it.</div>
        </div>
      )}
      {on && running && H.ocr === false && (
        <div className="banner warn">
          <div className="grow">The live counter needs a Windows OCR language (Settings → Time &amp; Language → Language). Counts from replays still work.</div>
        </div>
      )}

      <div className="grid3">
        <LiveCard st={st} save={save} />
        <TotalCard st={st} save={save} />
        <StatsCard st={st} period={period} setPeriod={setPeriod} />
      </div>
      <div className="grid2">
        <OverlayCard st={st} save={save} />
        <TreasureCard st={st} />
      </div>
      <div className="grid2">
        <MatchesCard st={st} />
        <SquadCard st={st} />
      </div>
      <SettingsCard st={st} save={save} />
      <style>{CSS}</style>
    </>
  );
}

function LiveCard({ st, save }) {
  const s = st.settings;
  const H = st.helper;
  const inMatch = st.live !== null && st.live !== undefined;
  const screen = H.screens?.find((x) => x.index === s.screenIndex) || H.screens?.find((x) => x.primary);
  return (
    <Panel title="This match" actions={<Pill tone={inMatch ? 'good' : ''}>{inMatch ? 'In a match' : 'Between matches'}</Pill>}>
      <div className="ch-big">{inMatch ? st.live : '—'}</div>
      <div className="faint small">{inMatch ? 'chests opened so far' : 'The count starts when your next match does.'}</div>
      <div className="row" style={{ marginTop: 12 }}>
        <Button size="sm" onClick={() => act(() => call('POST', '/chests/api/adjust', { delta: 1 }))} disabled={!s.enabled}>
          +1 chest
        </Button>
        <Button size="sm" onClick={() => act(() => call('POST', '/chests/api/adjust', { delta: -1 }))} disabled={!s.enabled || !inMatch}>
          −1
        </Button>
        <span className="faint small">Fix a missed or doubled chest</span>
      </div>
      <div className="divider" />
      <Toggle value={s.liveCounter} onChange={(v) => save({ liveCounter: v })} label="Count live while I play" help={`Reads the “+XP CHEST” popup off ${screen ? screen.name : 'your main monitor'}. Screen only, no game hooks, so it’s anticheat-safe. Play in borderless windowed.`} />
      {s.liveCounter && st.popup && <div className="faint small">Last popup read: “{st.popup}”</div>}
    </Panel>
  );
}

function TotalCard({ st, save }) {
  const t = st.settings.total;
  const [n, setN] = useState('');
  return (
    <Panel title="Your chest total" actions={<Toggle value={t.on} onChange={(v) => save({ total: { on: v } })} />}>
      <div className={`ch-big ${t.on ? '' : 'ch-off'}`}>{t.on ? fmt(st.total) : '—'}</div>
      <div className="faint small">{t.on ? 'chests opened, counting up from the number you set' : 'Turn this on to count up from a number you choose.'}</div>
      <div className="divider" />
      <Field label="Chests I’ve already opened" help="The total jumps to this number now, then every chest you open adds one. Shown on the overlays and in !chests.">
        <div className="row nowrap">
          <input type="number" min="0" placeholder={t.on ? String(st.total) : 'e.g. 1500'} value={n} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && n !== '' && save({ total: { on: true, count: Number(n) } }, 'Total set').then(() => setN(''))} />
          <Button variant="primary" disabled={n === ''} onClick={() => save({ total: { on: true, count: Number(n) } }, 'Total set').then(() => setN(''))}>
            Set
          </Button>
        </div>
      </Field>
    </Panel>
  );
}

function StatsCard({ st, period, setPeriod }) {
  const p = st.stats?.periods?.[period] || { matches: 0, chests: 0, avg: 0, best: 0 };
  return (
    <Panel title="Your stats">
      <Seg options={PERIODS} value={period} onChange={setPeriod} />
      <div className="ch-stats">
        <Stat value={fmt(p.chests)} label="Chests" />
        <Stat value={p.avg ? p.avg.toFixed(1) : '0'} label="Per match" />
        <Stat value={fmt(p.matches)} label="Matches" />
        <Stat value={fmt(p.best)} label="Best match" />
      </div>
      {st.lastScan && (
        <div className="faint small" style={{ marginTop: 10 }}>
          Last replay read: {st.lastScan.newMatches} new {st.lastScan.newMatches === 1 ? 'match' : 'matches'}
          {st.lastScan.skippedMode ? `, ${st.lastScan.skippedMode} skipped (Ranked, Reload, Creative…)` : ''}
          {st.lastScan.failed ? `, ${st.lastScan.failed} unreadable` : ''}.
        </div>
      )}
    </Panel>
  );
}

const STYLES = [
  { id: 'text', label: 'Text', path: '/overlay/chests?style=text', w: 620, h: 100 },
  { id: 'card', label: 'Card', path: '/overlay/chests', w: 400, h: 180 },
  { id: 'total', label: 'Total', path: '/overlay/chests?style=total', w: 460, h: 150 },
  { id: 'pill', label: 'Compact', path: '/overlay/chests?style=pill', w: 300, h: 80 },
];
function OverlayCard({ st, save }) {
  const o = st.settings.overlay;
  const [style, setStyle] = useState('text');
  const [base, setBase] = useState('');
  const [title, setTitle] = useState(o.title);
  const [label, setLabel] = useState(o.textLabel || 'Chests Opened:');
  useEffect(() => {
    window.steez.overlays().then((d) => setBase(d.baseUrl));
  }, []);
  const S = STYLES.find((x) => x.id === style);
  const url = base + S.path;
  return (
    <Panel title="OBS overlay" actions={<Seg options={STYLES} value={style} onChange={setStyle} />}>
      <div className="ch-stage">
        <iframe key={style} title="Overlay preview" src={S.path + (S.path.includes('?') ? '&' : '?') + 'demo=1'} style={{ width: S.w, height: S.h }} />
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <code className="ch-url grow">{url}</code>
        <Button size="sm" variant="primary" icon="copy" onClick={() => copyText(url, 'Link copied — add it in OBS as a Browser Source')}>
          Copy link
        </Button>
      </div>
      <div className="faint small" style={{ marginTop: 6 }}>
        OBS: Browser Source, {S.w} × {S.h}. The preview shows sample numbers; the real overlay follows your count.
      </div>
      <div className="divider" />
      {style === 'text' ? (
        <>
          <div className="row">
            <Field label="Text before the number">
              <input value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} onBlur={() => label !== o.textLabel && save({ overlay: { textLabel: label } })} />
            </Field>
            <Field label="Colour">
              <input type="color" value={o.textColor || '#ffffff'} onChange={(e) => save({ overlay: { textColor: e.target.value } })} />
            </Field>
          </div>
          <div className="faint small">
            Uses Fortnite’s font, Burbank Big Condensed, when it’s installed on this PC (falls back to a bold condensed font). Shows your total if you set one above, otherwise every chest Steez has counted. Add <code>&amp;size=72</code> to the link for bigger text.
          </div>
        </>
      ) : (
        <>
      <div className="row">
        <Field label="Title">
          <input value={title} maxLength={24} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== o.title && save({ overlay: { title } })} />
        </Field>
        <Field label="Colour">
          <input type="color" value={o.accent} onChange={(e) => save({ overlay: { accent: e.target.value } })} />
        </Field>
      </div>
      <div className="check-row">
        {[
          ['showAvg', 'Average'],
          ['showBest', 'Best'],
          ['showLast', 'Last game'],
          ['showTotal', 'Your total'],
        ].map(([k, l]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={o[k]} onChange={(e) => save({ overlay: { [k]: e.target.checked } })} />
            <span>{l}</span>
          </label>
        ))}
      </div>
        </>
      )}
    </Panel>
  );
}

function Countdown({ to }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, []);
  let s = Math.max(0, Math.floor((new Date(to) - Date.now()) / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const pad = (x) => String(x).padStart(2, '0');
  return <span className="ch-mono">{(d ? d + 'd ' : '') + pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60)}</span>;
}

function TreasureCard({ st }) {
  const T = st.stats?.treasure;
  if (!T) return <Panel title="Treasure odds"><Empty>Turn the chest tracker on to see the odds.</Empty></Panel>;
  const hour = T.hour;
  return (
    <Panel title={T.week ? `Week ${T.week.number}: ${T.week.title}` : 'Treasure odds'}>
      {hour ? (
        <div className={`ch-hour ${hour.live ? 'live' : ''}`}>
          <div className="grow">
            <b>{hour.live ? 'Treasure Hour is live' : 'Next Treasure Hour'}</b>
            <div className="small">{hour.boosts.map((b) => `${b.label} ×${b.times}`).join(' · ')}</div>
          </div>
          <div className="ch-count">{hour.live ? <>ends in <Countdown to={hour.end} /></> : <Countdown to={hour.start} />}</div>
        </div>
      ) : (
        <div className="faint">The treasure hunt has ended.</div>
      )}
      <table className="ch-table">
        <thead>
          <tr>
            <th>Treasure</th>
            <th>Odds per chest</th>
            <th title={`Chance you’ve hit at least one by now, from your ${fmt(T.seasonChests)} chests this season`}>Your chance so far</th>
          </tr>
        </thead>
        <tbody>
          {T.odds.map((o) => (
            <tr key={o.kind}>
              <td>
                <b>{o.label}</b>
                <div className="faint small">{o.item}</div>
              </td>
              <td className={o.boosted ? 'ch-boost' : ''}>1 in {fmt(o.oneIn)}</td>
              <td>{pct(o.chance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function MatchesCard({ st }) {
  const rows = st.stats?.recent || [];
  return (
    <Panel title="Recent matches">
      {!rows.length ? (
        <Empty>No matches yet. Play a Battle Royale match, or press “Read new replays”.</Empty>
      ) : (
        <div className="ch-scroll">
          <table className="ch-table">
            <thead>
              <tr>
                <th>When</th>
                <th>You</th>
                <th>Squad (at least)</th>
                <th>Pulls</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="faint">{when(r.time)}</td>
                  <td>
                    <b>{r.you}</b>
                  </td>
                  <td className="small">{r.mates.length ? r.mates.map((m) => `${m.name} ${m.chests}`).join(', ') : <span className="faint">Solo</span>}</td>
                  <td className="small">{r.prizes.length ? r.prizes.map((p) => p.name).join(', ') : <span className="faint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function SquadCard({ st }) {
  const mates = st.stats?.mates?.season?.length ? st.stats.mates.season : st.stats?.mates?.all || [];
  const prizes = st.stats?.prizes || [];
  return (
    <Panel title="Squad & treasure pulls">
      <div className="faint small ch-h">Who you play with most</div>
      {mates.length ? (
        mates.map((m) => (
          <div key={m.name} className="row nowrap ch-line">
            <span className="grow">{m.name}</span>
            <span className="faint small">
              {m.matches} {m.matches === 1 ? 'game' : 'games'} · ≥ {fmt(m.chests)} chests
            </span>
          </div>
        ))
      ) : (
        <div className="faint small">No squad games yet.</div>
      )}
      <div className="faint small ch-h" style={{ marginTop: 14 }}>
        Treasure pulls
      </div>
      {prizes.length ? (
        prizes.slice(0, 8).map((p, i) => (
          <div key={i} className="row nowrap ch-line">
            <span className={`grow ${p.prize.token ? 'ch-boost' : ''}`}>{p.prize.name}</span>
            <span className="faint small">
              {p.prize.by} · {new Date(p.time).toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </span>
          </div>
        ))
      ) : (
        <div className="faint small">No treasure pulls seen yet.</div>
      )}
      <div className="faint small" style={{ marginTop: 10 }}>
        Squad counts are a minimum: a chest a teammate opens far from you isn’t in your replay.
      </div>
    </Panel>
  );
}

function SettingsCard({ st, save }) {
  const s = st.settings;
  const H = st.helper;
  return (
    <Panel title="Settings">
      <div className="grid2" style={{ marginBottom: 0 }}>
        <div>
          <Field label="Monitor Fortnite is on" help="The live counter reads the XP popup from this screen.">
            <select value={s.screenIndex} onChange={(e) => save({ screenIndex: Number(e.target.value) })}>
              <option value={-1}>Main monitor</option>
              {(H.screens || []).map((x) => (
                <option key={x.index} value={x.index}>
                  {x.name} ({x.width}×{x.height}){x.primary ? ' · main' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Toggle value={s.autoScan} onChange={(v) => save({ autoScan: v })} label="Read new replays when Steez starts" help="Fortnite keeps about 100 replays and deletes the oldest every few hours, so this catches matches before they disappear." />
          <Toggle value={s.chatCommand} onChange={(v) => save({ chatCommand: v })} label="!chests in chat" help="Viewers type !chests to see this match, your total and your average." />
        </div>
        <div>
          <Field label="Replay folder">
            <code className="ch-url">{H.demos || '—'}</code>
          </Field>
          <div className="faint small" style={{ marginBottom: 12 }}>
            {H.replays ? `${fmt(H.replays)} replays there right now.` : ''} Matches are kept by match id, so nothing counts twice, and your history lives on after Fortnite deletes the replay. Stats are shared with the standalone Chest Tracker app.
          </div>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (confirm('Delete every saved match and start over? Replays still in Fortnite’s folder can be read again; matches whose replay is gone are lost.')) act(() => call('POST', '/chests/api/reset'), 'Stats cleared');
            }}
          >
            Clear saved matches
          </Button>
        </div>
      </div>
    </Panel>
  );
}

const CSS = `
  .ch-big { font: 650 56px/1.05 var(--display); letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
  .ch-big.ch-off { color: var(--text-3); }
  .ch-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
  .ch-stats .stat { min-width: 0; }
  .ch-stage { display: grid; place-items: center; height: 220px; border-radius: 12px; border: 1px solid var(--line); overflow: hidden;
    background: radial-gradient(120% 90% at 85% 110%, #2b2350 0%, transparent 55%), radial-gradient(80% 70% at 10% 0%, #16324a 0%, transparent 60%), linear-gradient(180deg, #121426, #0b0c16); }
  .ch-stage iframe { border: 0; background: transparent; color-scheme: normal; }
  .ch-url { display: block; background: var(--bg-sunk); border: 1px solid var(--line); border-radius: 8px; padding: 6px 9px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11.5px; }
  .ch-hour { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--line-2); margin-bottom: 12px; }
  .ch-hour.live { background: rgba(242, 184, 75, 0.12); border-color: rgba(242, 184, 75, 0.5); }
  .ch-count { font: 650 20px/1 var(--display); }
  .ch-mono { font-variant-numeric: tabular-nums; }
  .ch-table td, .ch-table th { padding: 7px 10px; }
  .ch-boost { color: var(--warn); font-weight: 600; }
  .ch-scroll { max-height: 360px; overflow-y: auto; }
  .ch-h { font-weight: 600; margin-bottom: 4px; }
  .ch-line { padding: 5px 0; border-bottom: 1px solid var(--line); }
`;
