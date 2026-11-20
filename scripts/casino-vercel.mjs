// Package the web casino for Vercel: the same pages and art as relay/casino-site, with Vercel
// forwarding /api/* to the Steez relay (which holds each streamer's live Steez connection).
//   node scripts/casino-vercel.mjs          → builds hosted/steez-casino/
//   node scripts/casino-vercel.mjs --deploy → builds and deploys it to production on Vercel
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'relay', 'casino-site');
const out = path.join(root, 'hosted', 'steez-casino');
const toml = fs.readFileSync(path.join(root, 'relay', 'wrangler.toml'), 'utf8');
const clientId = /TWITCH_CLIENT_ID\s*=\s*"([^"]+)"/.exec(toml)?.[1];
const relay = JSON.parse(fs.readFileSync(path.join(root, 'relay', 'deployed.json'), 'utf8')).url.replace(/\/$/, '');
if (!clientId || !relay) throw new Error('Missing the Twitch client ID or the relay URL');

// Fresh build, keeping Vercel's project link (.vercel) between deploys.
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (f !== '.vercel') fs.rmSync(path.join(out, f), { recursive: true, force: true });

const html = fs
  .readFileSync(path.join(site, 'index.html'), 'utf8')
  .replaceAll('__CLIENT_ID__', clientId)
  .replaceAll('__BASE__', '')
  .replaceAll('__AUTHORIZE__', 'https://id.twitch.tv/oauth2/authorize');
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.cpSync(site, path.join(out, 'static'), { recursive: true, filter: (src) => path.basename(src) !== 'index.html' });

const security = [
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
];
fs.writeFileSync(
  path.join(out, 'vercel.json'),
  JSON.stringify(
    {
      cleanUrls: false,
      trailingSlash: false,
      rewrites: [
        { source: '/api/:path*', destination: `${relay}/casino/api/:path*` },
        // every other path is a page of the app (files like /static/app.js are served before rewrites)
        { source: '/:path*', destination: '/index.html' },
      ],
      headers: [
        { source: '/(.*)', headers: security },
        { source: '/', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
        { source: '/static/(.*)', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
      ],
    },
    null,
    2,
  ),
);
console.log(`Built ${path.relative(root, out)} (API → ${relay}/casino/api)`);

// --redirect https://steezgames.xyz: replace the site with permanent redirects to that address
// (path kept), so links shared while the casino lived on Vercel keep working.
const to = process.argv[process.argv.indexOf('--redirect') + 1];
if (process.argv.includes('--redirect')) {
  if (!/^https:\/\/[^\s/]+$/.test(to || '')) throw new Error('--redirect needs an https:// address with no path');
  for (const f of fs.readdirSync(out)) if (f !== '.vercel') fs.rmSync(path.join(out, f), { recursive: true, force: true });
  fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta http-equiv="refresh" content="0;url=${to}"><a href="${to}">${to}</a>`);
  fs.writeFileSync(path.join(out, 'vercel.json'), JSON.stringify({ redirects: [{ source: '/:path*', destination: `${to}/:path*`, permanent: true }] }, null, 2));
  console.log(`Vercel site now redirects to ${to}`);
}

if (process.argv.includes('--deploy')) {
  execSync('npx --yes vercel@latest deploy --prod --yes', { cwd: out, stdio: 'inherit' });
}
