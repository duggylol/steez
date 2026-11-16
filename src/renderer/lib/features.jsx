// Feature on/off switches (see src/main/features.js). Everything starts off; the streamer turns on
// what they want from the Dashboard or the banner at the top of each feature's page.
import { useEffect, useState } from 'react';
import { Panel, Button, Toggle, toast } from '../ui.jsx';

let cache = null;
const subs = new Set();
const emit = (list) => {
  cache = list;
  subs.forEach((fn) => fn(list));
};
let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  window.steez.features.onChange(emit);
  window.steez.features.list().then(emit);
}
export const refreshFeatures = () => window.steez.features.list().then(emit);

export function useFeatures() {
  const [list, setList] = useState(cache);
  useEffect(() => {
    wire();
    subs.add(setList);
    if (cache) setList(cache);
    return () => subs.delete(setList);
  }, []);
  return list || [];
}

export async function setFeature(id, on) {
  try {
    emit(await window.steez.features.set(id, on));
  } catch (e) {
    toast(e.message || 'Could not change that', { error: true });
  }
}

/** Which feature each page belongs to. */
export const PAGE_FEATURE = {
  music: 'songs',
  queue: 'queue',
  gifts: 'tiktok',
  subathon: 'subathon',
  commands: 'chatbot',
  timers: 'chatbot',
  quotes: 'chatbot',
  giveaways: 'chatbot',
  polls: 'chatbot',
  loyalty: 'loyalty',
  games: 'games',
  moderation: 'moderation',
  alerts: 'alerts',
  shop: 'shop',
  hype: 'hype',
  achievements: 'achievements',
  ai: 'ai',
  modpanel: 'modpanel',
};

/** "X is off" banner at the top of a feature's page. */
export function FeatureBanner({ page }) {
  const list = useFeatures();
  const f = list.find((x) => x.id === PAGE_FEATURE[page]);
  if (!f || f.on) {
    const needs = f && f.needs && list.find((x) => x.id === f.needs);
    if (f && needs && !needs.on)
      return (
        <div className="banner feature-banner">
          <div className="grow">
            <b>{f.name}</b> works through chat commands, so <b>{needs.name}</b> needs to be on too.
          </div>
          <Button size="sm" variant="primary" onClick={() => setFeature(needs.id, true)}>
            Turn on {needs.name}
          </Button>
        </div>
      );
    return null;
  }
  return (
    <div className="banner feature-banner off">
      <div className="grow">
        <b>{f.name}: off.</b> {f.description} Nothing happens until you turn it on.
      </div>
      <Button size="sm" variant="primary" onClick={() => setFeature(f.id, true)}>
        Turn on
      </Button>
    </div>
  );
}

/** Every switch, on the Dashboard. */
export function FeaturesPanel({ go }) {
  const list = useFeatures();
  if (!list.length) return null;
  const groups = {};
  for (const g of ['Features', 'Chat bot']) groups[g] = [];
  for (const f of list) (groups[f.group] ||= []).push(f);
  for (const g of Object.keys(groups)) if (!groups[g].length) delete groups[g];
  const on = list.filter((f) => f.on).length;
  return (
    <Panel title="Features" actions={<span className="faint small">{on ? `${on} of ${list.length} on` : 'Everything is off — turn on what you want'}</span>}>
      <div className="features-grid">
        {Object.entries(groups).map(([group, items]) => (
          <div key={group} className="features-group">
            <div className="faint small features-group-title">{group}</div>
            {items.map((f) => {
              const needs = f.needs && list.find((x) => x.id === f.needs);
              return (
                <div key={f.id} className={`feature-row ${f.on ? 'on' : ''}`}>
                  <Toggle value={f.on} onChange={(v) => setFeature(f.id, v)} />
                  <div className="grow">
                    <div className="row nowrap" style={{ gap: 8 }}>
                      <b>{f.name}</b>
                      {f.on && needs && !needs.on && <span className="pill warn">Needs {needs.name}</span>}
                    </div>
                    <div className="faint small">{f.description}</div>
                  </div>
                  {f.page && (
                    <button className="sm" onClick={() => go(f.page)}>
                      Open
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <style>{`
        .features-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 28px; }
        .features-group-title { text-transform: uppercase; letter-spacing: .12em; margin: 4px 0 6px; }
        .feature-row { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-top: 1px solid var(--line); }
        .feature-row:not(.on) b { color: var(--text-2); }
        @media (max-width: 1200px) { .features-grid { grid-template-columns: 1fr; } }
      `}</style>
    </Panel>
  );
}
