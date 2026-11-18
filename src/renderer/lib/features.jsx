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
  chests: 'chests',
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
  // Song requests, queue, TikTok and subathon first, then the chat bot's parts — one even grid.
  const order = ['Features', 'Chat bot'];
  const sorted = [...list].sort((a, b) => (order.indexOf(a.group) + 1 || 9) - (order.indexOf(b.group) + 1 || 9));
  const on = list.filter((f) => f.on).length;
  return (
    <Panel title="Features" actions={<span className="faint small">{on ? `${on} of ${list.length} on` : 'Everything is off. Turn on what you want.'}</span>}>
      <div className="features-grid">
        {sorted.map((f) => {
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
                <button className="sm ghost" onClick={() => go(f.page)} title={`Open ${f.name}`}>
                  Open
                </button>
              )}
            </div>
          );
        })}
      </div>
      <style>{`
        .features-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 10px; }
        .feature-row { display: flex; align-items: flex-start; gap: 12px; padding: 12px 12px 12px 14px; border-radius: 12px; border: 1px solid var(--line); background: rgba(255, 255, 255, 0.015); }
        .feature-row .toggle { margin-top: 2px; }
        .feature-row.on { border-color: rgba(143, 124, 255, 0.35); background: var(--accent-soft); }
        .feature-row:not(.on) b { color: var(--text-2); }
        .feature-row .faint.small { margin-top: 2px; line-height: 1.45; }
      `}</style>
    </Panel>
  );
}
