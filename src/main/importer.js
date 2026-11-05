// Finds data left by the standalone SongSeek and QueueUp apps so people who already
// set them up don't have to do it again. Read-only: the old apps' files are never changed.
import fs from 'node:fs';
import path from 'node:path';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Candidate userData folders (Electron names the folder after productName / package name). */
function candidates(appData, names) {
  return names.map((n) => path.join(appData, n));
}

export function findSongSeek(appData) {
  for (const dir of candidates(appData, ['SongSeek', 'songseek'])) {
    const data = readJson(path.join(dir, 'songseek.json'));
    if (data) return { dir, file: path.join(dir, 'songseek.json'), data };
  }
  return null;
}

export function findQueueUp(appData) {
  for (const dir of candidates(appData, ['QueueUp', 'queueup'])) {
    const data = readJson(path.join(dir, 'queueup-state.json'));
    if (data) return { dir, file: path.join(dir, 'queueup-state.json'), data, avatarsFile: path.join(dir, 'avatars.json') };
  }
  return null;
}

/** A short, secret-free description for the UI. */
export function describeImports(appData) {
  const ss = findSongSeek(appData);
  const qu = findQueueUp(appData);
  return {
    songseek: ss
      ? {
          found: true,
          spotify: !!ss.data.spotifyLibraryTokens,
          spotifyUser: ss.data.spotifyUser?.name || null,
          ownSpotifyApp: !!(ss.data.spotifyUserClientId || '').trim(),
          twitch: !!ss.data.twitchTokens,
          twitchUser: ss.data.twitchUser?.login || null,
          twitchClientId: !!ss.data.twitchClientId,
        }
      : { found: false },
    queueup: qu
      ? {
          found: true,
          queued: (qu.data.queue || []).length,
          party: (qu.data.party || []).length,
          overlay: !!qu.data.overlay,
          tiktok: qu.data.settings?.tiktokUsername || null,
        }
      : { found: false },
  };
}
