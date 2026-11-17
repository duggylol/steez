// Search window (Ctrl+K or the bar at the top): pages, settings, feature switches, overlays, chat
// commands and quick actions, matched forgivingly (see lib/search.js).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, toast } from './ui.jsx';
import { search, highlight, settingEntries } from './lib/search.js';
import { PAGES, SECTIONS } from './lib/searchCatalog.js';
import { useFeatures, setFeature } from './lib/features.jsx';
import { api } from './lib/bot.js';
import { HELP } from './views/bot/botPages.js';

// Where each chat-bot settings section is shown.
const SETTING_PLACES = {
  general: { route: 'settings', tab: 'Chat bot', name: 'Chat bot settings' },
  shoutout: { route: 'settings', tab: 'Chat bot', name: 'Shoutouts' },
  discord: { route: 'settings', tab: 'Chat bot', name: 'Discord' },
  moderation: { route: 'moderation', name: 'Moderation' },
  shield: { route: 'moderation', name: 'Shield', keywords: ['follow bots'] },
  ai: { route: 'ai', name: 'AI' },
  loyalty: { route: 'loyalty', name: 'Points', keywords: ['points', 'loyalty'] },
  games: { route: 'games', name: 'Games' },
  quotes: { route: 'quotes', name: 'Quotes' },
  achievements: { route: 'achievements', name: 'Achievements' },
  events: { route: 'alerts', name: 'Alerts', keywords: ['chat message', 'thank you'] },
  overlay: { route: 'alerts', name: 'Alert overlay', keywords: ['overlay', 'alert'] },
  hype: { route: 'hype', name: 'Hype' },
  clips: { route: 'hype', name: 'Clips' },
  modPanel: { route: 'modpanel', name: 'Mod Panel' },
};

const KIND = {
  page: { label: 'Pages', icon: 'layers' },
  section: { label: 'Sections', icon: 'link' },
  feature: { label: 'Turn on or off', icon: 'spark' },
  action: { label: 'Actions', icon: 'play' },
  setting: { label: 'Settings', icon: 'cog' },
  overlay: { label: 'Overlays', icon: 'layers' },
  command: { label: 'Chat commands', icon: 'terminal' },
};
const ORDER = ['action', 'feature', 'page', 'section', 'overlay', 'setting', 'command'];

const PAGE_ICON = { home: 'home', overlays: 'layers', alerts: 'bell', subathon: 'hourglass', shop: 'bag', hype: 'fire', commands: 'terminal', timers: 'clock', quotes: 'quote', ai: 'spark', moderation: 'shield', modpanel: 'users', loyalty: 'coin', games: 'dice', giveaways: 'gift', polls: 'chart', achievements: 'trophy', queue: 'queue', music: 'music', gifts: 'tiktok', analytics: 'chart', logs: 'log', import: 'download', settings: 'cog' };

const ACTIONS = [
  { id: 'a:trivia', title: 'Start a trivia round', keywords: ['trivia', 'quiz'], run: () => api.action('trivia:start', {}).then(() => toast('Trivia round started')) },
  { id: 'a:alert', title: 'Send a test follow alert', keywords: ['test alert', 'follow', 'overlay test'], run: () => api.action('alert:test', { type: 'follow' }).then(() => toast('Test alert sent')) },
  { id: 'a:confetti', title: 'Test the confetti effect', keywords: ['effect', 'shop', 'overlay test'], run: () => api.action('effect:test', { effect: 'confetti' }).then(() => toast('Confetti sent')) },
  { id: 'a:updates', title: 'Check for updates', keywords: ['update', 'version', 'upgrade'], run: () => window.steez.update.check().then(() => toast('Checking for updates')) },
  { id: 'a:twitch', title: 'Log in to Twitch', keywords: ['connect', 'twitch', 'login', 'account'], run: () => window.steez.twitch.login() },
  { id: 'a:data', title: 'Open the data folder', keywords: ['files', 'backup', 'logs folder'], run: () => window.steez.openDataFolder() },
];

const RECENT_KEY = 'steez.search.recent';
const readRecent = () => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
};

/** Open a page, then the right tab, then scroll to and flash the thing that was picked. */
export async function goTo(target) {
  if (!target) return;
  if (location.hash.slice(1) !== target.route) location.hash = target.route;
  const find = async (fn, ms = 3000) => {
    for (let t = 0; t < ms; t += 100) {
      const el = fn();
      if (el) return el;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  };
  const scope = () => document.querySelector('.page-inner');
  if (target.tab) {
    const tab = await find(() =>
      [...(scope()?.querySelectorAll('.tabs button, [data-tab]') || [])].find((b) => b.textContent.trim().toLowerCase().startsWith(target.tab.toLowerCase())),
    );
    tab?.click();
    await new Promise((r) => setTimeout(r, 250));
  }
  let el = null;
  if (target.path) el = await find(() => scope()?.querySelector(`[data-path="${CSS.escape(target.path)}"]`));
  else if (target.heading) el = await find(() => [...(scope()?.querySelectorAll('h3') || [])].find((h) => h.textContent.trim().toLowerCase() === target.heading.toLowerCase())?.closest('.card, .panel, section') || null);
  else if (target.text) el = await find(() => [...(scope()?.querySelectorAll('td, b, h3, code') || [])].find((n) => n.textContent.trim() === target.text));
  else if (target.overlay) el = await find(() => scope()?.querySelector(`[data-overlay="${CSS.escape(target.overlay)}"]`));
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('flash-target');
  void el.offsetWidth;
  el.classList.add('flash-target');
  setTimeout(() => el.classList.remove('flash-target'), 1800);
  el.querySelector?.('input, select, textarea')?.focus({ preventScroll: true });
}

export function SearchLauncher({ onOpen }) {
  return (
    <div className="search-launch" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <Icon name="search" />
      <span className="grow">Search pages, settings, overlays, commands…</span>
      <span className="kbd">Ctrl K</span>
    </div>
  );
}

export function SearchPalette({ open, onClose }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [live, setLive] = useState({ settings: [], overlays: [], commands: [] });
  const features = useFeatures();
  const input = useRef(null);
  const list = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setSel(0);
    setTimeout(() => input.current?.focus(), 0);
    // Live parts of the index: chat-bot settings, commands and overlays.
    api
      .get('/api/state')
      .then((S) => {
        const settings = settingEntries(S.settings, SETTING_PLACES, HELP);
        const commands = Object.entries(S.commands || {}).map(([name, c]) => ({
          kind: 'command',
          id: `cmd:${name}`,
          title: `!${name}`,
          description: c.response || '',
          keywords: ['command', ...(c.aliases || [])],
          target: { route: 'commands', text: `!${name}` },
        }));
        setLive((l) => ({ ...l, settings, commands }));
      })
      .catch(() => {});
    window.steez
      .overlays()
      .then(({ list: ov }) =>
        setLive((l) => ({
          ...l,
          overlays: ov.map((o) => ({ kind: 'overlay', id: `ov:${o.id}`, title: o.name, description: o.description, keywords: ['overlay', 'obs', 'browser source'], section: o.module, target: { route: 'overlays', overlay: o.id } })),
        })),
      )
      .catch(() => {});
  }, [open]);

  const entries = useMemo(
    () => [
      ...PAGES.map((p) => ({ ...p, kind: 'page', target: { route: p.id }, boost: 0.3 })),
      ...SECTIONS.map((s) => ({ ...s, kind: 'section', id: `sec:${s.title}`, target: { route: s.route, tab: s.tab, heading: s.heading } })),
      ...features.map((f) => ({
        kind: 'feature',
        id: `feat:${f.id}`,
        title: `${f.on ? 'Turn off' : 'Turn on'} ${f.name}`,
        description: f.description,
        keywords: [f.name, 'enable', 'disable', 'switch', 'feature'],
        feature: f,
      })),
      ...ACTIONS.map((a) => ({ ...a, kind: 'action' })),
      ...live.overlays,
      ...live.settings,
      ...live.commands,
    ],
    [features, live],
  );

  const results = useMemo(() => {
    if (!q.trim()) {
      const recent = readRecent()
        .map((id) => entries.find((e) => e.id === id))
        .filter(Boolean);
      const start = ['home', 'overlays', 'commands', 'music', 'subathon', 'settings'].map((id) => entries.find((e) => e.kind === 'page' && e.id === id)).filter(Boolean);
      return [...recent.map((e) => ({ ...e, group: 'Recent' })), ...start.filter((s) => !recent.includes(s)).map((e) => ({ ...e, group: 'Jump to' }))];
    }
    const hits = search(q, entries, 40);
    // Keep the best few of each kind, grouped, best groups first.
    const byKind = {};
    for (const h of hits) (byKind[h.kind] ||= []).push(h);
    const groups = Object.entries(byKind)
      .map(([k, list]) => ({ k, list: list.slice(0, k === 'setting' ? 8 : 6), top: list[0].score + (ORDER.length - ORDER.indexOf(k)) * 0.01 }))
      .sort((a, b) => b.top - a.top);
    return groups.flatMap((g) => g.list.map((e) => ({ ...e, group: KIND[g.k].label })));
  }, [q, entries]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    list.current?.querySelector('.search-hit.sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;

  const choose = async (e) => {
    if (!e) return;
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify([e.id, ...readRecent().filter((x) => x !== e.id)].slice(0, 5)));
    } catch {
      /* ignore */
    }
    onClose();
    try {
      if (e.kind === 'feature') {
        await setFeature(e.feature.id, !e.feature.on);
        toast(`${e.feature.name}: ${e.feature.on ? 'off' : 'on'}`);
      } else if (e.kind === 'action') await e.run();
      else await goTo(e.target);
    } catch (err) {
      toast(err?.message || String(err), { error: true });
    }
  };

  const onKey = (ev) => {
    if (ev.key === 'Escape') onClose();
    else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      setSel((s) => Math.min(results.length - 1, s + 1));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      choose(results[sel]);
    }
  };

  const where = (e) =>
    e.kind === 'feature' ? (e.feature.on ? 'On' : 'Off') : e.kind === 'setting' ? e.section : e.kind === 'section' ? PAGES.find((p) => p.id === e.route)?.title : e.kind === 'overlay' ? 'OBS Overlays' : e.kind === 'command' ? 'Commands' : '';
  const iconOf = (e) => (e.kind === 'page' ? PAGE_ICON[e.id] || 'layers' : e.kind === 'section' ? PAGE_ICON[e.route] || 'link' : KIND[e.kind].icon);
  const Mark = ({ text }) =>
    highlight(text, q).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>));

  let lastGroup = null;
  return (
    <div className="search-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-box" role="dialog" aria-label="Search Steez">
        <div className="search-input">
          <Icon name="search" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search pages, settings, overlays, commands…" spellCheck={false} />
          <span className="kbd">Esc</span>
        </div>
        <div className="search-results" ref={list}>
          {results.length === 0 && (
            <div className="search-empty">
              Nothing matches “{q}”. Try a shorter word, or what the thing does, like “points”, “overlay” or “ban words”.
            </div>
          )}
          {results.map((e, i) => {
            const head = e.group !== lastGroup ? <div className="search-section">{e.group}</div> : null;
            lastGroup = e.group;
            return (
              <div key={e.id + i}>
                {head}
                <div className={`search-hit ${i === sel ? 'sel' : ''}`} onMouseMove={() => i !== sel && setSel(i)} onClick={() => choose(e)}>
                  <span className="ic">
                    <Icon name={iconOf(e)} />
                  </span>
                  <div className="grow">
                    <div className="t">{q ? <Mark text={e.title} /> : e.title}</div>
                    {e.description && <div className="d">{e.description}</div>}
                  </div>
                  <span className="where">{where(e)}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="search-foot">
          <span>
            <span className="kbd">↑</span> <span className="kbd">↓</span> to move
          </span>
          <span>
            <span className="kbd">Enter</span> to open
          </span>
          <span className="grow" />
          <span>Typos are fine</span>
        </div>
      </div>
    </div>
  );
}
