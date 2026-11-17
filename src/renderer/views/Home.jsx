import BotPage from './bot/BotPage.jsx';
import { Icon } from '../ui.jsx';
import { FeaturesPanel } from '../lib/features.jsx';

const SHORTCUTS = [
  { id: 'music', icon: 'music', title: 'Song Requests', text: 'Spotify, YouTube and SoundCloud requests from chat and channel points.' },
  { id: 'queue', icon: 'queue', title: 'Viewer Queue', text: 'Party and queue for playing with viewers, with an OBS overlay.' },
  { id: 'commands', icon: 'terminal', title: 'Chat Bot', text: 'Commands, timers, moderation, points, games and giveaways.' },
  { id: 'overlays', icon: 'layers', title: 'OBS Overlays', text: 'Every browser source Steez provides, ready to copy.' },
];

export default function Home({ go }) {
  return (
    <>
      <div className="home-shortcuts">
        {SHORTCUTS.map((s) => (
          <button key={s.id} className="home-tile" onClick={() => go(s.id)}>
            <span className="ic">
              <Icon name={s.icon} size={18} />
            </span>
            <b>{s.title}</b>
            <span className="d">{s.text}</span>
          </button>
        ))}
      </div>
      <FeaturesPanel go={go} />
      <BotPage id="overview" />
      <style>{`
        .home-shortcuts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 16px; }
        .home-tile { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 14px; row-gap: 3px; align-items: start; text-align: left; white-space: normal; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-card); padding: 16px; }
        .home-tile:hover { background: var(--surface-2); border-color: var(--line-2); }
        .home-tile .ic { grid-row: span 2; width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent-hi); }
        .home-tile .ic svg { width: 18px; height: 18px; }
        .home-tile b { font-size: 14px; font-weight: 600; }
        .home-tile span.d { color: var(--text-3); font-size: 12.5px; line-height: 1.45; }
        @media (max-width: 1200px) { .home-shortcuts { grid-template-columns: repeat(2, 1fr); } }
      `}</style>
    </>
  );
}
