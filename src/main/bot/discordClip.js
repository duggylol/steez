// Posts a new Twitch clip in the streamer's Discord through a webhook: the clip's video file
// when Twitch lets Steez download it and it fits Discord's upload limit, otherwise the link
// (Discord shows a player for Twitch clip links too).
import { db } from './store.js';
import { log } from './logger.js';
import * as api from './twitch/api.js';
import { getAccount } from './twitch/auth.js';

export const WEBHOOK_RE = /^https:\/\/(?:(?:canary|ptb)\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+\/?$/;
const MB = 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const S = () => db.settings.clips;
/** The webhook clips go to: their own, or the Discord webhook from Settings. */
export const clipWebhook = () => (S().discordWebhookUrl || '').trim() || (db.settings.discord?.webhookUrl || '').trim();
export const canDownloadClips = () => (getAccount('broadcaster')?.scopes || []).includes('channel:manage:clips');

/** Twitch needs a few seconds to finish a clip; ask for the file until it's there (about a minute at most). */
async function waitForFile(clipId, { tries = 12, every = 5000 } = {}) {
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(every);
    try {
      const url = await api.clipDownloadUrl(clipId);
      if (url) return url;
    } catch (e) {
      if (e.status === 401 || e.status === 403) throw e; // no permission: waiting won't help
    }
  }
  return null;
}

async function download(url, limit) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  const size = Number(r.headers.get('content-length')) || 0;
  if (size > limit) {
    r.body?.cancel?.();
    return { tooBig: size };
  }
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.length > limit ? { tooBig: buf.length } : { buf };
}

async function sendWebhook(webhook, content, file) {
  const url = `${webhook.replace(/\/$/, '')}?wait=true`;
  const payload = { content: content.slice(0, 2000), allowed_mentions: { parse: [] } };
  let body;
  let headers = {};
  if (file) {
    body = new FormData();
    body.append('payload_json', JSON.stringify({ ...payload, attachments: [{ id: 0, filename: file.name }] }));
    body.append('files[0]', new Blob([file.buf], { type: 'video/mp4' }), file.name);
  } else {
    body = JSON.stringify(payload);
    headers = { 'Content-Type': 'application/json' };
  }
  const r = await fetch(url, { method: 'POST', headers, body });
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    const err = new Error(j?.message ? `Discord said: ${j.message}` : `Discord answered ${r.status}`);
    err.status = r.status;
    throw err;
  }
}

/**
 * Post a clip in Discord. clip: { id, url, by, title, game }. Returns what happened:
 * { sent: 'video' | 'link', note? } — throws with a plain reason when nothing could be sent.
 */
export async function postClipToDiscord(bot, clip, { force = false, waitOpts } = {}) {
  const s = S();
  if (!force && !s.discordVideo) return null;
  const webhook = clipWebhook();
  if (!webhook) throw new Error('Add a Discord webhook link first.');
  if (!WEBHOOK_RE.test(webhook)) throw new Error('That doesn’t look like a Discord webhook link. It starts with https://discord.com/api/webhooks/');

  const ctx = { user: { display: clip.by || 'Someone', login: String(clip.by || '').toLowerCase() } };
  const text = await bot.render(s.discordMessage || '🎬 ${user} clipped it: <${clip}>', ctx, { clip: clip.url });
  const limit = Math.max(1, Number(s.discordUploadLimit) || 10) * MB;

  let note = '';
  if (!canDownloadClips()) note = 'Reconnect your Twitch account on the Overview page to let Steez download clip videos — sent the link instead.';
  else {
    try {
      const fileUrl = await waitForFile(clip.id, waitOpts);
      if (!fileUrl) note = 'Twitch hadn’t finished the clip video after a minute — sent the link instead.';
      else {
        const got = await download(fileUrl, limit);
        if (got.buf) {
          const name = `${(bot.state.channel || 'twitch').replace(/\W/g, '')}-clip-${String(clip.id).replace(/[^\w-]/g, '').slice(0, 60)}.mp4`;
          await sendWebhook(webhook, text, { buf: got.buf, name });
          return { sent: 'video' };
        }
        note = `The video is ${(got.tooBig / MB).toFixed(1)} MB, over your ${limit / MB} MB Discord upload limit — sent the link instead.`;
      }
    } catch (e) {
      if (e.status === 401 || e.status === 403) note = 'Twitch didn’t allow the download. Reconnect your Twitch account on the Overview page — sent the link instead.';
      else if (/^Discord/.test(e.message)) throw e;
      else note = `Couldn’t get the video (${e.message}) — sent the link instead.`;
    }
  }
  // The link: Discord shows a Twitch player for it.
  const linkText = text.includes(clip.url) ? text.replace(`<${clip.url}>`, clip.url) : `${text}\n${clip.url}`;
  await sendWebhook(webhook, linkText);
  if (note) log.warn(`Clip to Discord: ${note}`);
  return { sent: 'link', note };
}
