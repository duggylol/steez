// YouTube / SoundCloud search + resolve, run in the main process (no CORS, no API keys).
// Results use the unified track shape: { source, sourceId, uri?, url?, title, artist, artwork, durationMs }.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ─── YouTube (results-page scrape) ───────────────────────────────

function parseDuration(text) {
  if (!text) return 0;
  const parts = text.split(':').map((n) => parseInt(n, 10));
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0) * 1000;
}

async function youtubeSearch(q) {
  const url =
    'https://www.youtube.com/results?search_query=' + encodeURIComponent(String(q || '')) + '&sp=' + encodeURIComponent('EgIQAQ=='); // videos only
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en', Cookie: 'CONSENT=YES+1' } });
  const html = await r.text();
  const m = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
  if (!m) throw new Error('YouTube search parsing failed');
  const data = JSON.parse(m[1]);
  const sections = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  const out = [];
  for (const section of sections) {
    for (const item of section.itemSectionRenderer?.contents || []) {
      const v = item.videoRenderer;
      if (!v || !v.videoId) continue;
      out.push({
        source: 'youtube',
        sourceId: v.videoId,
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
        title: (v.title?.runs || []).map((x) => x.text).join('') || 'Unknown title',
        artist: v.ownerText?.runs?.[0]?.text || 'YouTube',
        artwork: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
        durationMs: parseDuration(v.lengthText?.simpleText),
      });
      if (out.length >= 8) return out;
    }
  }
  return out;
}

async function youtubeResolve(videoId) {
  const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('Video not found or not embeddable');
  const j = await r.json();
  return {
    source: 'youtube',
    sourceId: videoId,
    url: watch,
    title: j.title,
    artist: j.author_name || 'YouTube',
    artwork: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    durationMs: 0, // filled in by the player once it loads
  };
}

// ─── SoundCloud (public web client_id, api-v2) ───────────────────

let scClientId = null;

async function getScClientId() {
  if (scClientId) return scClientId;
  const html = await (await fetch('https://soundcloud.com/', { headers: { 'User-Agent': UA } })).text();
  const scriptUrls = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).filter((u) => u.includes('sndcdn.com'));
  for (const u of scriptUrls.reverse()) {
    try {
      const m = (await (await fetch(u)).text()).match(/client_id\s*[:=]\s*"([A-Za-z0-9]{20,})"/);
      if (m) return (scClientId = m[1]);
    } catch {
      /* try the next script */
    }
  }
  throw new Error('Could not obtain a SoundCloud client id');
}

function mapScTrack(t) {
  return {
    source: 'soundcloud',
    sourceId: String(t.id),
    url: t.permalink_url,
    title: t.title,
    artist: (t.user && t.user.username) || 'SoundCloud',
    artwork: (t.artwork_url || (t.user && t.user.avatar_url) || '').replace('-large', '-t500x500'),
    durationMs: t.duration || 0,
  };
}

async function soundcloudSearch(q) {
  const cid = await getScClientId();
  const r = await fetch(`https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(String(q || ''))}&client_id=${cid}&limit=8`, {
    headers: { 'User-Agent': UA },
  });
  if (r.status === 401 || r.status === 403) {
    scClientId = null; // stale id — refetch next time
    throw new Error('SoundCloud rejected the client id, try again');
  }
  if (!r.ok) throw new Error(`SoundCloud search failed (${r.status})`);
  const j = await r.json();
  return (j.collection || []).filter((t) => t.kind === 'track' && t.streamable !== false).map(mapScTrack);
}

async function soundcloudResolve(url) {
  if (!/^https?:\/\/([a-z]+\.)?soundcloud\.com\//i.test(String(url))) throw new Error('Not a SoundCloud link');
  const cid = await getScClientId();
  const r = await fetch(`https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${cid}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('SoundCloud track not found');
  const j = await r.json();
  if (j.kind !== 'track') throw new Error('That SoundCloud link is not a track');
  return mapScTrack(j);
}

module.exports = { youtubeSearch, youtubeResolve, soundcloudSearch, soundcloudResolve };
