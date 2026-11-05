// Shared UI kit for every Steez view. Keep it sharp: square corners, 1px lines, greys.
import { useEffect, useState, useCallback } from 'react';

export function PageHeader({ title, sub, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className = '', style }) {
  return (
    <div className={`panel ${className}`} style={style}>
      {(title || actions) && (
        <div className="panel-head">
          <h3>{title}</h3>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Button({ variant, size, icon, children, ...rest }) {
  const cls = [variant, size, rest.className].filter(Boolean).join(' ');
  return (
    <button {...rest} className={cls}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

export function Toggle({ value, onChange, label, help }) {
  const sw = <span className={`toggle ${value ? 'on' : ''}`} role="switch" aria-checked={!!value} tabIndex={0} onClick={() => onChange(!value)} onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && onChange(!value)} />;
  if (!label) return sw;
  return (
    <div style={{ marginBottom: 12 }}>
      <label className="row nowrap" style={{ cursor: 'pointer', gap: 10 }}>
        {sw}
        <span>{label}</span>
      </label>
      {help && <div className="help" style={{ marginLeft: 42 }}>{help}</div>}
    </div>
  );
}

export function Field({ label, help, children }) {
  return (
    <label className="field">
      {label && <span>{label}</span>}
      {children}
      {help && <div className="help">{help}</div>}
    </label>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((t) => {
        const id = typeof t === 'string' ? t : t.id;
        const lbl = typeof t === 'string' ? t : t.label;
        return (
          <button key={id} className={value === id ? 'active' : ''} onClick={() => onChange(id)}>
            {lbl}
          </button>
        );
      })}
    </div>
  );
}

export function Seg({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => {
        const id = typeof o === 'string' ? o : o.id;
        const lbl = typeof o === 'string' ? o : o.label;
        return (
          <button key={id} className={value === id ? 'active' : ''} onClick={() => onChange(id)}>
            {lbl}
          </button>
        );
      })}
    </div>
  );
}

export function Pill({ tone, children, plain }) {
  return <span className={`pill ${tone || ''} ${plain ? 'plain' : ''}`}>{children}</span>;
}

export function Stat({ value, label }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Modal({ title, onClose, children, width }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={width ? { width } : undefined}>
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

// ─── Toasts (global) ─────────────────────────────────────────
const toastSubs = new Set();
let toastId = 0;
export function toast(message, { error = false, ms } = {}) {
  const t = { id: ++toastId, message: String(message), error };
  toastSubs.forEach((fn) => fn(t, ms ?? (error ? 6000 : 2600)));
}
export function Toaster() {
  const [list, setList] = useState([]);
  useEffect(() => {
    const fn = (t, ms) => {
      setList((l) => [...l, t]);
      setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), ms);
    };
    toastSubs.add(fn);
    return () => toastSubs.delete(fn);
  }, []);
  return (
    <div className="toast-stack">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.error ? 'err' : ''}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

/** Run an async action, toasting errors. */
export function useAction() {
  return useCallback(async (fn, okMessage) => {
    try {
      const r = await fn();
      if (okMessage) toast(okMessage);
      return r;
    } catch (e) {
      toast(e?.message || String(e), { error: true });
      return undefined;
    }
  }, []);
}

export function copyText(text, msg = 'Copied') {
  window.steez?.copy(text).then(() => toast(msg));
}

// ─── Icons (1.5px line, 16px grid) ───────────────────────────
const PATHS = {
  home: 'M2.5 7.5 8 3l5.5 4.5V13a.5.5 0 0 1-.5.5H9.5V10h-3v3.5H3a.5.5 0 0 1-.5-.5z',
  music: 'M6 12.5a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0zm0 0V3.5l7.5-1.5v8.5m0 0a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0z',
  queue: 'M2.5 4h11M2.5 8h11M2.5 12h7',
  users: 'M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm-4 6c0-2.2 1.8-4 4-4s4 1.8 4 4m1-6.5a2 2 0 1 0 0-4m1.5 10.5c0-1.7-.9-3.1-2.2-3.7',
  terminal: 'M2.5 3.5h11v9h-11zm2.5 3 2 1.5-2 1.5m3.5 0H11',
  clock: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zm0-9v3.5l2.2 1.3',
  shield: 'M8 2 3 4v4c0 3 2.2 5.2 5 6 2.8-.8 5-3 5-6V4z',
  coin: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zm2-7.8C9.6 5.5 8.9 5.2 8 5.2c-1.2 0-2 .6-2 1.4 0 2 4 1 4 3 0 .8-.9 1.4-2 1.4-.9 0-1.7-.4-2.1-1M8 4v8',
  dice: 'M2.5 2.5h11v11h-11zM5.5 5.5h.01M10.5 5.5h.01M8 8h.01M5.5 10.5h.01M10.5 10.5h.01',
  gift: 'M2.5 6h11v2.5h-11zm1 2.5V13.5h9V8.5M8 6v7.5M8 6S6.5 2.5 5 3.5 6 6 8 6zm0 0s1.5-3.5 3-2.5S10 6 8 6',
  chart: 'M2.5 13.5h11M4.5 11V8m3.5 3V4.5m3.5 6.5V6.5',
  quote: 'M3 9.5V7c0-1.7 1-3 2.5-3.5M3 9.5h2.5V12H3zm6 0V7c0-1.7 1-3 2.5-3.5M9 9.5h2.5V12H9z',
  trophy: 'M5 2.5h6v3.5a3 3 0 0 1-6 0zM5 4H2.5c0 2 1 3 2.6 3.2M11 4h2.5c0 2-1 3-2.6 3.2M8 9v2.5m-2.5 2h5',
  bell: 'M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3zm2.5 2.5a1.5 1.5 0 0 0 3 0',
  bag: 'M3 5.5h10l-.8 8H3.8zM5.5 5.5V4.5a2.5 2.5 0 0 1 5 0v1',
  fire: 'M8 14c2.5 0 4-1.7 4-4 0-3-2.5-4-2.5-7C7 4.5 5.5 6.5 6 8.5 5 8 4.5 7 4.5 6 3.5 7 4 8.5 4 10c0 2.3 1.5 4 4 4z',
  film: 'M2.5 3.5h11v9h-11zM5 3.5v9M11 3.5v9M2.5 6.5H5m6 0h2.5M2.5 9.5H5m6 0h2.5',
  layers: 'M8 2.5 2.5 5.5 8 8.5l5.5-3zM2.5 8 8 11l5.5-3M2.5 10.5 8 13.5l5.5-3',
  spark: 'M8 2.5v3M8 10.5v3M2.5 8h3m5 0h3M4.2 4.2l2 2m3.6 3.6 2 2m0-7.6-2 2m-3.6 3.6-2 2',
  cog: 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm5.2-1.2.8.6-1 1.8-1-.3c-.4.3-.8.6-1.3.7l-.2 1.1h-2l-.2-1.1c-.5-.2-.9-.4-1.3-.7l-1 .3-1-1.8.8-.6a4 4 0 0 1 0-1.6L2 6.6l1-1.8 1 .3c.4-.3.8-.6 1.3-.7L5.5 3.3h2l.2 1.1c.5.2.9.4 1.3.7l1-.3 1 1.8-.8.6c.1.5.1 1.1 0 1.6z',
  log: 'M3.5 2.5h9v11h-9zM5.5 5.5h5M5.5 8h5M5.5 10.5h3',
  chat: 'M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z',
  play: 'M5 3.5 12 8l-7 4.5z',
  pause: 'M5 3.5v9M11 3.5v9',
  next: 'M4 3.5 10 8l-6 4.5zM12 3.5v9',
  prev: 'M12 3.5 6 8l6 4.5zM4 3.5v9',
  plus: 'M8 3v10M3 8h10',
  x: 'M4 4l8 8M12 4l-8 8',
  check: 'M3 8.5 6.5 12 13 4.5',
  copy: 'M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3',
  external: 'M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11 9.5v4H2.5V5H6.5',
  search: 'M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm6.5 1.5-3-3',
  refresh: 'M13 4v3h-3M3 12V9h3M12.6 7A4.8 4.8 0 0 0 4 5.3M3.4 9A4.8 4.8 0 0 0 12 10.7',
  link: 'M7 9a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.6.6M9 7a3 3 0 0 0-4.2 0l-2 2A3 3 0 0 0 7 13.2l.6-.6',
  drag: 'M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01',
  up: 'M8 13V3M3.5 7.5 8 3l4.5 4.5',
  down: 'M8 3v10M3.5 8.5 8 13l4.5-4.5',
  trash: 'M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9',
  tiktok: 'M9.5 2.5c.3 1.7 1.5 3 3.5 3.2v2.1c-1.3 0-2.5-.4-3.5-1.1v4.1a3.3 3.3 0 1 1-3.3-3.3v2.1a1.2 1.2 0 1 0 1.2 1.2V2.5z',
  volume: 'M2.5 6h2.5l3.5-3v10L5 10H2.5zm8.5-.5a3 3 0 0 1 0 5',
};
export function Icon({ name, size }) {
  const d = PATHS[name] || PATHS.spark;
  return (
    <svg viewBox="0 0 16 16" width={size || 15} height={size || 15} strokeLinecap="square" strokeLinejoin="miter">
      <path d={d} />
    </svg>
  );
}
