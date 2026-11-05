import { toast } from '../../ui.jsx';

export function fmtTime(ms) {
  if (!ms || ms < 0 || !isFinite(ms)) return '0:00';
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export const SOURCE_LABEL = { spotify: 'Spotify', youtube: 'YouTube', soundcloud: 'SoundCloud' };
export const sourceLabel = (s) => SOURCE_LABEL[s] || 'Track';

/** Strip Electron's "Error invoking remote method 'x': Error: " prefix and make Spotify errors human. */
export function friendly(e) {
  const m = String((e && e.message) || e || 'Something went wrong').replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '');
  if (/no active spotify device/i.test(m)) return 'Open Spotify and start playing something first.';
  if (/premium/i.test(m)) return 'Spotify Premium is required to control playback.';
  if (/reconnect/i.test(m)) return 'Reconnect Spotify under Song Requests → Settings to allow playback control.';
  return m;
}

export const notify = (message) => toast(message);
export const notifyError = (message) => toast(message, { error: true });

/** Turn raw chat/redemption text into a structured request. */
export function parseRequest(text) {
  const t = (text || '').trim();
  if (!t) return null;

  const spotifyUri = t.match(/spotify:track:([A-Za-z0-9]{22})/);
  if (spotifyUri) return { type: 'spotify', id: spotifyUri[1] };

  const spotifyUrl = t.match(/open\.spotify\.com\/(?:intl-[\w-]+\/)?track\/([A-Za-z0-9]{22})/);
  if (spotifyUrl) return { type: 'spotify', id: spotifyUrl[1] };

  const yt = t.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?[^\s]*?v=|shorts\/|live\/|embed\/))([\w-]{11})/);
  if (yt) return { type: 'youtube', id: yt[1] };

  const sc = t.match(/https?:\/\/(?:www\.|on\.|m\.)?soundcloud\.com\/[^\s]+/);
  if (sc) return { type: 'soundcloud', url: sc[0].replace(/[),.\]]+$/, '') };

  return { type: 'query', q: t };
}
