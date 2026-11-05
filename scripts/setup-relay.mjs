// One-time setup of the SteezBot relay on Cloudflare Workers.  Run:  npm run relay:setup
// It logs in to Cloudflare (browser), deploys relay/, stores the Twitch client secret as an
// encrypted Worker secret (typed by you, never written to disk), and checks the result.
import { spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relayDir = path.join(root, 'relay');
const tomlFile = path.join(relayDir, 'wrangler.toml');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const wrangler = (args, opts = {}) =>
  spawnSync('npx', ['--yes', 'wrangler@4', ...args], { cwd: relayDir, stdio: opts.capture ? 'pipe' : 'inherit', shell: process.platform === 'win32', encoding: 'utf8' });
const step = (n, text) => console.log(`\n\x1b[1m[${n}/5] ${text}\x1b[0m`);

let toml = fs.readFileSync(tomlFile, 'utf8');
const getVar = (k) => toml.match(new RegExp(`^${k} = "(.*)"`, 'm'))?.[1] || '';
const setVar = (k, v) => {
  toml = toml.replace(new RegExp(`^${k} = ".*"`, 'm'), `${k} = "${v}"`);
  fs.writeFileSync(tomlFile, toml);
};

console.log('\nSteezBot relay setup\n────────────────────');

step(1, 'Cloudflare login');
const who = wrangler(['whoami'], { capture: true });
if (/not authenticated|You are not logged in/i.test(`${who.stdout}${who.stderr}`) || who.status !== 0) {
  console.log('A browser window opens — log in to Cloudflare and click Allow.');
  if (wrangler(['login']).status !== 0) process.exit(1);
} else console.log('Already logged in.');

step(2, 'Twitch details');
const botLogin = ((await rl.question(`SteezBot's Twitch username${getVar('BOT_LOGIN') ? ` [${getVar('BOT_LOGIN')}]` : ''}: `)).trim() || getVar('BOT_LOGIN')).replace(/^@/, '').toLowerCase();
if (!/^[a-z0-9_]{3,25}$/.test(botLogin)) {
  console.error('That is not a valid Twitch username.');
  process.exit(1);
}
const clientId = (await rl.question(`Steez Twitch app Client ID [${getVar('TWITCH_CLIENT_ID')}]: `)).trim() || getVar('TWITCH_CLIENT_ID');
setVar('BOT_LOGIN', botLogin);
setVar('TWITCH_CLIENT_ID', clientId);

step(3, 'Deploy the relay');
if (wrangler(['deploy']).status !== 0) {
  console.error('Deploy failed. If Cloudflare asked you to pick a workers.dev subdomain, run "npm run relay:setup" again after choosing one.');
  process.exit(1);
}
let url = (await rl.question('\nPaste the https://steez-relay.<something>.workers.dev URL printed above: ')).trim().replace(/\/$/, '');
if (!/^https:\/\/[\w.-]+\.workers\.dev$/.test(url)) {
  console.error('That does not look like a workers.dev URL.');
  process.exit(1);
}

step(4, 'Twitch client secret');
console.log('Paste the Client Secret from dev.twitch.tv → your Steez app → New Secret (it is stored encrypted on Cloudflare only).');
rl.close(); // hand the terminal to wrangler's hidden prompt
if (wrangler(['secret', 'put', 'TWITCH_CLIENT_SECRET']).status !== 0) process.exit(1);

step(5, 'Check');
let ok = false;
try {
  const r = await fetch(`${url}/v1/status`);
  const j = await r.json();
  ok = !!j.ok;
  console.log(ok ? `Relay is live and found ${j.bot.display} (id ${j.bot.id}).` : `Relay answered: ${JSON.stringify(j)}`);
} catch (e) {
  console.log(`Could not reach the relay yet (${e.message}). It can take a minute after the first deploy.`);
}
fs.writeFileSync(path.join(relayDir, 'deployed.json'), JSON.stringify({ url, clientId, botLogin, deployedAt: new Date().toISOString() }, null, 2) + '\n');

console.log(`
Last step — authorize the bot account (once):
  1. In a browser, log in to Twitch as ${botLogin} (a private window works well).
  2. Open  ${url}/setup  and click Authorize.
  3. You will land on a "can't connect to localhost" page — that's expected; the approval is saved.

Saved relay/deployed.json. Tell Claude it's done so the relay URL gets built into Steez.
`);
process.exit(0);
