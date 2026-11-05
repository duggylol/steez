import BotPage from './bot/BotPage.jsx';
import { Icon } from '../ui.jsx';

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
            <Icon name={s.icon} size={18} />
            <b>{s.title}</b>
            <span>{s.text}</span>
          </button>
        ))}
      </div>
      <BotPage id="overview" />
      <style>{`
        .home-shortcuts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--line); border: 1px solid var(--line); margin-bottom: 20px; }
        .home-tile { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; text-align: left; white-space: normal; background: var(--surface); border: 0; padding: 14px 16px; }
        .home-tile:hover { background: var(--surface-2); border: 0; }
        .home-tile svg { color: var(--text-2); }
        .home-tile b { font-size: 13px; }
        .home-tile span { color: var(--text-3); font-size: 11.5px; line-height: 1.4; }
        @media (max-width: 1200px) { .home-shortcuts { grid-template-columns: repeat(2, 1fr); } }
      `}</style>
    </>
  );
}
