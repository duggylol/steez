// Style editor for the three TikTok overlays (gifts card, rank badge, Gift Gallery badge).
// A preset gallery with live thumbnails on top, then grouped controls (Colours, Typography,
// Shape, Content, Animation) beside a live preview. Presets come from the main process
// (widgetStyles.cjs); every control is a tweak on top of the picked preset.
import { useRef, useState } from 'react';
import { Panel, Button, Pill, Seg, toast } from '../../ui.jsx';
import { useQU, editWidget, pickPreset, matchAllWidgets, resetWidget, modifiedKeys, widgetStyleOf } from './store.js';
import { OverlayPreview, SliderCtl, ColorCtl, SwitchCtl, TextCtl, SelectCtl, SegCtl } from './parts.jsx';

/** Per widget: overlay path, preview button, thumbnail frame size (unscaled) and scale. */
export const WIDGETS = [
  { id: 'gifts', label: 'Gifts overlay', pathKey: 'gifts', demo: 'Play combo', thumb: { w: 444, h: 440, s: 0.34 } },
  { id: 'rank', label: 'Rank badge', pathKey: 'tiktokRank', demo: 'Play rank change', thumb: { w: 262, h: 116, s: 0.6 } },
  { id: 'gallery', label: 'Gallery badge', pathKey: 'tiktokGallery', demo: 'Play gallery +1', thumb: { w: 262, h: 116, s: 0.6 } },
];

const WEIGHT_LABELS = { 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' };
const WIDTH_RANGE = { gifts: [300, 700], rank: [160, 480], gallery: [160, 480] };

export function WidgetStyleEditor({ widget, confirm }) {
  const meta = WIDGETS.find((w) => w.id === widget) || WIDGETS[0];
  const style = useQU((s) => widgetStyleOf(s, widget));
  const kit = useQU((s) => s.widgetKit);
  const path = useQU((s) => s.overlayPaths[meta.pathKey]);
  const sample = useQU((s) => showingSample(s, widget));

  if (!style || !kit) return <div className="faint">Loading…</div>;

  const set = (key) => (value) => editWidget(widget, { [key]: value });
  const modified = modifiedKeys(widget, style);
  const current = kit.presets.find((p) => p.id === style.preset);

  const matchAll = async () => {
    const ok = await confirm({
      title: `Use ${current?.name || 'this preset'} on all three?`,
      message: 'The gifts overlay, rank badge and gallery badge all switch to this preset. Their colours, fonts and animation go back to the preset; labels, sizes and toggles stay.',
      confirmLabel: 'Use on all three',
    });
    if (!ok) return;
    await matchAllWidgets(style.preset);
    toast(`All three widgets now use ${current?.name || 'the same preset'}`);
  };

  const resetAll = async () => {
    const ok = await confirm({
      title: `Reset the ${meta.label.toLowerCase()}?`,
      message: 'Everything goes back to the defaults: preset, colours, labels, toggles, size and animation.',
      confirmLabel: 'Reset',
      danger: true,
    });
    if (!ok) return;
    await resetWidget(widget);
    toast(`${meta.label} reset`);
  };

  return (
    <>
      <Panel
        title="Preset"
        actions={
          <>
            {modified.length > 0 && <Pill tone="warn">Modified</Pill>}
            <Button size="sm" variant="ghost" icon="refresh" disabled={!modified.length} onClick={() => pickPreset(widget).then(() => toast(`Back to ${current?.name || 'the preset'}`))} title="Undo your colour, font, shape and animation tweaks">
              Reset to preset
            </Button>
            <Button size="sm" onClick={matchAll} title="Put the other two widgets on this preset too">
              Use on all three
            </Button>
          </>
        }
      >
        <PresetGallery widget={widget} meta={meta} path={path} active={style.preset} modified={modified.length > 0} presets={kit.presets} />
      </Panel>

      <div className="qu-editor">
        <div className="qu-controls">
          <ColoursPanel style={style} set={set} widget={widget} />
          <TypographyPanel style={style} set={set} kit={kit} />
          <ShapePanel style={style} set={set} widget={widget} />
          <ContentPanel style={style} set={set} widget={widget} />
          <AnimationPanel style={style} set={set} kit={kit} widget={widget} />
        </div>
        <div className="qu-preview-col">
          <OverlayPreview key={widget} title={`${meta.label} preview`} path={path} query="?editor=1" demoLabel={meta.demo} width={fallbackW(style, widget)} height={fallbackH(style, widget, current)} onReset={resetAll} stageHeight={widget === 'gifts' ? 520 : 200}>
            <div className="help">
              {sample ? 'Showing sample numbers until TikTok sends real ones — OBS shows the real ones. ' : ''}
              <b>{meta.demo}</b> plays a fake update here only; your stream never sees it.
            </div>
          </OverlayPreview>
        </div>
      </div>
    </>
  );
}

/** Suggested OBS size before the preview has reported its real one. */
function fallbackW(style, widget) {
  const pad = widget === 'gifts' ? 24 : 16;
  return Math.round((Number(style.width) || (widget === 'gifts' ? 420 : 244)) * (Number(style.scale) || 1) + pad);
}
function fallbackH(style, widget, preset) {
  const scale = Number(style.scale) || 1;
  if (widget === 'gifts') return Math.round((preset?.layout === 'row' ? 180 : 430) * scale + 24);
  return Math.round(94 * scale + 16);
}

function showingSample(s, widget) {
  if (widget === 'gifts') return !s.gifts || (!s.gifts.topStreak && !(s.gifts.topGifters || []).length && !s.gifts.liveStreak);
  const d = s.tiktokStats?.display?.[widget];
  return !d || d.source === 'none';
}

/* ─────────────────────────── preset gallery ─────────────────────────── */

function PresetGallery({ widget, meta, path, active, modified, presets }) {
  const base = useQU((s) => s.baseUrl);
  return (
    <div className="qu-presets-wrap">
      <div className="qu-presets">
      {presets.map((p) => (
        <PresetTile key={widget + p.id} preset={p} widget={widget} thumb={widget === 'gifts' && p.layout === 'row' ? { ...meta.thumb, h: 220 } : meta.thumb} src={base ? `${base}${path}?preset=${p.id}` : ''} active={p.id === active} modified={modified} />
      ))}
      </div>
    </div>
  );
}

function PresetTile({ preset, widget, thumb, src, active, modified }) {
  const frame = useRef(null);
  const [busy, setBusy] = useState(false);
  const play = () => frame.current?.contentWindow?.postMessage({ type: 'steez:demo' }, '*');
  const pick = async () => {
    if (busy) return;
    if (active && !modified) return play();
    setBusy(true);
    try {
      await pickPreset(widget, preset.id);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className={`qu-preset${active ? ' active' : ''}`} onClick={pick} onMouseEnter={play} title={`${preset.name} — ${preset.tagline}`} aria-pressed={active}>
      <span className="qu-preset-thumb">
        {active && <span className="qu-preset-on">{modified ? 'Modified' : 'In use'}</span>}
        <span className="qu-preset-frame" style={{ width: Math.round(thumb.w * thumb.s), height: Math.round(thumb.h * thumb.s) }}>
          {src && <iframe ref={frame} src={src} loading="lazy" tabIndex={-1} title={`${preset.name} thumbnail`} style={{ width: thumb.w, height: thumb.h, transform: `scale(${thumb.s})` }} />}
        </span>
      </span>
      <span className="qu-preset-meta">
        <span className="qu-preset-name">{preset.name}</span>
        <span className="qu-preset-tag">{preset.tagline}</span>
      </span>
    </button>
  );
}

/* ─────────────────────────── control groups ─────────────────────────── */

function ColoursPanel({ style, set, widget }) {
  return (
    <Panel title="Colours">
      <ColorCtl label={widget === 'gifts' ? 'Primary / streak' : 'Primary'} value={style.accent} onChange={set('accent')} />
      <ColorCtl label={widget === 'gifts' ? 'Accent / gifter' : 'Accent'} value={style.accent2} onChange={set('accent2')} />
      <ColorCtl label="Text" value={style.textColor} onChange={set('textColor')} />
      <ColorCtl label="Background" value={style.bg} onChange={set('bg')} />
      <SliderCtl label="Background opacity" value={style.bgOpacity} min={0} max={1} step={0.02} onChange={set('bgOpacity')} />
    </Panel>
  );
}

function TypographyPanel({ style, set, kit }) {
  const fonts = kit.options.fonts.some((f) => f.id === style.fontFamily) ? kit.options.fonts : [{ id: style.fontFamily, label: style.fontFamily }, ...kit.options.fonts];
  const weights = kit.options.weights.map((w) => ({ id: String(w), label: `${w} · ${WEIGHT_LABELS[w] || ''}` }));
  return (
    <Panel title="Typography">
      <SelectCtl label="Font" value={style.fontFamily} options={fonts} onChange={set('fontFamily')} />
      <SelectCtl label="Weight" value={String(style.fontWeight)} options={weights} onChange={(v) => set('fontWeight')(Number(v))} />
      <div className="help">System fonts only, so OBS never waits on the network. Fonts missing on a PC fall back to Segoe UI.</div>
    </Panel>
  );
}

function ShapePanel({ style, set, widget }) {
  const [wMin, wMax] = WIDTH_RANGE[widget];
  return (
    <Panel title="Shape">
      <SliderCtl label="Corner radius" value={style.radius} min={0} max={40} unit="px" onChange={set('radius')} />
      <SliderCtl label="Border width" value={style.borderWidth} min={0} max={8} unit="px" onChange={set('borderWidth')} />
      <SliderCtl label="Spacing" value={style.spacing} min={0.6} max={1.6} step={0.05} unit="x" onChange={set('spacing')} />
      <SliderCtl label="Width" value={style.width} min={wMin} max={wMax} step={widget === 'gifts' ? 10 : 4} unit="px" onChange={set('width')} />
      <SliderCtl label="Scale" value={style.scale} min={0.4} max={3} step={0.05} unit="x" onChange={set('scale')} />
      <div className="help">Width and scale are yours — switching presets keeps them.</div>
    </Panel>
  );
}

function ContentPanel({ style, set, widget }) {
  if (widget === 'gifts') {
    return (
      <Panel title="Content">
        <SegCtl
          label="Show"
          value={style.mode}
          options={[
            { id: 'both', label: 'Both' },
            { id: 'streak', label: 'Top streak' },
            { id: 'gifter', label: 'Top gifter' },
          ]}
          onChange={set('mode')}
        />
        {style.mode === 'both' && <SliderCtl label="Switch every" value={style.rotateSeconds} min={3} max={30} unit="s" onChange={set('rotateSeconds')} />}
        <TextCtl label="Streak title" value={style.streakTitle} maxLength={24} onChange={set('streakTitle')} />
        <TextCtl label="Gifter title" value={style.gifterTitle} maxLength={24} onChange={set('gifterTitle')} />
        <TextCtl label="Empty message" value={style.emptyText} maxLength={60} onChange={set('emptyText')} />
        <SwitchCtl label="Show title" value={style.showTitle} onChange={set('showTitle')} />
        <SwitchCtl label="Jump to live combos" value={style.showLiveStreak} onChange={set('showLiveStreak')} />
        <SwitchCtl label="Gift name" value={style.showGiftName} onChange={set('showGiftName')} />
        <SwitchCtl label="Diamonds" value={style.showDiamonds} onChange={set('showDiamonds')} />
        <SwitchCtl label="Gifter profile picture" value={style.showAvatar} onChange={set('showAvatar')} />
        <SwitchCtl label="Corner badge" value={style.showIcon} onChange={set('showIcon')} />
      </Panel>
    );
  }
  if (widget === 'rank') {
    return (
      <Panel title="Content">
        <TextCtl label="Label" value={style.rankLabel} maxLength={32} onChange={set('rankLabel')} />
        <TextCtl label="Not ranked text" value={style.unrankedText} maxLength={20} onChange={set('unrankedText')} />
        <SwitchCtl label="Show label" value={style.showLabel} onChange={set('showLabel')} />
        <SwitchCtl label="Show score" value={style.showScore} onChange={set('showScore')} />
        <SwitchCtl label="Trophy emblem" value={style.showIcon} onChange={set('showIcon')} />
      </Panel>
    );
  }
  return (
    <Panel title="Content">
      <TextCtl label="Label" value={style.galleryLabel} maxLength={32} onChange={set('galleryLabel')} />
      <SwitchCtl label="Show label" value={style.showLabel} onChange={set('showLabel')} />
      <SwitchCtl label="Show total (/25)" value={style.showTotal} onChange={set('showTotal')} />
      <SwitchCtl label="Progress bar" value={style.showBar} onChange={set('showBar')} />
      <SwitchCtl label="Gift emblem" value={style.showIcon} onChange={set('showIcon')} />
    </Panel>
  );
}

const CHANGE_HELP = { gifts: 'Plays on every combo tap and diamond change.', rank: 'Plays when your rank moves.', gallery: 'Plays when a gallery gift lights up.' };

function AnimationPanel({ style, set, kit, widget }) {
  const off = style.animations === false;
  return (
    <Panel title="Animation" actions={<Seg options={[{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }]} value={off ? 'off' : 'on'} onChange={(v) => set('animations')(v === 'on')} />}>
      <div className={off ? 'qu-dim' : ''}>
        <SelectCtl label="Entrance" value={style.entrance} options={kit.options.entrances} onChange={set('entrance')} />
        <SelectCtl label="On change" value={style.change} options={kit.options.changes} onChange={set('change')} />
        <SwitchCtl label="Count numbers up" value={style.countUp} onChange={set('countUp')} />
        <SelectCtl label="Idle motion" value={style.idle} options={kit.options.idles} onChange={set('idle')} />
        <SliderCtl label="Speed" value={style.speed} min={0.25} max={3} step={0.05} unit="x" onChange={set('speed')} />
        <SwitchCtl label="Glow" value={style.glow} onChange={set('glow')} />
        <SwitchCtl label="Floating sparkles" value={style.particles} onChange={set('particles')} />
        <SwitchCtl label={widget === 'gifts' ? 'Orbit ring' : 'Ring around emblem'} value={style.ring} onChange={set('ring')} />
      </div>
      <div className="help">
        {CHANGE_HELP[widget]} Everything stops when animations are off or the PC asks for reduced motion.
      </div>
    </Panel>
  );
}
