// TikTok Gifts: watches the streamer's TikTok LIVE for gifts — top gifters by diamonds, the
// biggest gift combo (and the one being tapped right now) — plus the OBS gifts overlay editor,
// and two small badges for the daily gaming rank and Gift Gallery progress.
import { useEffect, useState } from 'react';
import { PageHeader, Panel, Button, Toggle, Tabs, Pill, Stat, Empty, Icon, toast } from '../../ui.jsx';
import { useQU, startQU, editStyle, resetStyle, editSettings, fmtNum, editStats, resetStatsStyle, resetStats } from './store.js';
import { Avatar, OverlayPreview, Ctl, SliderCtl, ColorCtl, SwitchCtl, TextCtl, SelectCtl, SegCtl, FONT_OPTIONS, useConfirm } from './parts.jsx';
import './queue.css';

let lastTab = 'session';

export default function GiftsView() {
  useEffect(startQU, []);
  const [tab, setTab] = useState(lastTab);
  const [dialog, confirm] = useConfirm();

  const simulate = async () => {
    await window.hq.giftsSimulate();
    toast('Playing demo gifts — watch the preview');
  };
  const reset = async () => {
    const ok = await confirm({
      title: 'Reset the gift session?',
      message: 'Top gifters, the top streak and totals go back to zero. Do this at the start of a new stream.',
      confirmLabel: 'Reset session',
      danger: true,
    });
    if (!ok) return;
    const gifts = await window.hq.giftsReset();
    useQU.setState({ gifts });
  };

  return (
    <>
      <PageHeader title="TikTok Gifts" sub="Who's gifting the most on your TikTok LIVE and the biggest gift combo, with an overlay for OBS.">
        <Button icon="play" onClick={simulate} title="Play a short fake gift session to style the overlay">
          Preview with demo gifts
        </Button>
        <Button icon="refresh" onClick={reset}>
          Reset session
        </Button>
      </PageHeader>
      <Tabs
        tabs={[
          { id: 'session', label: 'Session' },
          { id: 'overlay', label: 'Overlay' },
          { id: 'stats', label: 'Ranking & Gallery' },
        ]}
        value={tab}
        onChange={(t) => {
          lastTab = t;
          setTab(t);
        }}
      />
      {tab === 'session' ? <SessionTab /> : tab === 'overlay' ? <GiftsOverlayTab /> : <StatsTab confirm={confirm} />}
      {dialog}
    </>
  );
}

/* ═══════════════════════════════ Session ═══════════════════════════════ */

function SessionTab() {
  const gifts = useQU((s) => s.gifts);
  return (
    <div className="qu-gifts-grid">
      <div>
        <ConnectionPanel />
        <StreakPanel />
        <Panel title="This session">
          <div className="row nowrap qu-stats">
            <Stat value={fmtNum(gifts?.totalDiamonds)} label="Diamonds" />
            <Stat value={fmtNum(gifts?.totalGifts)} label="Gifts" />
            <Stat value={fmtNum(gifts?.gifterCount)} label="Gifters" />
          </div>
        </Panel>
        <RankGalleryTiles />
      </div>
      <Leaderboard />
    </div>
  );
}

function RankGalleryTiles() {
  const d = useQU((s) => s.tiktokStats?.display);
  return (
    <Panel title="Ranking & Gallery">
      <div className="row nowrap qu-stats">
        <Stat value={d?.rank.text ?? '—'} label="Daily gaming rank" />
        <Stat value={d?.gallery.text ?? '—'} label="Gift Gallery" />
      </div>
    </Panel>
  );
}

const TT_STATUS = {
  live: { tone: 'good', text: (t) => `Live — watching @${t.username}` },
  connecting: { tone: 'warn', text: (t) => t.detail || 'Connecting…' },
  checking: { tone: 'warn', text: (t) => t.detail || 'Checking…' },
  waiting: { tone: 'warn', text: (t) => `Waiting for @${t.username} to go live` },
  error: { tone: 'bad', text: (t) => t.detail || 'Connection error' },
  idle: { tone: '', text: () => 'Not connected' },
};

function ConnectionPanel() {
  const tt = useQU((s) => s.tiktok) || { status: 'idle' };
  const saved = useQU((s) => s.settings.tiktokUsername);
  const autoConnect = useQU((s) => s.settings.tiktokAutoConnect);
  const [name, setName] = useState(saved || '');
  useEffect(() => {
    if (saved) setName((cur) => cur || saved);
  }, [saved]);

  const status = TT_STATUS[tt.status] || TT_STATUS.idle;
  const active = tt.status && tt.status !== 'idle';

  const connect = async () => {
    if (!name.trim()) return toast('Enter your TikTok username', { error: true });
    const res = await window.hq.tiktokConnect(name);
    if (!res?.ok) return toast('Enter your TikTok username', { error: true });
    setName(res.username);
    toast(`Watching @${res.username}`);
  };

  const sub =
    tt.status === 'live'
      ? 'Every gift on your LIVE is being tracked.'
      : tt.status === 'waiting'
        ? "Checks every 30s — leave it running and it picks up your stream automatically."
        : tt.status === 'error'
          ? null
          : 'No TikTok login or keys needed — just your username.';

  return (
    <Panel title="Your LIVE" actions={tt.status === 'live' && tt.viewers ? <span className="qu-count">{fmtNum(tt.viewers)} watching</span> : null}>
      <div className="row nowrap qu-at">
        <span className="qu-at-sign">@</span>
        <input value={name} placeholder="yourtiktok" spellCheck={false} autoComplete="off" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && connect()} />
        <Button variant="primary" onClick={connect}>
          {active ? 'Reconnect' : 'Connect'}
        </Button>
        <Button
          disabled={!active}
          onClick={async () => {
            const st = await window.hq.tiktokDisconnect();
            useQU.setState({ tiktok: st });
          }}
        >
          Disconnect
        </Button>
      </div>
      <div className="qu-tt-status">
        <Pill tone={status.tone}>{status.text(tt)}</Pill>
        {sub && <div className="help">{sub}</div>}
      </div>
      <div className="divider" />
      <Toggle label="Watch on launch" help="Reconnects to your username every time Steez starts." value={autoConnect !== false} onChange={(v) => editSettings({ tiktokAutoConnect: v })} />
    </Panel>
  );
}

function StreakPanel() {
  const gifts = useQU((s) => s.gifts);
  const live = gifts?.liveStreak;
  const s = live || gifts?.topStreak;
  return (
    <Panel title={live ? 'Combo in progress' : 'Top streak'} actions={live ? <Pill tone="live">LIVE</Pill> : null}>
      {!s ? (
        <div className="faint">No combos yet.</div>
      ) : (
        <div className="qu-streak">
          <Avatar url={s.giftImage} seed={s.giftName || s.login} letter={<Icon name="gift" size={18} />} size={44} />
          <div className="qu-main">
            <span className="qu-name">{s.name || s.login}</span>
            <span className="qu-meta">
              {s.giftName || 'Gift'} · ◆ {fmtNum(s.diamonds)}
            </span>
          </div>
          {/* Keyed on the count so each tap replays the bump. */}
          <b key={s.count} className="qu-streak-count">
            x{fmtNum(s.count)}
          </b>
        </div>
      )}
      {live && gifts?.topStreak && gifts.topStreak !== live && (
        <div className="help">
          Record: x{fmtNum(gifts.topStreak.count)} {gifts.topStreak.giftName} by {gifts.topStreak.name || gifts.topStreak.login}
        </div>
      )}
    </Panel>
  );
}

function Leaderboard() {
  const gifts = useQU((s) => s.gifts);
  const rows = gifts?.topGifters || [];
  const n = gifts?.gifterCount || 0;
  return (
    <Panel title="Top gifters" actions={<span className="qu-count">{`${fmtNum(n)} gifter${n === 1 ? '' : 's'}`}</span>}>
      {rows.length === 0 ? (
        <Empty>No gifts yet. Once you're live and connected, every gift shows up here and on the overlay.</Empty>
      ) : (
        <>
          <div className="qu-listhead qu-gl">
            <span>#</span>
            <span />
            <span>Gifter</span>
            <span>Gifts</span>
            <span>Diamonds</span>
          </div>
          {rows.map((g, i) => (
            <div key={g.login} className="qu-row qu-gl">
              <span className="qu-rank">{i + 1}</span>
              <Avatar url={g.avatar} seed={g.login} letter={(g.name || g.login || '?').charAt(0).toUpperCase()} />
              <span className="qu-main">
                <span className="qu-name nowrap-text">{g.name || g.login}</span>
                <span className="qu-meta">@{g.login}</span>
              </span>
              <span className="qu-num">{fmtNum(g.gifts)}</span>
              <span className="qu-num strong">◆ {fmtNum(g.diamonds)}</span>
            </div>
          ))}
        </>
      )}
    </Panel>
  );
}

/* ═══════════════════════════════ Overlay ═══════════════════════════════ */

function GiftsOverlayTab() {
  const ov = useQU((s) => s.giftOverlay);
  const path = useQU((s) => s.overlayPaths.gifts);
  const set = (key) => (value) => editStyle('giftOverlay', { [key]: value });
  if (!ov || !Object.keys(ov).length) return <div className="faint">Loading…</div>;

  const scale = Number(ov.scale) || 1;
  const obsW = Math.round(((Number(ov.width) || 420) + 24) * scale);
  const obsH = Math.round(430 * scale + 24);

  return (
    <div className="qu-editor">
      <div className="qu-controls">
        <Panel title="Content">
          <SegCtl
            label="Show"
            value={ov.mode}
            options={[
              { id: 'both', label: 'Both' },
              { id: 'streak', label: 'Top streak' },
              { id: 'gifter', label: 'Top gifter' },
            ]}
            onChange={set('mode')}
          />
          {ov.mode === 'both' && <SliderCtl label="Switch every" value={ov.rotateSeconds} min={3} max={30} unit="s" onChange={set('rotateSeconds')} />}
          <TextCtl label="Streak title" value={ov.streakTitle} maxLength={20} onChange={set('streakTitle')} />
          <TextCtl label="Gifter title" value={ov.gifterTitle} maxLength={20} onChange={set('gifterTitle')} />
          <TextCtl label="Empty message" value={ov.emptyText} maxLength={40} onChange={set('emptyText')} />
          <SwitchCtl label="Show title" value={ov.showTitle} onChange={set('showTitle')} />
          <SwitchCtl label="Jump to live combos" value={ov.showLiveStreak} onChange={set('showLiveStreak')} />
          <SwitchCtl label="Show gift name" value={ov.showGiftName} onChange={set('showGiftName')} />
          <SwitchCtl label="Show diamonds" value={ov.showDiamonds} onChange={set('showDiamonds')} />
          <SwitchCtl label="Gifter profile picture" value={ov.showAvatar} onChange={set('showAvatar')} />
        </Panel>
        <Panel title="Style">
          <ColorCtl label="Gold / streak" value={ov.accent} onChange={set('accent')} />
          <ColorCtl label="Secondary / gifter" value={ov.accent2} onChange={set('accent2')} />
          <ColorCtl label="Text" value={ov.textColor} onChange={set('textColor')} />
          <ColorCtl label="Card background" value={ov.bg} onChange={set('bg')} />
          <SliderCtl label="Background opacity" value={ov.bgOpacity} min={0} max={1} step={0.02} onChange={set('bgOpacity')} />
          <SliderCtl label="Corner radius" value={ov.radius} min={0} max={40} unit="px" onChange={set('radius')} />
          <SliderCtl label="Width" value={ov.width} min={300} max={700} step={10} unit="px" onChange={set('width')} />
          <SliderCtl label="Scale" value={ov.scale} min={0.6} max={2} step={0.05} unit="x" onChange={set('scale')} />
          <SelectCtl label="Font" value={ov.fontFamily} options={FONT_OPTIONS.slice(0, 6)} onChange={set('fontFamily')} />
        </Panel>
        <Panel title="Effects">
          <SwitchCtl label="Orbit ring" value={ov.ring} onChange={set('ring')} />
          <SwitchCtl label="Floating sparkles" value={ov.particles} onChange={set('particles')} />
          <SwitchCtl label="Glow" value={ov.glow} onChange={set('glow')} />
        </Panel>
      </div>
      <div className="qu-preview-col">
        <OverlayPreview path={path} width={obsW} height={obsH} onReset={() => resetStyle('giftOverlay').then(() => toast('Gift overlay style reset'))} />
        <div className="help">
          Shows the top streak and the top gifter, switching between them, and jumps to a combo while it's being tapped. Use <b>Preview with demo gifts</b> to see it move.
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════ Ranking & Gallery ═══════════════════════════ */

const SOURCE = {
  live: { tone: 'good', text: 'Live from TikTok' },
  gifts: { tone: 'warn', text: 'Counted from gifts' },
  manual: { tone: '', text: 'Manual' },
  none: { tone: '', text: 'No data yet' },
};

function fmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

const fmtScore = (v) => (/^\d+$/.test(String(v)) ? fmtNum(v) : String(v));

function StatsTab({ confirm }) {
  const ts = useQU((s) => s.tiktokStats);
  const paths = useQU((s) => s.overlayPaths);
  if (!ts || !ts.display) return <div className="faint">Loading…</div>;

  const reset = async () => {
    const ok = await confirm({
      title: 'Reset rank and gallery?',
      message: 'Forgets the rank, the latest notice and the Gift Gallery progress TikTok last sent. Manual values and the badge style stay.',
      confirmLabel: 'Reset',
      danger: true,
    });
    if (!ok) return;
    await resetStats();
    toast('Rank and gallery reset');
  };

  // The badge is 244px wide plus 8px of padding each side, scaled from the top left.
  const scale = Number(ts.style.scale) || 1;
  const obsW = Math.round(244 * scale + 16);
  const obsH = Math.round(94 * scale + 16);

  return (
    <div className="qu-editor">
      <div className="qu-controls">
        <RankPanel ts={ts} onReset={reset} />
        <GalleryPanel ts={ts} onReset={reset} />
        <StatsStylePanel style={ts.style} />
      </div>
      <div className="qu-preview-col">
        <OverlayPreview title="Rank badge" path={paths.tiktokRank} width={obsW} height={obsH} stageHeight={150} />
        <OverlayPreview title="Gallery badge" path={paths.tiktokGallery} width={obsW} height={obsH} stageHeight={150} />
      </div>
    </div>
  );
}

function ResetButton({ onClick }) {
  return (
    <Button size="sm" variant="ghost" icon="refresh" onClick={onClick} title="Forget the rank and gallery values TikTok last sent">
      Reset
    </Button>
  );
}

function RankPanel({ ts, onReset }) {
  const d = ts.display.rank;
  const r = ts.rank;
  const m = ts.manual;
  const src = SOURCE[d.source] || SOURCE.none;
  const meta = m.rankEnabled
    ? r.updatedAt
      ? `TikTok last sent ${r.value ? '#' + r.value : 'unranked'} at ${fmtWhen(r.updatedAt)}`
      : 'Nothing from TikTok yet'
    : r.updatedAt
      ? `Updated ${fmtWhen(r.updatedAt)}${d.score ? ` · score ${fmtScore(d.score)}` : ''}`
      : 'Waiting for TikTok to send your daily gaming rank';
  return (
    <Panel title="Daily gaming rank" actions={<ResetButton onClick={onReset} />}>
      <div className="qu-readout">
        {/* Keyed on the value so each change replays the bump. */}
        <b key={d.text} className={d.ranked ? '' : 'dim'}>
          {d.text}
        </b>
        <div className="qu-main">
          <span>
            <Pill tone={src.tone}>{src.text}</Pill>
          </span>
          <span className="qu-meta">{meta}</span>
        </div>
      </div>
      {r.notice && (
        <div className="qu-notice">
          <span className="qu-meta">Latest rank notice{r.noticeAt ? ` · ${fmtWhen(r.noticeAt)}` : ''}</span>
          <div>{r.notice}</div>
        </div>
      )}
      <div className="divider" />
      <SwitchCtl label="Set rank manually" value={m.rankEnabled} onChange={(v) => editStats('manual', { rankEnabled: v })} />
      {m.rankEnabled && (
        <Ctl label="Rank">
          <div className="row nowrap qu-rank-in">
            <span className="qu-at-sign">#</span>
            <input
              type="text"
              value={m.rankValue ?? ''}
              placeholder="12 or 99+"
              maxLength={7}
              spellCheck={false}
              onChange={(e) => editStats('manual', { rankValue: e.target.value.replace(/[^\d+]/g, '') })}
            />
          </div>
        </Ctl>
      )}
      <div className="help">TikTok moves you up the daily gaming list as gifts come in. In manual mode, leave the rank empty to show “{ts.style.unrankedText || 'Unranked'}”.</div>
    </Panel>
  );
}

function GalleryPanel({ ts, onReset }) {
  const d = ts.display.gallery;
  const g = ts.gallery;
  const m = ts.manual;
  const src = SOURCE[d.source] || SOURCE.none;
  const meta =
    d.source === 'manual'
      ? g.updatedAt
        ? `TikTok last sent ${g.collected}/${g.total} at ${fmtWhen(g.updatedAt)}`
        : 'Nothing from TikTok yet'
      : d.source === 'live'
        ? `Updated ${fmtWhen(g.updatedAt)}${g.endsAt ? ` · period ends ${fmtWhen(Number(g.endsAt))}` : ''}`
        : d.source === 'gifts'
          ? 'Gallery gifts received this session. The total appears once TikTok sends the gallery.'
          : 'Waiting for TikTok to send your Gift Gallery';

  const total = Number(m.galleryTotal) || 0;
  const collected = Number(m.galleryCollected) || 0;
  const step = (n) => {
    const next = Math.max(0, total > 0 ? Math.min(total, collected + n) : collected + n);
    if (next !== collected) editStats('manual', { galleryCollected: next });
  };

  return (
    <Panel title="Gift Gallery" actions={<ResetButton onClick={onReset} />}>
      <div className="qu-readout">
        <b key={d.collected} className={d.source === 'none' ? 'dim' : ''}>
          {d.text}
        </b>
        <div className="qu-main">
          <span>
            <Pill tone={src.tone}>{src.text}</Pill>
          </span>
          <span className="qu-meta">{meta}</span>
        </div>
      </div>
      {d.total > 0 && (
        <div className="qu-meter">
          <i style={{ width: `${Math.round(d.ratio * 100)}%` }} />
        </div>
      )}
      <div className="divider" />
      <SwitchCtl label="Set progress manually" value={m.galleryEnabled} onChange={(v) => editStats('manual', { galleryEnabled: v })} />
      {m.galleryEnabled && (
        <>
          <Ctl label="Collected">
            <div className="row nowrap qu-stepper">
              <Button className="icon" title="One fewer" disabled={collected <= 0} onClick={() => step(-1)}>
                −
              </Button>
              <b>{collected}</b>
              <Button className="icon" title="One more" disabled={total > 0 && collected >= total} onClick={() => step(1)}>
                +
              </Button>
            </div>
          </Ctl>
          <Ctl label="Gallery size">
            <input
              type="number"
              min={0}
              max={999}
              value={total}
              onChange={(e) => editStats('manual', { galleryTotal: Math.max(0, Math.min(999, parseInt(e.target.value, 10) || 0)) })}
            />
          </Ctl>
        </>
      )}
      <div className="help">Gallery gifts light up when a viewer sends them. Manual mode is handy before TikTok has sent the gallery.</div>
    </Panel>
  );
}

function StatsStylePanel({ style }) {
  const set = (key) => (value) => editStats('style', { [key]: value });
  return (
    <Panel
      title="Badge style"
      actions={
        <Button size="sm" variant="ghost" onClick={() => resetStatsStyle().then(() => toast('Badge style reset'))}>
          Reset style
        </Button>
      }
    >
      <SwitchCtl label="Show label" value={style.showLabel} onChange={set('showLabel')} />
      <TextCtl label="Rank label" value={style.rankLabel} maxLength={24} onChange={set('rankLabel')} />
      <TextCtl label="Gallery label" value={style.galleryLabel} maxLength={24} onChange={set('galleryLabel')} />
      <TextCtl label="Not ranked text" value={style.unrankedText} maxLength={16} onChange={set('unrankedText')} />
      <SwitchCtl label="Show rank score" value={style.showScore} onChange={set('showScore')} />
      <SwitchCtl label="Gallery progress bar" value={style.showBar} onChange={set('showBar')} />
      <ColorCtl label="Accent" value={style.accent} onChange={set('accent')} />
      <ColorCtl label="Text" value={style.textColor} onChange={set('textColor')} />
      <ColorCtl label="Background" value={style.bg} onChange={set('bg')} />
      <SliderCtl label="Background opacity" value={style.bgOpacity} min={0} max={1} step={0.02} onChange={set('bgOpacity')} />
      <SliderCtl label="Scale" value={style.scale} min={0.6} max={2.5} step={0.05} unit="x" onChange={set('scale')} />
      <div className="help">Applies to both badges. OBS size at 1x: 260 × 110.</div>
    </Panel>
  );
}
