'use strict';
// Free Cloudflare "quick tunnel" so the TV and viewer pages (and Ko-fi webhooks) work from
// anywhere — no port forwarding, works even when the home network blocks the TV.
// Same idea as step 5 of the standalone app's "Fix TV Connection" tool, but run from Steez.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function findCloudflared() {
  const env = process.env;
  const dirs = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? ['cloudflared.exe'] : ['cloudflared'];
  for (const d of dirs) for (const n of names) {
    const p = path.join(d, n);
    if (fs.existsSync(p)) return p;
  }
  if (process.platform === 'win32') {
    const extra = [
      env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'cloudflared', 'cloudflared.exe'),
      env.ProgramFiles && path.join(env.ProgramFiles, 'cloudflared', 'cloudflared.exe'),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
    ].filter(Boolean);
    for (const p of extra) if (fs.existsSync(p)) return p;
    // winget installs into Packages\Cloudflare.cloudflared_*\cloudflared.exe without a PATH update for running apps
    try {
      const pk = env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
      if (pk && fs.existsSync(pk)) {
        for (const d of fs.readdirSync(pk)) {
          if (!/^Cloudflare\.cloudflared/i.test(d)) continue;
          const p = path.join(pk, d, 'cloudflared.exe');
          if (fs.existsSync(p)) return p;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * createTunnel({ getPort, onChange, log }) → { state(), start(), stop() }
 * state: { state: 'off'|'installing'|'starting'|'up'|'error', url, detail, installed }
 */
function createTunnel({ getPort, onChange, log }) {
  let proc = null;
  let st = { state: 'off', url: '', detail: '', installed: !!findCloudflared() };
  const set = (patch) => {
    st = { ...st, ...patch };
    try {
      onChange?.(st);
    } catch {
      /* ignore */
    }
  };

  function install() {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') return resolve(false);
      set({ state: 'installing', detail: 'Installing cloudflared with winget (one time)…' });
      let out = '';
      const p = spawn('winget', ['install', '--id', 'Cloudflare.cloudflared', '-e', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'], { windowsHide: true });
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (out += d));
      p.on('error', () => resolve(false));
      p.on('close', () => {
        log?.info?.('winget cloudflared: ' + out.trim().split(/\r?\n/).slice(-1)[0]);
        resolve(!!findCloudflared());
      });
    });
  }

  async function start() {
    if (proc) return st;
    const port = getPort();
    if (!port) {
      set({ state: 'error', detail: 'Turn on the TV & viewer server first.' });
      return st;
    }
    let exe = findCloudflared();
    if (!exe) {
      const ok = await install();
      exe = ok ? findCloudflared() : null;
      if (!exe) {
        set({ state: 'error', installed: false, detail: 'Could not install cloudflared. Install "App Installer" from the Microsoft Store (for winget), or get cloudflared from developers.cloudflare.com, then try again.' });
        return st;
      }
    }
    set({ state: 'starting', installed: true, url: '', detail: 'Starting the tunnel (5–10 seconds)…' });
    const p = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { windowsHide: true });
    proc = p;
    const onData = (buf) => {
      const text = String(buf);
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(text);
      if (m && st.state !== 'up') set({ state: 'up', url: m[0], detail: 'This address changes every time the tunnel starts.' });
      else if (/ ERR /.test(text) && st.state !== 'up') set({ detail: text.trim().split(/\r?\n/).pop().slice(0, 200) });
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', (e) => {
      if (proc === p) proc = null;
      set({ state: 'error', url: '', detail: e.message });
    });
    p.on('close', (code) => {
      if (proc !== p) return;
      proc = null;
      set(st.state === 'off' ? {} : { state: code ? 'error' : 'off', url: '', detail: code ? 'The tunnel stopped (code ' + code + ').' : '' });
    });
    return st;
  }

  function stop() {
    const p = proc;
    proc = null;
    if (p) {
      try {
        p.kill();
      } catch {
        /* ignore */
      }
    }
    set({ state: 'off', url: '', detail: '' });
    return st;
  }

  return { state: () => st, start, stop };
}

module.exports = { createTunnel, findCloudflared };
