// TikTok Gifts: watches the streamer's TikTok LIVE for gifts — top gifters by diamonds, the
// biggest gift combo (and the one being tapped right now) — plus the OBS gifts overlay editor.
import { useEffect, useState } from 'react';
import { PageHeader, Panel, Button, Toggle, Tabs, Pill, Stat, Empty, Icon, toast } from '../../ui.jsx';
import { useQU, startQU, editStyle, resetStyle, editSettings, fmtNum } from './store.js';
import { Avatar, OverlayPreview, SliderCtl, ColorCtl, SwitchCtl, TextCtl, SelectCtl, SegCtl, FONT_OPTIONS, useConfirm } from './parts.jsx';
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
        ]}
        value={tab}
        onChange={(t) => {
          lastTab = t;
          setTab(t);
        }}
      />
      {tab === 'session' ? <SessionTab /> : <GiftsOverlayTab />}
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
      </div>
      <Leaderboard />
    </div>
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
