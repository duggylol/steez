// Always-mounted (renders nothing) part of song requests: boots the engine that handles incoming
// requests and keeps Spotify control + YouTube/SoundCloud playback alive on every page.
import { useEffect } from 'react';
import { bootMusic } from './engine.js';

export default function MusicEngine({ go }) {
  useEffect(() => {
    bootMusic(go);
  }, [go]);
  return null;
}
