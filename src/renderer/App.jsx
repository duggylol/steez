import { useEffect, useState, Suspense, lazy } from 'react';
import { Icon, Toaster, Pill } from './ui.jsx';
import { connectBotSocket } from './lib/bot.js';
import BotPage from './views/bot/BotPage.jsx';
import Home from './views/Home.jsx';
import Settings from './views/Settings.jsx';
import Overlays from './views/Overlays.jsx';
import MusicEngine from './views/music/MusicEngine.jsx';

const MusicView = lazy(() => import('./views/music/MusicView.jsx'));
const QueueView = lazy(() => import('./views/queue/QueueView.jsx'));
const GiftsView = lazy(() => import('./views/queue/GiftsView.jsx'));

export const NAV = [
  { group: 'Live', items: [{ id: 'home', label: 'Dashboard', icon: 'home' }] },
  {
    group: 'Features',
    items: [
      { id: 'music', label: 'Song Requests', icon: 'music' },
      { id: 'queue', label: 'Viewer Queue', icon: 'queue' },
      { id: 'gifts', label: 'TikTok Gifts', icon: 'tiktok' },
    ],
  },
  {
    group: 'Chat bot',
    items: [
      { id: 'commands', label: 'Commands', icon: 'terminal' },
      { id: 'timers', label: 'Timers', icon: 'clock' },
      { id: 'moderation', label: 'Moderation', icon: 'shield' },
      { id: 'loyalty', label: 'Points & Viewers', icon: 'coin' },
      { id: 'games', label: 'Games', icon: 'dice' },
      { id: 'giveaways', label: 'Giveaways', icon: 'gift' },
      { id: 'polls', label: 'Polls & Bets', icon: 'chart' },
      { id: 'quotes', label: 'Quotes', icon: 'quote' },
      { id: 'achievements', label: 'Achievements', icon: 'trophy' },
      { id: 'ai', label: 'AI', icon: 'spark' },
    ],
  },
  {
    group: 'Stream',
    items: [
      { id: 'alerts', label: 'Alerts & Events', icon: 'bell' },
      { id: 'shop', label: 'Shop & Effects', icon: 'bag' },
      { id: 'hype', label: 'Hype & Clips', icon: 'fire' },
      { id: 'analytics', label: 'Analytics', icon: 'chart' },
      { id: 'overlays', label: 'OBS Overlays', icon: 'layers' },
    ],
  },
  {
    group: 'System',
    items: [
      { id: 'settings', label: 'Settings', icon: 'cog' },
      { id: 'logs', label: 'Logs', icon: 'log' },
    ],
  },
];
const ALL = NAV.flatMap((g) => g.items);
const BOT_PAGES = new Set(['commands', 'timers', 'moderation', 'loyalty', 'games', 'giveaways', 'polls', 'quotes', 'achievements', 'ai', 'alerts', 'shop', 'hype', 'analytics', 'logs']);

function TitleBar({ page, twitch, update }) {
  const [max, setMax] = useState(false);
  useEffect(() => {
    window.steez.win.isMaximized().then(setMax);
    return window.steez.win.onMaximized(setMax);
  }, []);
  return (
    <div className="titlebar">
      <div className="brand">
        <span className={`dot ${twitch?.connected ? 'on' : ''}`} />
        STEEZ
      </div>
      <div className="crumbs">{page?.label}</div>
      <div className="chips">
        {update?.status === 'ready' && (
          <button className="sm primary" onClick={() => window.steez.update.install()}>
            Restart to update {update.newVersion}
          </button>
        )}
        {twitch?.live && <Pill tone="live">LIVE</Pill>}
        {twitch?.loggedIn ? (
          <Pill tone={twitch.connected ? 'good' : 'warn'}>{twitch.connected ? `#${twitch.channel}` : 'Connecting'}</Pill>
        ) : twitch?.expired ? (
          <Pill tone="bad">Twitch login expired</Pill>
        ) : (
          <Pill>Twitch not connected</Pill>
        )}
      </div>
      <div className="controls">
        <button onClick={() => window.steez.win.minimize()} title="Minimize">
          <svg viewBox="0 0 10 10"><path d="M0 5.5h10" /></svg>
        </button>
        <button onClick={() => window.steez.win.maximize()} title={max ? 'Restore' : 'Maximize'}>
          {max ? (
            <svg viewBox="0 0 10 10"><path d="M2.5.5h7v7M.5 2.5h7v7h-7z" /></svg>
          ) : (
            <svg viewBox="0 0 10 10"><path d="M.5.5h9v9h-9z" /></svg>
          )}
        </button>
        <button className="close" onClick={() => window.steez.win.close()} title="Close">
          <svg viewBox="0 0 10 10"><path d="M0 0l10 10M10 0 0 10" /></svg>
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || 'home');
  const [twitch, setTwitch] = useState(null);
  const [update, setUpdate] = useState(null);
  const [version, setVersion] = useState('');

  useEffect(() => {
    const onHash = () => setRoute(location.hash.slice(1) || 'home');
    window.addEventListener('hashchange', onHash);
    connectBotSocket();
    window.steez.info().then((i) => setVersion(i.version));
    window.steez.twitch.status().then(setTwitch);
    window.steez.update.state().then(setUpdate);
    const offT = window.steez.twitch.onStatus(setTwitch);
    const offU = window.steez.update.onState(setUpdate);
    return () => {
      window.removeEventListener('hashchange', onHash);
      offT();
      offU();
    };
  }, []);

  const go = (id) => {
    location.hash = id;
  };
  const page = ALL.find((p) => p.id === route) || ALL[0];

  let view;
  if (page.id === 'home') view = <Home go={go} twitch={twitch} />;
  else if (page.id === 'music') view = <MusicView />;
  else if (page.id === 'queue') view = <QueueView />;
  else if (page.id === 'gifts') view = <GiftsView />;
  else if (page.id === 'overlays') view = <Overlays />;
  else if (page.id === 'settings') view = <Settings twitch={twitch} update={update} />;
  else if (BOT_PAGES.has(page.id)) view = <BotPage key={page.id} id={page.id} />;

  return (
    <div className="app">
      <TitleBar page={page} twitch={twitch} update={update} />
      <div className="body">
        <nav className="sidebar">
          {NAV.map((g) => (
            <div className="group" key={g.group}>
              <div className="group-label">{g.group}</div>
              {g.items.map((it) => (
                <div key={it.id} className={`item ${page.id === it.id ? 'active' : ''}`} onClick={() => go(it.id)}>
                  <Icon name={it.icon} />
                  {it.label}
                </div>
              ))}
            </div>
          ))}
          <div className="spacer" />
          <div className="foot">Steez {version && `v${version}`}</div>
        </nav>
        <main className="page" key={page.id}>
          <div className="page-inner page-fade">
            <Suspense fallback={<div className="faint">Loading…</div>}>{view}</Suspense>
          </div>
        </main>
      </div>
      <MusicEngine go={go} />
      <Toaster />
    </div>
  );
}
