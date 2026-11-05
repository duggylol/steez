import { useEffect, useRef } from 'react';
import { mountBotPage } from './botPages.js';

/** Hosts one of the chat-bot pages (vanilla DOM) inside the React shell. */
export default function BotPage({ id }) {
  const ref = useRef(null);
  useEffect(() => {
    let unmount = () => {};
    let alive = true;
    mountBotPage(id, ref.current).then((fn) => {
      if (alive) unmount = fn;
      else fn();
    });
    return () => {
      alive = false;
      unmount();
    };
  }, [id]);
  return <div ref={ref} />;
}
