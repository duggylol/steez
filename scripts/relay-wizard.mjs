// SteezBot relay setup — a local web page that walks through every step and checks each one.
// Run:  npm run relay:setup   (opens http://127.0.0.1:43210 in your browser)
//
// Uses the Cloudflare login from `wrangler login` (stored by wrangler on this PC) to deploy the
// relay through Cloudflare's API. The Twitch client secret is kept in memory only and sent
// straight to Cloudflare as an encrypted Worker secret — it is never written to disk.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELAY_DIR = path.join(ROOT, 'relay');
const TOML = path.join(RELAY_DIR, 'wrangler.toml');
const DEPLOYED = path.join(RELAY_DIR, 'deployed.json');
const SCRIPT_NAME = 'steez-relay';
const PORT = 43210;
const REDIRECT_PORT = 43111;
const CF = 'https://api.cloudflare.com/client/v4';
const BOT_SCOPES = ['user:bot', 'user:write:chat', 'user:read:chat'];

// ─── State (secret only in memory) ─────────────────────────────
const st = {
  clientId: tomlVar('TWITCH_CLIENT_ID'),
  botLogin: tomlVar('BOT_LOGIN'),
  secret: '',
  secretOk: false,
  bot: null, // { id, login, display, image }
  accountId: null,
  accountName: null,
  subdomain: null,
  relayUrl: readDeployed()?.url || null,
  relayOk: false,
  botAuthorized: false,
  busy: '',
  error: '',
  loginRunning: false,
};

function tomlVar(k) {
  try {
    return fs.readFileSync(TOML, 'utf8').match(new RegExp(`^${k} = "(.*)"`, 'm'))?.[1] || '';
  } catch {
    return '';
  }
}
function setTomlVar(k, v) {
  const s = fs.readFileSync(TOML, 'utf8').replace(new RegExp(`^${k} = ".*"`, 'm'), `${k} = "${v}"`);
  fs.writeFileSync(TOML, s);
}
function readDeployed() {
  try {
    return JSON.parse(fs.readFileSync(DEPLOYED, 'utf8'));
  } catch {
    return null;
  }
}

// ─── Cloudflare ─────────────────────────────────────────────────
const npx = (args, opts = {}) => spawnSync('npx', ['--yes', 'wrangler@4', ...args], { cwd: RELAY_DIR, shell: process.platform === 'win32', encoding: 'utf8', ...opts });

function wranglerConfigFile() {
  const candidates = [
    process.env.APPDATA && path.join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml'),
    path.join(os.homedir(), 'Library', 'Preferences', '.wrangler', 'config', 'default.toml'),
    path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), '.wrangler', 'config', 'default.toml'),
    path.join(os.homedir(), '.wrangler', 'config', 'default.toml'),
  ].filter(Boolean);
  return candidates.find((f) => fs.existsSync(f));
}

let refreshedAt = 0;
function cfToken() {
  const file = wranglerConfigFile();
  if (!file) return null;
  let s = fs.readFileSync(file, 'utf8');
  const exp = Date.parse(s.match(/^expiration_time = "(.*)"/m)?.[1] || '');
  if (exp && exp < Date.now() + 60_000 && Date.now() - refreshedAt > 30_000) {
    refreshedAt = Date.now();
    npx(['whoami']); // wrangler refreshes the stored login
    s = fs.readFileSync(file, 'utf8');
  }
  return s.match(/^oauth_token = "(.*)"/m)?.[1] || null;
}

async function cf(method, p, body, extraHeaders = {}) {
  const token = cfToken();
  if (!token) throw new Error('Not logged in to Cloudflare');
  const r = await fetch(CF + p, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
    body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) {
    const e = new Error(j.errors?.map((x) => x.message).join('; ') || `Cloudflare ${r.status}`);
    e.status = r.status;
    e.code = j.errors?.[0]?.code;
    throw e;
  }
  return j.result;
}

async function refreshCloudflare() {
  if (!cfToken()) {
    st.accountId = null;
    return;
  }
  try {
    const accounts = await cf('GET', '/accounts');
    const a = accounts?.[0];
    st.accountId = a?.id || null;
    st.accountName = a?.name || null;
    if (st.accountId) {
      try {
        st.subdomain = (await cf('GET', `/accounts/${st.accountId}/workers/subdomain`))?.subdomain || null;
      } catch (e) {
        if (e.status === 404 || e.code === 10007) st.subdomain = null;
        else throw e;
      }
    }
  } catch (e) {
    st.accountId = null;
    st.error = `Cloudflare: ${e.message}`;
  }
}

// ─── Twitch ─────────────────────────────────────────────────────
async function checkTwitch({ clientId, secret, botLogin }) {
  clientId = String(clientId || '').trim();
  secret = String(secret || '').trim() || st.secret;
  botLogin = String(botLogin || '').trim().replace(/^@/, '').toLowerCase();
  if (!clientId || !secret || !botLogin) throw new Error('Fill in all three fields.');
  const t = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: 'client_credentials' }),
  });
  if (!t.ok) {
    const j = await t.json().catch(() => ({}));
    throw new Error(
      /invalid client secret/i.test(j.message || '')
        ? 'Twitch says that secret is wrong. Click "New Secret" again and paste the new one.'
        : /invalid client/i.test(j.message || '')
          ? 'Twitch does not accept that Client ID + secret. The app must be Confidential.'
          : `Twitch: ${j.message || t.status}`,
    );
  }
  const { access_token } = await t.json();
  const u = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(botLogin)}`, { headers: { 'Client-Id': clientId, Authorization: `Bearer ${access_token}` } });
  const user = (await u.json()).data?.[0];
  if (!user) throw new Error(`No Twitch account called "${botLogin}".`);
  Object.assign(st, { clientId, secret, botLogin, secretOk: true, bot: { id: user.id, login: user.login, display: user.display_name, image: user.profile_image_url } });
  setTomlVar('TWITCH_CLIENT_ID', clientId);
  setTomlVar('BOT_LOGIN', botLogin);
}

// ─── Deploy ─────────────────────────────────────────────────────
async function deploy() {
  if (!st.accountId) throw new Error('Log in to Cloudflare first.');
  if (!st.subdomain) throw new Error('Choose your workers.dev address first.');
  if (!st.secretOk) throw new Error('Check your Twitch details first.');
  const code = fs.readFileSync(path.join(RELAY_DIR, 'src', 'index.js'), 'utf8');
  const compat = tomlVar('compatibility_date') || fs.readFileSync(TOML, 'utf8').match(/^compatibility_date = "(.*)"/m)?.[1] || '2026-10-01';
  const metadata = {
    main_module: 'index.js',
    compatibility_date: compat,
    bindings: [
      { type: 'plain_text', name: 'TWITCH_CLIENT_ID', text: st.clientId },
      { type: 'plain_text', name: 'BOT_LOGIN', text: st.botLogin },
      { type: 'plain_text', name: 'BLOCKED_CHANNELS', text: tomlVar('BLOCKED_CHANNELS') },
      { type: 'secret_text', name: 'TWITCH_CLIENT_SECRET', text: st.secret },
    ],
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('index.js', new Blob([code], { type: 'application/javascript+module' }), 'index.js');
  await cf('PUT', `/accounts/${st.accountId}/workers/scripts/${SCRIPT_NAME}`, form);
  await cf('POST', `/accounts/${st.accountId}/workers/scripts/${SCRIPT_NAME}/subdomain`, { enabled: true, previews_enabled: false });
  st.relayUrl = `https://${SCRIPT_NAME}.${st.subdomain}.workers.dev`;
  writeDeployed();
  // A brand-new workers.dev hostname can take a little while to answer.
  for (let i = 0; i < 20 && !st.relayOk; i++) {
    await checkRelay();
    if (!st.relayOk) await new Promise((r) => setTimeout(r, 3000));
  }
}

async function checkRelay() {
  if (!st.relayUrl) return;
  try {
    const r = await fetch(`${st.relayUrl}/v1/status`, { signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    st.relayOk = !!j.ok;
    if (j.ok) st.bot = { ...(st.bot || {}), ...j.bot };
  } catch {
    st.relayOk = false;
  }
}

function writeDeployed() {
  fs.writeFileSync(DEPLOYED, JSON.stringify({ url: st.relayUrl, clientId: st.clientId, botLogin: st.botLogin, botAuthorized: st.botAuthorized, updatedAt: new Date().toISOString() }, null, 2) + '\n');
}

// ─── Bot authorization (catches Twitch's redirect on localhost:43111) ─────────
let redirectServer = null;
function authorizeUrl() {
  const p = new URLSearchParams({ client_id: st.clientId, redirect_uri: `http://localhost:${REDIRECT_PORT}`, response_type: 'token', scope: BOT_SCOPES.join(' '), force_verify: 'true' });
  return `https://id.twitch.tv/oauth2/authorize?${p}`;
}
function startRedirectCatcher() {
  if (redirectServer) return;
  redirectServer = http.createServer(async (req, res) => {
    const u = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
    if (u.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(page('Checking…', `<script>location.replace('/capture?'+location.hash.slice(1))</script>`));
    }
    if (u.pathname === '/capture') {
      let msg;
      const token = u.searchParams.get('access_token');
      if (!token) msg = `Twitch said: ${u.searchParams.get('error_description') || 'no approval'}. Go back to the setup page and try again.`;
      else {
        const v = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token}` } }).then((r) => (r.ok ? r.json() : null));
        if (!v) msg = 'Twitch did not accept that approval. Try again.';
        else if (v.login !== st.botLogin) msg = `You approved as <b>${v.login}</b>, but the bot is <b>${st.botLogin}</b>. Log in to Twitch as ${st.botLogin} (a private window is easiest) and open the link again.`;
        else if (!BOT_SCOPES.every((s) => v.scopes.includes(s))) msg = 'Some permissions were missing. Open the link again and approve.';
        else {
          st.botAuthorized = true;
          writeDeployed();
          msg = `<b>${v.login}</b> is authorized. You can close this tab and go back to the setup page.`;
        }
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(page('SteezBot', msg));
    }
    res.writeHead(404);
    res.end();
  });
  redirectServer.on('error', (e) => {
    st.error = e.code === 'EADDRINUSE' ? 'Port 43111 is busy — close Steez and SongSeek while you authorize the bot, then click the button again.' : e.message;
    redirectServer = null;
  });
  redirectServer.listen(REDIRECT_PORT);
}
const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="margin:0;background:#141414;color:#e6e6e6;font:15px 'Segoe UI',system-ui;display:grid;place-items:center;height:100vh"><div style="border:1px solid #333;background:#1c1c1c;padding:28px 36px;max-width:520px;line-height:1.6"><div style="letter-spacing:.3em;font-weight:800;margin-bottom:12px">STEEZ</div>${body}</div>`;

// ─── Web UI + API ───────────────────────────────────────────────
const publicState = () => ({
  cloudflare: { loggedIn: !!st.accountId, account: st.accountName, subdomain: st.subdomain, loginRunning: st.loginRunning },
  twitch: { clientId: st.clientId, botLogin: st.botLogin, secretOk: st.secretOk, hasSecret: !!st.secret, bot: st.bot },
  relay: { url: st.relayUrl, ok: st.relayOk },
  botAuthorized: st.botAuthorized,
  authorizeUrl: st.clientId ? authorizeUrl() : null,
  busy: st.busy,
  error: st.error,
});

async function action(name, body) {
  st.error = '';
  switch (name) {
    case 'cf-login': {
      if (st.loginRunning) return;
      st.loginRunning = true;
      const p = spawn('npx', ['--yes', 'wrangler@4', 'login'], { cwd: RELAY_DIR, shell: process.platform === 'win32', stdio: 'ignore' });
      p.on('exit', async () => {
        st.loginRunning = false;
        await refreshCloudflare();
      });
      return;
    }
    case 'subdomain': {
      const name = String(body.name || '').toLowerCase().trim();
      if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name)) throw new Error('Use letters, numbers and dashes.');
      st.subdomain = (await cf('PUT', `/accounts/${st.accountId}/workers/subdomain`, { subdomain: name })).subdomain;
      return;
    }
    case 'twitch':
      return checkTwitch(body);
    case 'deploy':
      st.busy = 'deploy';
      try {
        return await deploy();
      } finally {
        st.busy = '';
      }
    case 'authorize':
      startRedirectCatcher();
      return;
    case 'check':
      await refreshCloudflare();
      return checkRelay();
    default:
      throw new Error('Unknown action');
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, data, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(type === 'application/json' ? JSON.stringify(data) : data);
  };
  // Only this page may call the API (blocks other sites from driving it via the browser).
  if (u.pathname.startsWith('/api/') && req.headers['x-wizard'] !== '1') return send(403, { error: 'forbidden' });
  if (u.pathname === '/') return send(200, UI, 'text/html; charset=utf-8');
  if (u.pathname === '/api/state') return send(200, publicState());
  if (u.pathname.startsWith('/api/action/') && req.method === 'POST') {
    let raw = '';
    for await (const c of req) raw += c;
    try {
      await action(u.pathname.split('/').pop(), raw ? JSON.parse(raw) : {});
      return send(200, publicState());
    } catch (e) {
      st.error = e.message;
      return send(400, publicState());
    }
  }
  send(404, { error: 'not found' });
});

const UI = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><title>SteezBot setup</title>
<style>
*{box-sizing:border-box;border-radius:0}
body{margin:0;background:#161616;color:#e6e6e6;font:14px/1.5 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif}
.wrap{max-width:780px;margin:0 auto;padding:36px 24px 60px}
.brand{letter-spacing:.32em;font-weight:800;font-size:13px;color:#cfcfcf}
h1{font-size:24px;font-weight:600;margin:6px 0 4px}
.sub{color:#9a9a9a;margin-bottom:26px}
.step{display:grid;grid-template-columns:34px 1fr;gap:16px;border:1px solid #2b2b2b;background:#1c1c1c;padding:18px 20px;margin-bottom:10px}
.step.locked{opacity:.45;pointer-events:none}
.num{width:34px;height:34px;border:1px solid #444;display:grid;place-items:center;font-weight:700;color:#9a9a9a}
.step.done .num{background:#d4d4d4;border-color:#d4d4d4;color:#141414}
.step h2{font-size:15px;margin:0 0 4px;font-weight:600}
.step p{margin:4px 0 10px;color:#a9a9a9}
.ok{color:#8fc08f}.bad{color:#e09a95}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}
input{background:#111;border:1px solid #383838;color:#e6e6e6;padding:8px 10px;font:inherit;min-width:0;flex:1}
input:focus{outline:none;border-color:#777}
label{display:block;font-size:11px;letter-spacing:.06em;color:#8a8a8a;margin:10px 0 4px;text-transform:uppercase}
button,a.btn{background:#242424;border:1px solid #3a3a3a;color:#e6e6e6;padding:8px 14px;font:inherit;cursor:pointer;text-decoration:none;white-space:nowrap}
button:hover,a.btn:hover{border-color:#5a5a5a;background:#2c2c2c}
button.primary{background:#d4d4d4;border-color:#d4d4d4;color:#121212;font-weight:600}
button.primary:hover{background:#f0f0f0}
button:disabled{opacity:.45;cursor:default}
ol{margin:6px 0;padding-left:18px;color:#bdbdbd}
code{background:#111;border:1px solid #2e2e2e;padding:1px 6px;font-family:Consolas,monospace;font-size:12.5px}
.err{border:1px solid #4f3432;border-left:3px solid #c9605a;background:#231b1a;padding:10px 14px;margin-bottom:12px;display:none}
.bot{display:flex;align-items:center;gap:10px;margin-top:8px}.bot img{width:32px;height:32px}
.done-box{border:1px solid #3c4d3c;border-left:3px solid #8fc08f;background:#1a201a;padding:16px 18px;display:none}
.spin{display:inline-block;width:10px;height:10px;border:2px solid #555;border-top-color:#d4d4d4;animation:s .8s linear infinite;vertical-align:-1px;margin-right:6px}
@keyframes s{to{transform:rotate(360deg)}}
</style></head><body><div class="wrap">
<div class="brand">STEEZ</div>
<h1>SteezBot setup</h1>
<div class="sub">Five steps. Each one checks itself — when the number turns light grey, move on.</div>
<div class="err" id="err"></div>

<div class="step" id="s1"><div class="num">1</div><div>
<h2>Cloudflare account</h2>
<p id="s1t">The relay runs on Cloudflare's free plan.</p>
<div class="row"><button class="primary" id="cfLogin">Log in to Cloudflare</button><span id="s1w" class="muted"></span></div>
</div></div>

<div class="step" id="s2"><div class="num">2</div><div>
<h2>Your workers.dev address</h2>
<p id="s2t">Pick a name for your free Cloudflare address (only needed once per Cloudflare account).</p>
<div class="row" id="s2form"><input id="sub" placeholder="e.g. steez" /><span>.workers.dev</span><button id="subSave">Save</button></div>
</div></div>

<div class="step" id="s3"><div class="num">3</div><div>
<h2>Twitch app and bot</h2>
<ol>
<li>Open <a class="btn" href="https://dev.twitch.tv/console/apps" target="_blank">dev.twitch.tv/console/apps</a> and click <b>Manage</b> on the Steez app.</li>
<li>Set <b>Client Type</b> to <b>Confidential</b> and save. (If Twitch won't allow that, create a new app: Confidential, redirect URL <code>http://localhost:43111</code>, and use its Client ID below.)</li>
<li>Click <b>New Secret</b> and paste it below.</li>
</ol>
<label>Client ID</label><input id="cid" />
<label>Client secret</label><input id="sec" type="password" placeholder="paste the new secret" autocomplete="off" />
<label>Bot's Twitch username</label><input id="bot" />
<div class="row"><button class="primary" id="twCheck">Check</button><span id="s3w"></span></div>
<div class="bot" id="botCard"></div>
</div></div>

<div class="step" id="s4"><div class="num">4</div><div>
<h2>Deploy the relay</h2>
<p id="s4t">Uploads the relay to your Cloudflare account. The secret is stored there encrypted.</p>
<div class="row"><button class="primary" id="deploy">Deploy</button><span id="s4w"></span></div>
</div></div>

<div class="step" id="s5"><div class="num">5</div><div>
<h2>Authorize the bot account</h2>
<p>Twitch needs the bot account to approve Steez once. <b>Close Steez and SongSeek first.</b></p>
<ol>
<li>Click <b>Copy link</b>.</li>
<li>Open a <b>private / incognito window</b> (Ctrl+Shift+N), log in to Twitch as <b id="botName">the bot</b>, paste the link, click <b>Authorize</b>.</li>
</ol>
<div class="row"><button class="primary" id="copyAuth">Copy link</button><button id="openAuth">Open in this browser</button><span id="s5w"></span></div>
</div></div>

<div class="done-box" id="done"><b>All done.</b> SteezBot is live at <code id="doneUrl"></code>. Go back to Claude and say it's finished — it will build this into Steez and publish.</div>
</div>
<script>
const $=id=>document.getElementById(id);
let S=null, typing=false;
async function call(name, body){
  const r=await fetch('/api/action/'+name,{method:'POST',headers:{'x-wizard':'1','Content-Type':'application/json'},body:JSON.stringify(body||{})});
  render(await r.json());
}
async function poll(){ try{ const r=await fetch('/api/state',{headers:{'x-wizard':'1'}}); render(await r.json()); }catch{} }
function mark(id, done, locked){ $(id).classList.toggle('done',!!done); $(id).classList.toggle('locked',!!locked); }
function render(s){
  S=s;
  $('err').style.display=s.error?'block':'none'; $('err').textContent=s.error||'';
  const cf=s.cloudflare, tw=s.twitch;
  mark('s1', cf.loggedIn, false);
  $('s1t').innerHTML = cf.loggedIn ? '<span class="ok">Logged in</span> — '+(cf.account||'')+'' : 'The relay runs on Cloudflare\'s free plan. A Cloudflare page opens — click <b>Allow</b>.';
  $('cfLogin').textContent = cf.loggedIn ? 'Switch account' : 'Log in to Cloudflare';
  $('s1w').innerHTML = cf.loginRunning ? '<span class="spin"></span>Waiting for you to click Allow…' : '';
  mark('s2', !!cf.subdomain, !cf.loggedIn);
  $('s2form').style.display = cf.subdomain ? 'none':'flex';
  $('s2t').innerHTML = cf.subdomain ? '<span class="ok">'+cf.subdomain+'.workers.dev</span>' : 'Pick a name for your free Cloudflare address (only needed once per Cloudflare account).';
  mark('s3', tw.secretOk, !cf.subdomain);
  if(!typing){ if(!$('cid').value) $('cid').value=tw.clientId||''; if(!$('bot').value) $('bot').value=tw.botLogin||''; }
  $('s3w').innerHTML = tw.secretOk ? '<span class="ok">Secret works</span>' : '';
  $('botCard').innerHTML = tw.bot ? (tw.bot.image?'<img src="'+tw.bot.image+'">':'')+'<span>'+tw.bot.display+'</span>' : '';
  mark('s4', s.relay.ok, !tw.secretOk);
  $('s4t').innerHTML = s.relay.ok ? '<span class="ok">Live</span> at <code>'+s.relay.url+'</code>' : s.relay.url ? 'Deployed to <code>'+s.relay.url+'</code> — waiting for it to come online…' : 'Uploads the relay to your Cloudflare account. The secret is stored there encrypted.';
  $('s4w').innerHTML = s.busy==='deploy' ? '<span class="spin"></span>Deploying…' : '';
  $('deploy').textContent = s.relay.url ? 'Deploy again' : 'Deploy';
  mark('s5', s.botAuthorized, !s.relay.ok);
  $('botName').textContent = tw.botLogin || 'the bot';
  $('s5w').innerHTML = s.botAuthorized ? '<span class="ok">'+(tw.botLogin)+' authorized</span>' : '';
  $('done').style.display = s.botAuthorized && s.relay.ok ? 'block':'none';
  $('doneUrl').textContent = s.relay.url||'';
}
for (const id of ['cid','sec','bot']) { $(id).addEventListener('focus',()=>typing=true); $(id).addEventListener('blur',()=>typing=false); }
$('cfLogin').onclick=()=>call('cf-login');
$('subSave').onclick=()=>call('subdomain',{name:$('sub').value});
$('twCheck').onclick=async()=>{ $('s3w').innerHTML='<span class="spin"></span>Checking…'; await call('twitch',{clientId:$('cid').value,secret:$('sec').value,botLogin:$('bot').value}); $('sec').value=''; };
$('deploy').onclick=()=>{ call('deploy'); setTimeout(poll,300); };
$('copyAuth').onclick=async()=>{ await call('authorize'); await navigator.clipboard.writeText(S.authorizeUrl); $('s5w').innerHTML='Link copied — paste it in a private window logged in as the bot. Waiting…'; };
$('openAuth').onclick=async()=>{ await call('authorize'); window.open(S.authorizeUrl,'_blank'); };
poll(); setInterval(poll, 2000);
</script></body></html>`;

server.listen(PORT, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`\nSteezBot setup is open in your browser: ${url}\n(Leave this window open until the page says "All done". Ctrl+C to quit.)\n`);
  await refreshCloudflare();
  await checkRelay();
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  if (!process.env.WIZARD_NO_OPEN) spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref();
});
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `The setup page is already running — open http://127.0.0.1:${PORT}` : e.message);
  process.exit(1);
});
