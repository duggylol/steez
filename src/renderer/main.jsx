import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/bricolage-grotesque';
import './styles/steez.css';
import App from './App.jsx';

// The Twitch Chat pop-out window shows only the chat.
const popout = new URLSearchParams(location.search).get('popout') === 'chat';
if (popout) {
  document.title = 'Twitch Chat · Steez';
  document.body.style.background = '#0e0e10';
}
const root = createRoot(document.getElementById('root'));
if (popout) import('./views/chat/TwitchChatPage.jsx').then(({ default: TwitchChatPage }) => root.render(<TwitchChatPage popout />));
else root.render(<App />);
