// Viewer Queue: a Party (host + N viewers) and a Queue filled from Twitch chat, with
// drag-and-drop, live wait timers, the OBS queue overlay editor and the queue rules.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PageHeader, Panel, Button, Toggle, Field, Tabs, Pill, Empty, Icon, toast } from '../../ui.jsx';
import { useQU, startQU, editStyle, resetStyle, editSettings, clearLog, onBeforeListChange, useNow, fmtWait } from './store.js';
import { Avatar, DraftInput, OverlayPreview, SliderCtl, ColorCtl, SwitchCtl, TextCtl, SelectCtl, SegCtl, FONT_OPTIONS, useConfirm } from './parts.jsx';
import './queue.css';

const WARM_MS = 10 * 60000; // amber after 10 minutes in line
const HOT_MS = 25 * 60000; // red after 25

let lastTab = 'queue'; // remembered while the page is unmounted

export default function QueueView() {
  useEffect(startQU, []);
  const [tab, setTab] = useState(lastTab);
  const [dialog, confirm] = useConfirm();
  const addRef = useRef(null);
  const settings = useQU((s) => s.settings);
  const queueLen = useQU((s) => s.queue.length);

  const switchTab = (t) => {
    lastTab = t;
    setTab(t);
  };

  // Ctrl+K jumps to the manual add box from anywhere on this page.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        switchTab('queue');
        requestAnimationFrame(() => addRef.current?.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const join = settings.joinCommand || '!join';
  const leave = settings.leaveCommand || '!dequeue';

  return (
    <>
      <PageHeader
        title="Viewer Queue"
        sub={
          <>
            Viewers join with <code>{join}</code> and leave with <code>{leave}</code>
            {settings.subsPriority ? ' · subs skip the line' : ''}
          </>
        }
      >
        <label className="row nowrap qu-open">
          <Toggle value={settings.queueOpen !== false} onChange={(v) => editSettings({ queueOpen: v })} />
          <span>{settings.queueOpen !== false ? 'Queue open' : 'Queue closed'}</span>
        </label>
      </PageHeader>
      <Tabs
        tabs={[
          { id: 'queue', label: `Queue${queueLen ? ` (${queueLen})` : ''}` },
          { id: 'overlay', label: 'Overlay' },
          { id: 'rules', label: 'Rules' },
        ]}
        value={tab}
        onChange={switchTab}
      />
      {tab === 'queue' && <QueueTab addRef={addRef} confirm={confirm} />}
      {tab === 'overlay' && <OverlayTab />}
      {tab === 'rules' && <RulesTab confirm={confirm} />}
      {dialog}
    </>
  );
}

/* ═══════════════════════════════ Queue tab ═══════════════════════════════ */

function QueueTab({ addRef, confirm }) {
  const party = useQU((s) => s.party);
  const queue = useQU((s) => s.queue);
  const settings = useQU((s) => s.settings);
  const cap = Math.max(1, Number(settings.partySize) || 3);

  const zones = { party: useRef(null), queue: useRef(null) };
  const lists = { party: useRef(null), queue: useRef(null) };
  const drag = useRef(null);
  const [dragId, setDragId] = useState(null);
  const [drop, setDrop] = useState(null); // { list, index } while dragging over a list
  useFlip(party, queue);

  /* ── manual add ── */
  const [name, setName] = useState('');
  const add = async () => {
    const n = name.trim();
    if (!n) return;
    const res = await window.hq.addUser(n);
    if (res?.ok) {
      setName('');
      toast(`${n} added to the queue`);
    } else if (res?.reason === 'already') toast(`${n} is already #${res.position}`, { error: true });
    else if (res?.reason === 'in_party') toast(`${n} is already in the party`, { error: true });
    addRef.current?.focus();
  };

  const fill = async () => {
    const n = await window.hq.fillParty();
    toast(n ? `Pulled ${n} player${n > 1 ? 's' : ''} into the party` : 'Party is already full');
  };
  const next = async () => {
    const n = await window.hq.nextGame();
    toast(n ? `New party — ${n} player${n > 1 ? 's' : ''} in` : 'Party cleared, queue is empty');
  };
  const clearQueue = async () => {
    if (!queue.length) return;
    const ok = await confirm({
      title: 'Clear the whole queue?',
      message: `${queue.length} waiting player${queue.length > 1 ? 's' : ''} will be removed.`,
      confirmLabel: 'Clear queue',
      danger: true,
    });
    if (ok) window.hq.clear('queue');
  };

  /* ── drag & drop (pointer events, so it works with the same feel everywhere) ── */
  const zoneAt = (x, y) => {
    for (const list of ['party', 'queue']) {
      const r = zones[list].current?.getBoundingClientRect();
      if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return list;
    }
    return null;
  };

  const onPointerDown = (e, entry, list) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const row = e.currentTarget;
    drag.current = { id: entry.id, from: list, row, startX: e.clientX, startY: e.clientY, active: false, target: null };

    const move = (ev) => {
      const d = drag.current;
      if (!d) return;
      if (!d.active) {
        if (Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < 5) return;
        // Start dragging: a floating copy of the row follows the pointer.
        const rect = d.row.getBoundingClientRect();
        const ghost = d.row.cloneNode(true);
        ghost.classList.add('qu-ghost');
        ghost.style.width = rect.width + 'px';
        document.body.appendChild(ghost);
        Object.assign(d, { active: true, ghost, grabX: rect.left - d.startX, grabY: rect.top - d.startY });
        setDragId(d.id);
      }
      d.ghost.style.left = d.grabX + ev.clientX + 'px';
      d.ghost.style.top = d.grabY + ev.clientY + 'px';

      const over = zoneAt(ev.clientX, ev.clientY);
      let target = null;
      if (over) {
        const rows = [...lists[over].current.querySelectorAll('.qu-row[data-id]')].filter((r) => r.dataset.id !== d.id);
        let index = rows.length;
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i].getBoundingClientRect();
          if (ev.clientY < r.top + r.height / 2) {
            index = i;
            break;
          }
        }
        target = { list: over, index };
      }
      if (target?.list !== d.target?.list || target?.index !== d.target?.index) {
        d.target = target;
        setDrop(target);
      }
    };

    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      d.ghost?.remove();
      setDragId(null);
      setDrop(null);
      if (!d.active || !d.target) return;
      const st = useQU.getState();
      const partyCap = Math.max(1, Number(st.settings.partySize) || 3);
      if (d.target.list === 'party' && d.from !== 'party' && st.party.length >= partyCap) {
        toast('Party is full — the last member went back to the queue');
      }
      window.hq.move(d.id, d.target.list, d.target.index);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  /** Rows for one list, with the drop marker slotted in where the dragged player would land. */
  const renderRows = (entries, list) => {
    const out = [];
    let shown = 0;
    entries.forEach((entry, i) => {
      if (drop?.list === list && drop.index === shown && entry.id !== dragId) out.push(<div key="drop" className="qu-dropline" />);
      if (entry.id !== dragId) shown++;
      out.push(<PlayerRow key={entry.id} entry={entry} list={list} rank={list === 'party' ? i + 2 : i + 1} dragging={entry.id === dragId} onPointerDown={(e) => onPointerDown(e, entry, list)} />);
    });
    if (drop?.list === list && drop.index >= shown) out.push(<div key="drop" className="qu-dropline" />);
    return out;
  };

  const openSlots = [];
  for (let i = party.length; i < cap; i++) {
    openSlots.push(
      <div key={'slot' + i} className="qu-slot">
        <span className="qu-rank">{i + 2}</span>
        <span>Open slot — drag a player here</span>
      </div>,
    );
  }

  return (
    <>
      <div className="qu-toolbar">
        <div className="row nowrap qu-add">
          <input
            ref={addRef}
            value={name}
            placeholder="Add a player manually"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <span className="kbd">Ctrl K</span>
          <Button icon="plus" onClick={add}>
            Add
          </Button>
        </div>
        <Button icon="users" onClick={fill} title="Pull the next players into open party slots">
          Fill Party
        </Button>
        <Button variant="primary" icon="next" onClick={next} title="Clear the party and pull the next group in">
          Next Game
        </Button>
        <div className="right">
          <TwitchLine />
        </div>
      </div>

      <div className="qu-grid">
        <div className="qu-col">
          <div ref={zones.party} className={`qu-zone ${drop?.list === 'party' ? 'over' : ''}`}>
            <Panel title="Party" actions={<span className="qu-count">{party.length + 1}/{cap + 1}</span>}>
              <div className="qu-row qu-host">
                <span className="qu-rank">1</span>
                <span className="qu-av qu-host-av">
                  <Icon name="trophy" size={14} />
                </span>
                <span className="qu-main">
                  <span className="qu-name">{settings.hostName || 'You'}</span>
                  <span className="qu-meta">Host</span>
                </span>
                <span className="tag">HOST</span>
              </div>
              <div ref={lists.party} className="qu-list">
                {renderRows(party, 'party')}
                {openSlots}
              </div>
            </Panel>
          </div>
          <ActivityPanel />
        </div>

        <div ref={zones.queue} className={`qu-zone ${drop?.list === 'queue' ? 'over' : ''}`}>
          <Panel
            title="Queue"
            className="qu-queue-panel"
            actions={
              <>
                <span className="qu-count">{queue.length === 1 ? '1 waiting' : `${queue.length} waiting`}</span>
                <Button size="sm" variant="ghost" icon="trash" onClick={clearQueue} disabled={!queue.length}>
                  Clear
                </Button>
              </>
            }
          >
            <div className="qu-listhead">
              <span>#</span>
              <span />
              <span>Player</span>
              <span>Waiting</span>
              <span />
            </div>
            <div ref={lists.queue} className="qu-list">
              {renderRows(queue, 'queue')}
            </div>
            {!queue.length && (
              <Empty>
                Nobody in the queue yet. Viewers typing <code>{settings.joinCommand || '!join'}</code> in chat show up here.
              </Empty>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function PlayerRow({ entry, list, rank, dragging, onPointerDown }) {
  const since = list === 'party' ? entry.partySince || entry.joinedAt : entry.joinedAt;
  return (
    <div className={`qu-row ${dragging ? 'qu-dragsrc' : ''}`} data-id={entry.id} onPointerDown={onPointerDown}>
      <span className="qu-rank">{rank}</span>
      <Avatar url={entry.avatar} seed={entry.login} letter={(entry.display || entry.login || '?').charAt(0).toUpperCase()} />
      <span className="qu-main">
        <span className="qu-name">
          <span className="nowrap-text">{entry.display}</span>
          {entry.isSub && <span className="qu-badge sub">SUB</span>}
          {entry.isMod && <span className="qu-badge">MOD</span>}
          {entry.isVip && <span className="qu-badge">VIP</span>}
        </span>
        <span className="qu-meta">{list === 'party' ? 'In party' : entry.source === 'manual' ? 'Added by you' : 'Joined from chat'}</span>
      </span>
      <WaitTimer since={since} colored={list === 'queue'} />
      <span className="qu-actions">
        {list === 'queue' ? (
          <button className="icon ghost" title="Move into party" onClick={() => window.hq.promote(entry.id)}>
            <Icon name="up" />
          </button>
        ) : (
          <button className="icon ghost" title="Send back to the queue" onClick={() => window.hq.move(entry.id, 'queue', 0)}>
            <Icon name="down" />
          </button>
        )}
        <button className="icon ghost qu-rm" title="Remove" onClick={() => window.hq.remove(entry.id)}>
          <Icon name="x" />
        </button>
      </span>
    </div>
  );
}

function WaitTimer({ since, colored }) {
  const now = useNow();
  const ms = now - Number(since || now);
  const heat = !colored ? '' : ms > HOT_MS ? 'hot' : ms > WARM_MS ? 'warm' : '';
  return <span className={`qu-timer ${heat}`}>{fmtWait(ms)}</span>;
}

/**
 * Animates rows to their new place when the lists change (FLIP): positions are captured
 * just before new state lands, then each moved row slides from its old spot.
 */
function useFlip(party, queue) {
  const before = useRef(null);
  useEffect(
    () =>
      onBeforeListChange(() => {
        const rects = new Map();
        document.querySelectorAll('.qu-list .qu-row[data-id]').forEach((el) => rects.set(el.dataset.id, el.getBoundingClientRect()));
        before.current = rects;
      }),
    [],
  );
  useLayoutEffect(() => {
    const rects = before.current;
    before.current = null;
    if (!rects) return;
    document.querySelectorAll('.qu-list .qu-row[data-id]').forEach((el) => {
      const prev = rects.get(el.dataset.id);
      if (!prev) return;
      const now = el.getBoundingClientRect();
      const dx = prev.left - now.left;
      const dy = prev.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.3,1)' });
    });
  }, [party, queue]);
}

/** Shared Twitch connection status — chat comes from the Steez bot connection. */
function TwitchLine() {
  const t = useQU((s) => s.twitch);
  const join = useQU((s) => s.settings.joinCommand) || '!join';
  const login = () => window.steez.twitch.login().catch((e) => toast(e?.message || 'Twitch login failed', { error: true }));
  if (t?.expired) {
    return (
      <span className="row nowrap">
        <Pill tone="bad">Twitch login expired</Pill>
        <Button size="sm" onClick={login}>
          Log in again
        </Button>
      </span>
    );
  }
  if (!t?.loggedIn) {
    return (
      <span className="row nowrap">
        <Pill>Twitch not connected</Pill>
        <Button size="sm" onClick={login}>
          Log in with Twitch
        </Button>
      </span>
    );
  }
  if (!t.connected) return <Pill tone="warn">Connecting to chat…</Pill>;
  return (
    <Pill tone="good">
      Watching #{t.channel} for {join}
    </Pill>
  );
}

function ActivityPanel() {
  const logs = useQU((s) => s.logs);
  return (
    <Panel
      title="Activity"
      actions={
        <Button size="sm" variant="ghost" onClick={clearLog} disabled={!logs.length}>
          Clear
        </Button>
      }
    >
      <div className="qu-log">
        {logs.length === 0 && <div className="faint small">Nothing yet.</div>}
        {logs.slice(0, 80).map((l, i) => {
          const d = new Date(l.ts || Date.now());
          return (
            <div key={`${l.ts}-${i}`} className={`qu-log-item ${l.type}`}>
              <span className="mono faint">
                {String(d.getHours()).padStart(2, '0')}:{String(d.getMinutes()).padStart(2, '0')}
              </span>
              <span>{l.text}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* ═══════════════════════════════ Overlay tab ═══════════════════════════════ */

function OverlayTab() {
  const ov = useQU((s) => s.overlay);
  const path = useQU((s) => s.overlayPaths.queue);
  const set = (key) => (value) => editStyle('overlay', { [key]: value });
  if (!ov || !Object.keys(ov).length) return <div className="faint">Loading…</div>;

  // What OBS needs to fit every row without clipping.
  const obsW = Math.round(((Number(ov.width) || 420) + 40) * (Number(ov.scale) || 1));
  const obsH = Math.round(((Number(ov.maxRows) || 5) * (64 + (Number(ov.gap) || 0)) + (ov.showTitle ? 60 : 0) + 40) * (Number(ov.scale) || 1));

  return (
    <div className="qu-editor">
      <div className="qu-controls">
        <Panel title="Content">
          <TextCtl label="Header text" value={ov.title} maxLength={28} onChange={set('title')} />
          <SwitchCtl label="Show header" value={ov.showTitle} onChange={set('showTitle')} />
          <SwitchCtl label="Show total waiting" value={ov.showHeaderCount} onChange={set('showHeaderCount')} />
          <SliderCtl label="Players shown" value={ov.maxRows} min={1} max={12} onChange={set('maxRows')} />
          <TextCtl label="Empty message" value={ov.emptyText} maxLength={48} onChange={set('emptyText')} />
        </Panel>
        <Panel title="Layout">
          <SegCtl
            label="Row style"
            value={ov.style}
            options={[
              { id: 'cards', label: 'Cards' },
              { id: 'bars', label: 'Bars' },
              { id: 'minimal', label: 'Minimal' },
            ]}
            onChange={set('style')}
          />
          <SegCtl
            label="Stack direction"
            value={ov.direction}
            options={[
              { id: 'down', label: 'Top down' },
              { id: 'up', label: 'Bottom up' },
            ]}
            onChange={set('direction')}
          />
          <SegCtl
            label="Align"
            value={ov.align}
            options={[
              { id: 'left', label: 'Left' },
              { id: 'right', label: 'Right' },
            ]}
            onChange={set('align')}
          />
          <SliderCtl label="Width" value={ov.width} min={260} max={700} step={10} unit="px" onChange={set('width')} />
          <SliderCtl label="Scale" value={ov.scale} min={0.6} max={2} step={0.05} unit="x" onChange={set('scale')} />
          <SliderCtl label="Row spacing" value={ov.gap} min={0} max={28} unit="px" onChange={set('gap')} />
          <SliderCtl label="Corner radius" value={ov.radius} min={0} max={30} unit="px" onChange={set('radius')} />
        </Panel>
        <Panel title="Style">
          <ColorCtl label="Accent" value={ov.accent} onChange={set('accent')} />
          <ColorCtl label="Secondary" value={ov.accent2} onChange={set('accent2')} />
          <ColorCtl label="Text" value={ov.textColor} onChange={set('textColor')} />
          <ColorCtl label="Row background" value={ov.rowBg} onChange={set('rowBg')} />
          <SliderCtl label="Row opacity" value={ov.rowOpacity} min={0} max={1} step={0.02} onChange={set('rowOpacity')} />
          <SelectCtl label="Font" value={ov.fontFamily} options={FONT_OPTIONS} onChange={set('fontFamily')} />
          <SliderCtl label="Font weight" value={ov.fontWeight} min={400} max={900} step={100} onChange={set('fontWeight')} />
        </Panel>
        <Panel title="Elements">
          <SwitchCtl label="Position numbers" value={ov.showRank} onChange={set('showRank')} />
          <SwitchCtl label="Avatars" value={ov.showAvatar} onChange={set('showAvatar')} />
          <SwitchCtl label="Wait timers" value={ov.showTimer} onChange={set('showTimer')} />
          <SwitchCtl label="Highlight first player" value={ov.highlightFirst} onChange={set('highlightFirst')} />
        </Panel>
        <Panel title="Effects">
          <SwitchCtl label="Glow" value={ov.glow} onChange={set('glow')} />
          <SwitchCtl label="Shimmer sweep" value={ov.shimmer} onChange={set('shimmer')} />
          <SliderCtl label="Animation speed" value={ov.animSpeed} min={0.4} max={2} step={0.1} unit="x" onChange={set('animSpeed')} />
        </Panel>
      </div>
      <div className="qu-preview-col">
        <OverlayPreview
          path={path}
          width={obsW}
          height={obsH}
          onReset={() => resetStyle('overlay').then(() => toast('Overlay style reset'))}
        />
        <div className="help">The overlay shows the queue only — anyone you pull into the party leaves it automatically.</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════ Rules tab ═══════════════════════════════ */

function RulesTab({ confirm }) {
  const s = useQU((st) => st.settings);
  const set = (key) => (value) => editSettings({ [key]: value });

  const clear = async (which) => {
    const copy = {
      party: ['Clear the party?', 'Everyone in the party is removed (they do not go back to the queue).', 'Clear party'],
      queue: ['Clear the queue?', 'Everyone waiting is removed.', 'Clear queue'],
      all: ['Clear everything?', 'Both the party and the queue will be emptied.', 'Clear everything'],
    }[which];
    if (await confirm({ title: copy[0], message: copy[1], confirmLabel: copy[2], danger: true })) window.hq.clear(which);
  };

  return (
    <div className="grid2">
      <div>
        <Panel title="Party & queue">
          <div className="grid2 qu-fields">
            <Field label="Party size (viewers, not counting you)">
              <DraftInput type="number" min={1} max={20} value={String(s.partySize ?? 3)} onCommit={(v) => editSettings({ partySize: Math.min(20, Math.max(1, parseInt(v, 10) || 1)) })} />
            </Field>
            <Field label="Your name in the party">
              <DraftInput maxLength={24} value={s.hostName ?? ''} onCommit={(v) => editSettings({ hostName: v.trim() || 'You' })} />
            </Field>
          </div>
          <Toggle label="Queue is open" help="When closed, the join command is refused (with a reply, if replies are on)." value={s.queueOpen !== false} onChange={set('queueOpen')} />
          <Toggle label="Subscribers skip ahead of non-subs" help="A sub who joins goes behind the subs already waiting, so it stays fair within each tier." value={!!s.subsPriority} onChange={set('subsPriority')} />
          <Toggle label="Allow duplicates" help="Lets the same viewer be in the queue more than once." value={!!s.allowDuplicates} onChange={set('allowDuplicates')} />
        </Panel>
        <Panel title="Clear">
          <div className="row">
            <Button onClick={() => clear('party')}>Clear party</Button>
            <Button onClick={() => clear('queue')}>Clear queue</Button>
            <Button className="danger" onClick={() => clear('all')}>
              Clear everything
            </Button>
          </div>
        </Panel>
      </div>
      <div>
        <Panel title="Chat commands">
          <div className="grid3 qu-fields">
            <Field label="Join">
              <DraftInput value={s.joinCommand ?? ''} spellCheck={false} onCommit={(v) => editSettings({ joinCommand: v.trim() || '!join' })} />
            </Field>
            <Field label="Leave">
              <DraftInput value={s.leaveCommand ?? ''} spellCheck={false} onCommit={(v) => editSettings({ leaveCommand: v.trim() || '!dequeue' })} />
            </Field>
            <Field label="Post the queue">
              <DraftInput value={s.listCommand ?? ''} spellCheck={false} onCommit={(v) => editSettings({ listCommand: v.trim() || '!queue' })} />
            </Field>
          </div>
          <Toggle
            label="Reply in chat"
            help="Confirms joins and leaves and posts the queue list, from the Steez bot account. The list command posts at most once every 8 seconds."
            value={!!s.botReplies}
            onChange={set('botReplies')}
          />
          <div className="divider" />
          <div className="row">
            <TwitchLine />
            <span className="right">
              <Button size="sm" variant="ghost" icon="cog" onClick={() => (location.hash = 'settings')}>
                Twitch settings
              </Button>
            </span>
          </div>
        </Panel>
      </div>
    </div>
  );
}
