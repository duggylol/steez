import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/bricolage-grotesque';
import './styles/steez.css';
import App from './App.jsx';

// The Twitch Chat pop-out window, and the OBS dock (?dock=<key>), show only the chat.
const params = new URLSearchParams(location.search);
const dock = params.get('dock');
const popout = params.get('popout') === 'chat' || !!dock;
if (popout) {
  document.title = 'Twitch Chat · Steez';
  document.body.style.background = '#0e0e10';
}
const root = createRoot(document.getElementById('root'));
if (popout) import('./views/chat/TwitchChatPage.jsx').then(({ default: TwitchChatPage }) => root.render(<TwitchChatPage popout dock={dock} />));
else root.render(<App />);
