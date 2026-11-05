// Resolves a YouTube video to a directly playable audio stream with the bundled yt-dlp.
// Playing the raw stream sidesteps the embed restrictions that block many music videos in
// the IFrame player.
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

function createYtdlp(resourcesPath) {
  const bin = path.join(
    resourcesPath,
    'bin',
    `${process.platform}-${process.arch}`,
    process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp',
  );

  const run = (args, timeoutMs = 25000) =>
    new Promise((resolve, reject) => {
      if (!fs.existsSync(bin)) return reject(new Error('yt-dlp not found — YouTube playback is unavailable'));
      execFile(bin, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
        if (err && !stdout) return reject(new Error(String(err.message).split('\n')[0]));
        resolve(stdout);
      });
    });

  async function resolveStream(videoId) {
    const id = String(videoId || '');
    if (!/^[\w-]{11}$/.test(id)) throw new Error('Invalid YouTube video id');
    const url = `https://www.youtube.com/watch?v=${id}`;
    const j = JSON.parse(await run(['-f', 'bestaudio[acodec=opus]/bestaudio/best', '--no-playlist', '-J', url]));
    const streamUrl = j.url || (j.requested_formats && j.requested_formats[0] && j.requested_formats[0].url);
    if (!streamUrl) throw new Error('No audio stream found');
    const thumb =
      (j.thumbnails && j.thumbnails.length && j.thumbnails[j.thumbnails.length - 1].url) || `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
    return {
      source: 'youtube',
      sourceId: id,
      url,
      streamUrl,
      title: j.title || 'Unknown title',
      artist: j.uploader || j.channel || 'YouTube',
      artwork: thumb,
      durationMs: j.duration ? Math.round(j.duration * 1000) : 0,
    };
  }

  return { bin, resolveStream };
}

module.exports = { createYtdlp };
