// Building blocks shared by the Viewer Queue and TikTok Gifts pages.
import { useEffect, useRef, useState, useCallback } from 'react';
import { Panel, Button, Toggle, Seg, Modal, copyText } from '../../ui.jsx';
import { useQU, hashHue } from './store.js';

/** Square avatar: the real picture when it loads, otherwise a flat tint with an initial. */
export function Avatar({ url, seed, letter, size = 28 }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const tint = `hsl(${hashHue(seed || 'x')} 16% 27%)`;
  return (
    <span className="qu-av" style={{ width: size, height: size, background: tint }}>
      {url && !failed ? <img src={url} alt="" draggable={false} onError={() => setFailed(true)} /> : <span>{letter}</span>}
    </span>
  );
}

/** Text input that edits locally and commits after a pause (or on blur / Enter). */
export function DraftInput({ value, onCommit, delay = 350, ...rest }) {
  const [draft, setDraft] = useState(value ?? '');
  const focused = useRef(false);
  const timer = useRef(null);
  useEffect(() => {
    if (!focused.current) setDraft(value ?? '');
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = (v) => {
    clearTimeout(timer.current);
    if (v !== (value ?? '')) onCommit(v);
  };
  return (
    <input
      {...rest}
      value={draft}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        commit(draft);
      }}
      onKeyDown={(e) => e.key === 'Enter' && commit(draft)}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(v), delay);
      }}
    />
  );
}

/* ─── Overlay style controls: label on the left, control on the right ─── */

export function Ctl({ label, children, value }) {
  return (
    <div className="qu-ctl">
      <span className="qu-ctl-l">{label}</span>
      <div className="qu-ctl-c">{children}</div>
      {value != null && <b className="qu-ctl-v">{value}</b>}
    </div>
  );
}

export function SliderCtl({ label, value, min, max, step = 1, unit = '', onChange }) {
  const v = Number(value) || 0;
  const shown = Number.isInteger(step) ? Math.round(v) : v.toFixed(2);
  return (
    <Ctl label={label} value={`${shown}${unit}`}>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </Ctl>
  );
}

export function ColorCtl({ label, value, onChange }) {
  return (
    <Ctl label={label}>
      <div className="row nowrap">
        <input type="color" value={value || '#000000'} onChange={(e) => onChange(e.target.value)} />
        <span className="mono faint">{String(value || '').toUpperCase()}</span>
      </div>
    </Ctl>
  );
}

export function SwitchCtl({ label, value, onChange }) {
  return (
    <Ctl label={label}>
      <Toggle value={!!value} onChange={onChange} />
    </Ctl>
  );
}

export function TextCtl({ label, value, onChange, maxLength }) {
  return (
    <Ctl label={label}>
      <input type="text" value={value ?? ''} maxLength={maxLength} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
    </Ctl>
  );
}

export function SelectCtl({ label, value, options, onChange }) {
  return (
    <Ctl label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </Ctl>
  );
}

export function SegCtl({ label, value, options, onChange }) {
  return (
    <Ctl label={label}>
      <Seg options={options} value={value} onChange={onChange} />
    </Ctl>
  );
}

export const FONT_OPTIONS = [
  { id: 'Inter', label: 'Inter / system' },
  { id: 'Segoe UI', label: 'Segoe UI' },
  { id: 'Bebas Neue', label: 'Bebas Neue' },
  { id: 'Impact', label: 'Impact' },
  { id: 'Arial Black', label: 'Arial Black' },
  { id: 'Georgia', label: 'Georgia' },
  { id: 'Consolas', label: 'Consolas' },
  { id: 'Comic Sans MS', label: 'Comic Sans MS' },
];

const BACKDROPS = [
  { id: 'checker', label: 'Checker' },
  { id: 'dark', label: 'Dark' },
  { id: 'mid', label: 'Mid' },
  { id: 'light', label: 'Light' },
];

/**
 * Live preview of an OBS browser source plus its URL. The iframe loads the very page OBS
 * loads, from the Steez server, so what you see is what the stream gets.
 */
export function OverlayPreview({ path, width, height, onReset, title = 'Preview', stageHeight, query = '', demoLabel, children }) {
  const base = useQU((s) => s.baseUrl);
  const [backdrop, setBackdrop] = useState('checker');
  const [size, setSize] = useState(null);
  const frame = useRef(null);
  const url = base ? base + path : '';

  // The TikTok overlays report their real size in editor mode (?editor=1), so the OBS
  // size shown below follows the preset, scale and width exactly.
  useEffect(() => {
    const onMsg = (e) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      if (!e.data || e.data.type !== 'steez:size') return;
      const { width: w, height: h } = e.data;
      // The gifts card changes height a little as it rotates; keep the tallest for this width.
      setSize((prev) => (prev && prev.width === w && prev.height >= h && prev.height - h < 60 ? prev : { width: w, height: h }));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  /** Plays a fake update inside this preview only — OBS never sees it. */
  const playDemo = () => frame.current?.contentWindow?.postMessage({ type: 'steez:demo' }, '*');
  const obsW = size ? size.width : width;
  const obsH = size ? size.height : height;

  return (
    <Panel
      title={title}
      className="qu-preview"
      actions={
        <>
          {demoLabel && (
            <Button size="sm" icon="play" onClick={playDemo} disabled={!url} title="Plays a fake update in this preview only">
              {demoLabel}
            </Button>
          )}
          <Seg options={BACKDROPS} value={backdrop} onChange={setBackdrop} />
          {onReset && (
            <Button size="sm" variant="ghost" onClick={onReset}>
              Reset style
            </Button>
          )}
        </>
      }
    >
      <div className="row nowrap qu-url">
        <input readOnly className="mono" value={url || 'Starting server…'} onFocus={(e) => e.target.select()} />
        <Button icon="copy" variant="primary" disabled={!url} onClick={() => copyText(url, 'Browser source URL copied')}>
          Copy URL
        </Button>
        <Button icon="external" className="icon" title="Open in browser" disabled={!url} onClick={() => window.steez.open(url)} />
      </div>
      <div className={`qu-stage bg-${backdrop}`} style={stageHeight ? { height: stageHeight } : undefined}>
        {url && <iframe ref={frame} src={url + query} title={`${title} — overlay preview`} />}
      </div>
      <div className="help qu-obs">
        In OBS: <b>Sources → + → Browser</b>, paste the URL, set width <b>{obsW}</b> and height <b>{obsH}</b>, and leave{' '}
        <i>Shutdown source when not visible</i> unchecked. Edits apply live — no refresh needed.
      </div>
      {children}
    </Panel>
  );
}

/** Promise-based confirm dialog in the Steez style. Render `dialog` somewhere in the page. */
export function useConfirm() {
  const [req, setReq] = useState(null);
  const ask = useCallback((opts) => new Promise((resolve) => setReq({ ...opts, resolve })), []);
  const close = (answer) => {
    req?.resolve(answer);
    setReq(null);
  };
  const dialog = req && (
    <Modal title={req.title} onClose={() => close(false)} width={420}>
      {req.message && <p className="muted qu-confirm-msg">{req.message}</p>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={() => close(false)}>
          Cancel
        </Button>
        <Button className={req.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
          {req.confirmLabel || 'Confirm'}
        </Button>
      </div>
    </Modal>
  );
  return [dialog, ask];
}
