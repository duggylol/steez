import { useEffect, useState, Suspense, lazy } from 'react';
import { Icon, Toaster, Pill } from './ui.jsx';
import { connectBotSocket } from './lib/bot.js';
import BotPage from './views/bot/BotPage.jsx';
import Home from './views/Home.jsx';
import Settings from './views/Settings.jsx';
import Overlays from './views/Overlays.jsx';
import MusicEngine from './views/music/MusicEngine.jsx';
import { FeatureBanner, useFeatures, PAGE_FEATURE, refreshFeatures } from './lib/features.jsx';
import { SearchLauncher, SearchPalette } from './Search.jsx';

const MusicView = lazy(() => import('./views/music/MusicView.jsx'));
const QueueView = lazy(() => import('./views/queue/QueueView.jsx'));
const GiftsView = lazy(() => import('./views/queue/GiftsView.jsx'));
const SubathonPage = lazy(() => import('./views/subathon/SubathonPage.jsx'));
const ImportAccounts = lazy(() => import('./views/ImportAccounts.jsx'));
const ChestsPage = lazy(() => import('./views/chests/ChestsPage.jsx'));
const TwitchChatPage = lazy(() => import('./views/chat/TwitchChatPage.jsx'));

// Grouped by what you're doing, not by how Steez is built.
export const NAV = [
  { group: 'Home', items: [{ id: 'home', label: 'Dashboard', icon: 'home' }] },
  {
    group: 'On stream',
    items: [
      { id: 'overlays', label: 'OBS Overlays', icon: 'layers' },
      { id: 'alerts', label: 'Alerts & Events', icon: 'bell' },
      { id: 'subathon', label: 'Subathon', icon: 'hourglass' },
      { id: 'shop', label: 'Shop & Effects', icon: 'bag' },
      { id: 'hype', label: 'Hype & Clips', icon: 'fire' },
      { id: 'chests', label: 'Fortnite Chests', icon: 'chest' },
    ],
  },
  {
    group: 'Chat',
    items: [
      { id: 'chat', label: 'Twitch Chat', icon: 'chat' },
      { id: 'commands', label: 'Commands', icon: 'terminal' },
      { id: 'timers', label: 'Timers', icon: 'clock' },
      { id: 'quotes', label: 'Quotes', icon: 'quote' },
      { id: 'ai', label: 'AI', icon: 'spark' },
      { id: 'moderation', label: 'Moderation', icon: 'shield' },
      { id: 'modpanel', label: 'Mod Panel', icon: 'users' },
    ],
  },
  {
    group: 'Viewers',
    items: [
      { id: 'loyalty', label: 'Points & Viewers', icon: 'coin' },
      { id: 'games', label: 'Games', icon: 'dice' },
      { id: 'casino', label: 'Web Casino', icon: 'coin' },
      { id: 'giveaways', label: 'Giveaways', icon: 'gift' },
      { id: 'polls', label: 'Polls & Bets', icon: 'chart' },
      { id: 'achievements', label: 'Achievements', icon: 'trophy' },
      { id: 'queue', label: 'Viewer Queue', icon: 'queue' },
    ],
  },
  {
    group: 'Music & TikTok',
    items: [
      { id: 'music', label: 'Song Requests', icon: 'music' },
      { id: 'gifts', label: 'TikTok Gifts', icon: 'tiktok' },
    ],
  },
  {
    group: 'Insights',
    items: [
      { id: 'analytics', label: 'Analytics', icon: 'chart' },
      { id: 'logs', label: 'Logs', icon: 'log' },
    ],
  },
  {
    group: 'Setup',
    items: [
      { id: 'import', label: 'Import Accounts', icon: 'download' },
      { id: 'settings', label: 'Settings', icon: 'cog' },
    ],
  },
];
const ALL = NAV.flatMap((g) => g.items);
const BOT_PAGES = new Set(['commands', 'timers', 'moderation', 'loyalty', 'games', 'giveaways', 'polls', 'quotes', 'achievements', 'ai', 'modpanel', 'casino', 'alerts', 'shop', 'hype', 'analytics', 'logs']);

function TitleBar({ twitch, update, onSearch }) {
  const [max, setMax] = useState(false);
  useEffect(() => {
    window.steez.win.isMaximized().then(setMax);
    return window.steez.win.onMaximized(setMax);
  }, []);
  return (
    <div className="titlebar">
      <div className="brand">
        <span className={`dot ${twitch?.connected ? 'on' : ''}`} />
        Steez
      </div>
      <div className="crumbs">
        <SearchLauncher onOpen={onSearch} />
      </div>
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
  const features = useFeatures();
  const isOff = (id) => {
    const f = features.find((x) => x.id === PAGE_FEATURE[id]);
    return !!f && !f.on;
  };
  const [route, setRoute] = useState(() => location.hash.slice(1) || 'home');
  const [twitch, setTwitch] = useState(null);
  const [update, setUpdate] = useState(null);
  const [version, setVersion] = useState('');
  const [searching, setSearching] = useState(false);
  const [closed, setClosed] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('steez.nav.closed') || '[]');
    } catch {
      return [];
    }
  });
  const toggleGroup = (g) => {
    const next = closed.includes(g) ? closed.filter((x) => x !== g) : [...closed, g];
    setClosed(next);
    try {
      localStorage.setItem('steez.nav.closed', JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  // Ctrl+K (or /) opens search from anywhere.
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(input|textarea|select)$/i.test(e.target?.tagName || '') || e.target?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setSearching(true);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  // Settings forms on a page can flip a feature's own switch; re-read them when the page changes.
  useEffect(() => {
    refreshFeatures();
  }, [route]);

  const go = (id) => {
    location.hash = id;
  };
  const page = ALL.find((p) => p.id === route) || ALL[0];

  let view;
  if (page.id === 'home') view = <Home go={go} twitch={twitch} />;
  else if (page.id === 'music') view = <MusicView />;
  else if (page.id === 'queue') view = <QueueView />;
  else if (page.id === 'gifts') view = <GiftsView />;
  else if (page.id === 'subathon') view = <SubathonPage />;
  else if (page.id === 'overlays') view = <Overlays />;
  else if (page.id === 'import') view = <ImportAccounts go={go} />;
  else if (page.id === 'chests') view = <ChestsPage />;
  else if (page.id === 'chat') view = <TwitchChatPage />;
  else if (page.id === 'settings') view = <Settings twitch={twitch} update={update} />;
  else if (BOT_PAGES.has(page.id)) view = <BotPage key={page.id} id={page.id} />;

  return (
    <div className="app">
      <TitleBar twitch={twitch} update={update} onSearch={() => setSearching(true)} />
      <div className="body">
        <nav className="sidebar">
          {NAV.map((g) => (
            <div className={`group ${closed.includes(g.group) && !g.items.some((it) => it.id === page.id) ? 'closed' : ''}`} key={g.group}>
              {g.group !== 'Home' && (
                <div className="group-label" onClick={() => toggleGroup(g.group)} title={closed.includes(g.group) ? 'Show' : 'Hide'}>
                  {g.group}
                  <svg viewBox="0 0 12 12">
                    <path d="M3 4.5 6 7.5 9 4.5" />
                  </svg>
                </div>
              )}
              {g.items.map((it) => (
                <div key={it.id} className={`item ${page.id === it.id ? 'active' : ''} ${isOff(it.id) ? 'off' : ''}`} onClick={() => go(it.id)} title={isOff(it.id) ? 'Turned off' : undefined}>
                  <Icon name={it.icon} />
                  {it.label}
                  {isOff(it.id) && <span className="off-tag">off</span>}
                </div>
              ))}
            </div>
          ))}
          <div className="spacer" />
          <div className="foot">Steez {version && `v${version}`}</div>
        </nav>
        <main className="page" key={page.id}>
          <div className="page-inner page-fade">
            <FeatureBanner page={page.id} />
            <Suspense fallback={<div className="faint">Loading…</div>}>{view}</Suspense>
          </div>
        </main>
      </div>
      <MusicEngine go={go} />
      <SearchPalette open={searching} onClose={() => setSearching(false)} />
      <Toaster />
    </div>
  );
}
