// Where is a streamer's Steez right now? Every Steez that has the subathon on owns one short id
// (it makes the id and a secret key itself). When its internet tunnel starts or stops, Steez posts
// the tunnel's address here; the page at /<id> reads it and shows that streamer's live viewer page.
//
// GET  /api/where?id=abc1234                          → { online, url, title, channel }
// POST /api/where  (x-steez-key) { id, url, title, channel }
//      The first post for an id claims it with that key; later posts must use the same key.
//
// Kept cheap on purpose: Steez only writes when its tunnel changes (no heartbeats), and reads are
// served from Vercel's cache for a few seconds. Whether the tunnel is actually up is checked by the
// viewer's browser, straight against the streamer's tunnel.
import { put } from '@vercel/blob';
import { createHash, timingSafeEqual } from 'node:crypto';

const ID_RE = /^[a-z0-9]{6,12}$/;
// Only Cloudflare quick-tunnel addresses: this link must never send viewers anywhere else.
const URL_RE = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;

const storeBase = () => {
  const token = process.env.BLOB_READ_WRITE_TOKEN || '';
  const storeId = token.split('_')[3] || '';
  return storeId ? `https://${storeId.toLowerCase()}.public.blob.vercel-storage.com` : '';
};
const pathOf = (id) => `where/${id}.json`;
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

async function read(id, fresh) {
  const base = storeBase();
  if (!base) throw new Error('Storage is not set up');
  const r = await fetch(`${base}/${pathOf(id)}${fresh ? `?v=${Date.now()}` : ''}`, { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Storage read failed (' + r.status + ')');
  return r.json();
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const id = String(req.query.id || '').toLowerCase();
      if (!ID_RE.test(id)) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(400).json({ error: 'Unknown link' });
      }
      const d = await read(id, false);
      // Short edge cache: lots of viewers polling one link cost one function call every few seconds.
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=10, stale-while-revalidate=30');
      if (!d) return res.status(200).json({ online: false, url: '', title: '', channel: '', known: false });
      return res.status(200).json({ online: !!d.url, url: d.url || '', title: d.title || '', channel: d.channel || '', known: true });
    }

    if (req.method === 'POST') {
      res.setHeader('Cache-Control', 'no-store');
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const id = String(body.id || '').toLowerCase();
      const key = String(req.headers['x-steez-key'] || '');
      if (!ID_RE.test(id)) return res.status(400).json({ error: 'Bad id' });
      if (key.length < 24) return res.status(401).json({ error: 'Missing key' });
      const url = String(body.url || '').trim().toLowerCase().replace(/\/+$/, '');
      if (url && !URL_RE.test(url)) return res.status(400).json({ error: 'Only Cloudflare tunnel addresses are allowed' });

      const current = await read(id, true);
      const keyHash = sha(key);
      if (current && current.keyHash) {
        const a = Buffer.from(current.keyHash, 'hex');
        const b = Buffer.from(keyHash, 'hex');
        if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(403).json({ error: 'This link belongs to another Steez' });
      }
      const record = {
        url,
        title: String(body.title || '').slice(0, 80),
        channel: String(body.channel || '').replace(/[^a-z0-9_]/gi, '').slice(0, 25),
        keyHash,
        updatedAt: Date.now(),
      };
      await put(pathOf(id), JSON.stringify(record), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
      });
      return res.status(200).json({ ok: true, online: !!url, claimed: !current });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET or POST' });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: e.message || 'Something went wrong' });
  }
}
