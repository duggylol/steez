// OBS "now playing" overlay, served on the shared Steez server:
//   GET /overlay         transparent, self-contained card that slides in on every song / !song
//   GET /overlay/events  SSE stream the page listens to ({ type: show | hide | ping })
//   GET /overlay/ping    liveness probe; lets a page loaded from disk find the app's port
// The paths match the standalone SongSeek, so existing OBS sources keep working.
const fs = require('fs');
const path = require('path');

const PORTS = [43112, 43113, 43114, 43115, 43116, 43117, 43118, 43119, 43120]; // Steez's port range

let clients = [];
let lastTrack = null;

function broadcast(payload) {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  clients = clients.filter((res) => {
    try {
      res.write(line);
      return true;
    } catch {
      return false;
    }
  });
}

/** New song (or null to clear). Shows the card on every connected overlay. */
function setTrack(track) {
  lastTrack = track
    ? {
        title: String(track.title || ''),
        artist: String(track.artist || ''),
        artwork: String(track.artwork || ''),
        requestedBy: track.requestedBy ? String(track.requestedBy) : null,
      }
    : null;
  broadcast(lastTrack ? { type: 'show', track: lastTrack } : { type: 'hide' });
}

/** Replay the slide-in for the current song (used by !song). */
function replay() {
  if (lastTrack) broadcast({ type: 'show', track: lastTrack });
}

function hide() {
  broadcast({ type: 'hide' });
}

const current = () => lastTrack;

// Open SSE streams are live sockets that would hold the port open on quit. The page treats the
// drop as a normal disconnect and reconnects itself.
function closeAll() {
  for (const res of clients) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
    try {
      res.socket && res.socket.destroy();
    } catch {
      /* ignore */
    }
  }
  clients = [];
}

// The page can also be loaded by OBS from a file on disk (origin "null"), so every overlay
// response is CORS-open.
const CORS = { 'Access-Control-Allow-Origin': '*' };

function mount(router) {
  router.get('/overlay', (_req, res) => {
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...CORS }).send(PAGE);
  });
  router.get('/overlay/ping', (_req, res) => {
    // The body is what overlay pages written by the standalone SongSeek look for.
    res.set({ 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache', ...CORS }).send('songseek');
  });
  router.get('/overlay/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...CORS });
    res.write(':ok\n\n');
    clients.push(res);
    // Catch a mid-song OBS (re)load up instantly.
    if (lastTrack) res.write(`data: ${JSON.stringify({ type: 'show', track: lastTrack })}\n\n`);
    // Real events (not SSE comments) so the page can detect a silently dead stream.
    const ka = setInterval(() => {
      try {
        res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
      } catch {
        clearInterval(ka);
      }
    }, 20000);
    const drop = () => {
      clearInterval(ka);
      clients = clients.filter((c) => c !== res);
    };
    req.on('close', drop);
    res.on('close', drop);
    res.on('error', drop);
  });
}

/**
 * Write the page to disk too: a file:// browser source ALWAYS loads (even when OBS starts before
 * Steez) and then waits for the app to come up — OBS never retries a URL source that failed.
 */
function writeOverlayFile(dir) {
  const file = path.join(dir, 'songseek-overlay.html');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, PAGE);
    return file;
  } catch {
    return null;
  }
}

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Now playing</title>
<style>
  html, body { margin: 0; background: transparent; overflow: hidden; height: 100%; }
  * { box-sizing: border-box; font-family: 'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif; }

  #card {
    position: absolute; left: 20px; top: 50%;
    display: flex; align-items: center; gap: 16px;
    padding: 12px 26px 12px 12px;
    background: rgba(22, 22, 22, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-left: 3px solid #d4d4d4;
    max-width: calc(100% - 40px);
    transform: translate(calc(-100% - 60px), -50%);
    opacity: 0;
    transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s ease;
    will-change: transform, opacity;
  }
  #card.show { transform: translate(0, -50%); opacity: 1; }
  #card.leaving {
    transition: transform 0.55s cubic-bezier(0.5, 0, 0.75, 0.2), opacity 0.4s ease 0.1s;
    transform: translate(calc(-100% - 60px), -50%);
    opacity: 0;
  }

  #art {
    flex: none; width: 84px; height: 84px; object-fit: cover; display: block; background: #2a2a2a;
    transform: scale(0.85); opacity: 0;
    transition: transform 0.45s cubic-bezier(0.22, 1, 0.36, 1) 0.15s, opacity 0.35s ease 0.15s;
  }
  #card.show #art { transform: scale(1); opacity: 1; }

  #meta { min-width: 0; padding-right: 4px; }
  #label, #title, #artist, #req {
    transform: translateX(-14px); opacity: 0;
    transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s ease;
  }
  #label { transition-delay: 0.22s; }
  #title { transition-delay: 0.28s; }
  #artist { transition-delay: 0.34s; }
  #req { transition-delay: 0.4s; }
  #card.show #label, #card.show #title, #card.show #artist, #card.show #req { transform: translateX(0); opacity: 1; }

  #label {
    display: flex; align-items: center; gap: 8px;
    font-size: 10.5px; font-weight: 700; letter-spacing: 2.4px; color: #a9a9a9; margin-bottom: 6px;
  }
  .eq { display: flex; align-items: flex-end; gap: 2px; height: 11px; }
  .eq i { width: 3px; background: #d4d4d4; animation: eq 0.9s ease-in-out infinite; transform-origin: bottom; }
  .eq i:nth-child(1) { height: 45%; animation-delay: -0.25s; }
  .eq i:nth-child(2) { height: 100%; animation-delay: -0.55s; }
  .eq i:nth-child(3) { height: 65%; }
  @keyframes eq { 0%, 100% { transform: scaleY(0.35); } 50% { transform: scaleY(1); } }

  #title {
    font-size: 23px; font-weight: 700; color: #f2f2f2; letter-spacing: -0.2px;
    max-width: 560px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  #artist {
    font-size: 15px; font-weight: 600; color: #a9a9a9; margin-top: 2px;
    max-width: 560px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  #req {
    display: none; margin-top: 8px; font-size: 11.5px; font-weight: 600; color: #d4d4d4;
    background: #262626; border: 1px solid #383838; padding: 2px 9px; width: fit-content;
    max-width: 420px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  #req.on { display: block; }

  /* Content swap while the card is already on screen. */
  #card.swap #art { animation: pop 0.4s cubic-bezier(0.22, 1, 0.36, 1); }
  @keyframes pop { from { transform: scale(0.88); opacity: 0.4; } to { transform: scale(1); opacity: 1; } }
</style>
</head>
<body>
  <div id="card">
    <img id="art" alt="" />
    <div id="meta">
      <div id="label"><span class="eq"><i></i><i></i><i></i></span>NOW PLAYING</div>
      <div id="title"></div>
      <div id="artist"></div>
      <div id="req"></div>
    </div>
  </div>
<script>
  const card = document.getElementById('card')
  const art = document.getElementById('art')
  const title = document.getElementById('title')
  const artist = document.getElementById('artist')
  const req = document.getElementById('req')
  const HOLD_MS = 7000
  let hideTimer = null

  function setContent(t) {
    title.textContent = t.title || ''
    artist.textContent = t.artist || ''
    if (t.artwork) { art.src = t.artwork; art.style.visibility = 'visible' }
    else { art.removeAttribute('src'); art.style.visibility = 'hidden' }
    if (t.requestedBy) { req.textContent = 'requested by ' + t.requestedBy; req.classList.add('on') }
    else { req.classList.remove('on'); req.textContent = '' }
  }

  function show(t) {
    clearTimeout(hideTimer)
    if (card.classList.contains('show')) {
      setContent(t)
      card.classList.remove('swap'); void card.offsetWidth; card.classList.add('swap')
    } else {
      setContent(t)
      card.classList.remove('leaving', 'swap'); void card.offsetWidth
      card.classList.add('show')
    }
    hideTimer = setTimeout(hide, HOLD_MS)
  }

  function hide() {
    clearTimeout(hideTimer)
    if (!card.classList.contains('show')) return
    card.classList.add('leaving')
    card.classList.remove('show')
    setTimeout(() => card.classList.remove('leaving'), 700)
  }

  // Connection: survives the app being closed, restarted, moved to a fallback port, or the
  // machine sleeping. It never gives up.
  const PORTS = ${JSON.stringify(PORTS)}
  const STALE_MS = 55000
  let base = location.protocol.indexOf('http') === 0 ? location.origin : null
  let es = null, watchdog = null, pending = null, lastBeat = 0

  function schedule(ms) {
    if (pending) return
    pending = setTimeout(() => { pending = null; connect() }, ms)
  }

  function probe(b) {
    return new Promise((resolve) => {
      let done = false
      const finish = (ok) => { if (!done) { done = true; resolve(ok) } }
      const timer = setTimeout(() => finish(false), 1500)
      fetch(b + '/overlay/ping', { cache: 'no-store' })
        .then((r) => { clearTimeout(timer); finish(r.ok) })
        .catch(() => { clearTimeout(timer); finish(false) })
    })
  }

  async function findBase() {
    if (base && (await probe(base))) return base
    for (const p of PORTS) {
      const b = 'http://127.0.0.1:' + p
      if (await probe(b)) return b
    }
    return null
  }

  function teardown() {
    try { if (es) { es.onerror = null; es.onmessage = null; es.close() } } catch (e) {}
    es = null
    clearInterval(watchdog); watchdog = null
  }

  async function connect() {
    teardown()
    const b = await findBase()
    if (!b) { schedule(2000); return }
    base = b
    try { es = new EventSource(b + '/overlay/events') } catch (e) { schedule(2000); return }
    lastBeat = Date.now()
    es.onopen = () => { lastBeat = Date.now() }
    es.onmessage = (e) => {
      lastBeat = Date.now()
      let msg; try { msg = JSON.parse(e.data) } catch (err) { return }
      if (msg.type === 'show' && msg.track) show(msg.track)
      else if (msg.type === 'hide') hide()
    }
    // Rebuild from scratch rather than trusting EventSource's retry: the app may come back
    // on a different port.
    es.onerror = () => schedule(2000)
    watchdog = setInterval(() => { if (Date.now() - lastBeat > STALE_MS) schedule(0) }, 10000)
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastBeat > STALE_MS) schedule(0)
  })
  window.addEventListener('online', () => schedule(0))

  connect()
</script>
</body>
</html>`;

module.exports = { mount, setTrack, replay, hide, current, closeAll, writeOverlayFile };
