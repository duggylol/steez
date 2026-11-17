// Where is the streamer's Steez right now? Steez posts its current public (tunnel) address here
// whenever it goes online or offline; the page at / reads it and shows the live viewer page.
// GET  /api/where            → { online, url, title, updatedAt }
// POST /api/where (x-steez-key) { url, title } → stores it ('' url = offline)
import { put, list, del } from '@vercel/blob';

const PREFIX = 'where/';
// Steez re-posts every few minutes while online; older than this means it closed without saying so.
const STALE_MS = 12 * 60 * 1000;

async function latest() {
  const { blobs } = await list({ prefix: PREFIX, limit: 100 });
  blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  return blobs;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const [newest] = await latest();
      if (!newest) return res.status(200).json({ online: false, url: '', title: '', channel: '' });
      const data = await (await fetch(newest.url, { cache: 'no-store' })).json();
      const fresh = Date.now() - (data.updatedAt || 0) < STALE_MS;
      return res.status(200).json({ online: !!(data.url && fresh), url: fresh ? data.url : '', title: data.title || '', channel: data.channel || '', updatedAt: data.updatedAt || 0 });
    }
    if (req.method === 'POST') {
      const key = String(req.headers['x-steez-key'] || '');
      if (!process.env.STEEZ_KEY || key !== process.env.STEEZ_KEY) return res.status(401).json({ error: 'Wrong key' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const url = String(body.url || '').trim().replace(/\/+$/, '');
      if (url && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url)) return res.status(400).json({ error: 'The address must be https://host' });
      const title = String(body.title || '').slice(0, 80);
      const channel = String(body.channel || '').replace(/[^a-z0-9_]/gi, '').slice(0, 25);
      const blob = await put(`${PREFIX}${Date.now()}.json`, JSON.stringify({ url, title, channel, updatedAt: Date.now() }), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: true,
        cacheControlMaxAge: 60,
      });
      // keep only the newest few
      const old = (await latest()).filter((b) => b.url !== blob.url).slice(2);
      if (old.length) await del(old.map((b) => b.url));
      return res.status(200).json({ ok: true, online: !!url });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET or POST' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Something went wrong' });
  }
}
