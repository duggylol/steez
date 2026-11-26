import { useEffect, useRef } from 'react';
import { mountTwitchChat } from './twitchChat.js';

/** The Twitch Chat page inside Steez (the same view also runs alone in the pop-out window). */
export default function TwitchChatPage({ popout = false }) {
  const ref = useRef(null);
  useEffect(() => mountTwitchChat(ref.current, { popout }), [popout]);
  return <div ref={ref} />;
}
