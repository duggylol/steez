'use strict';
// OBS browser sources for the viewer queue and the TikTok gifts tracker, mounted on the
// shared Steez server:
//   /overlay/queue            queue overlay (static files from ./overlay/queue)
//   /overlay/queue/api/state  first-paint JSON for it
//   /overlay/gifts            gifts overlay (static files from ./overlay/gifts)
//   /overlay/gifts/api/state  first-paint JSON for it
//   /overlay/tiktok-rank      daily gaming rank badge   (page + /api/state)
//   /overlay/tiktok-gallery   Gift Gallery badge         (page + /api/state)
//   /overlay/tiktok-stats/*   their shared script and stylesheet
//   /queueup-ws               live pushes to both overlays and the in-app previews
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const OVERLAY_DIR = path.join(__dirname, 'overlay');
const WS_PATH = '/queueup-ws';

/** The subset of state the queue overlay needs — never settings beyond the display bits. */
function publicState(store) {
  return {
    party: store.data.party,
    queue: store.data.queue,
    overlay: store.data.overlay,
    giftOverlay: store.data.giftOverlay,
    partySize: store.data.settings.partySize,
    hostName: store.data.settings.hostName,
    joinCommand: store.data.settings.joinCommand,
    serverTime: Date.now(),
  };
}

/**
 * @param {object} opts
 * @param {import('express').Router} opts.router  shared Steez router (mounted before the UI)
 * @param {(path: string, wss: WebSocketServer) => void} opts.addUpgrade
 * @param {object} opts.store       queueup Store
 * @param {() => object|null} opts.getGifts  gift snapshot + tiktok status
 * @param {() => object|null} [opts.getStats]  rank + gallery snapshot (tiktokStats.cjs)
 * @param {(entry: object) => void} [opts.onLog]
 */
function mountOverlays({ router, addUpgrade, store, getGifts, getStats, onLog }) {
  const giftState = (reason) => ({
    gifts: getGifts ? getGifts() : null,
    giftOverlay: store.data.giftOverlay,
    reason: reason || 'update',
    serverTime: Date.now(),
  });

  const statsState = (reason) => ({
    tiktokStats: getStats ? getStats() : null,
    reason: reason || 'update',
    serverTime: Date.now(),
  });

  // JSON endpoints first so the static handlers never shadow them.
  router.get('/overlay/queue/api/state', (_req, res) => res.json(publicState(store)));
  router.get('/overlay/gifts/api/state', (_req, res) => res.json(giftState()));
  router.get('/overlay/tiktok-rank/api/state', (_req, res) => res.json(statsState()));
  router.get('/overlay/tiktok-gallery/api/state', (_req, res) => res.json(statsState()));
  // Both badges are one script + stylesheet; the page only says which one it is.
  router.get('/overlay/tiktok-rank', (_req, res) => res.sendFile(path.join(OVERLAY_DIR, 'tiktok-stats', 'rank.html')));
  router.get('/overlay/tiktok-gallery', (_req, res) => res.sendFile(path.join(OVERLAY_DIR, 'tiktok-stats', 'gallery.html')));
  router.use('/overlay/tiktok-stats', express.static(path.join(OVERLAY_DIR, 'tiktok-stats'), { index: false }));
  router.use('/overlay/queue', express.static(path.join(OVERLAY_DIR, 'queue'), { index: 'index.html' }));
  router.use('/overlay/gifts', express.static(path.join(OVERLAY_DIR, 'gifts'), { index: 'index.html' }));

  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set();

  wss.on('error', (err) => onLog && onLog({ type: 'warn', text: 'Overlay socket error: ' + err.message }));

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
    safeSend(ws, { type: 'state', ...publicState(store) });
    safeSend(ws, { type: 'gifts', ...giftState() });
    if (getStats) safeSend(ws, { type: 'tiktokStats', ...statsState() });
  });

  addUpgrade(WS_PATH, wss);

  // Drop overlay sockets that OBS abandoned without closing cleanly.
  const sweep = setInterval(() => {
    for (const ws of clients) {
      if (ws.isAlive === false) {
        clients.delete(ws);
        try {
          ws.terminate();
        } catch (_) {
          /* already gone */
        }
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (_) {
        /* closed under us */
      }
    }
  }, 30000);
  sweep.unref?.();

  function broadcast(payload) {
    if (!clients.size) return;
    const data = JSON.stringify(payload);
    for (const ws of clients) {
      if (ws.readyState === 1) {
        try {
          ws.send(data);
        } catch (_) {
          /* closed under us */
        }
      }
    }
  }

  return {
    pushState: () => broadcast({ type: 'state', ...publicState(store) }),
    pushGifts: (reason) => broadcast({ type: 'gifts', ...giftState(reason) }),
    pushStats: (reason) => broadcast({ type: 'tiktokStats', ...statsState(reason) }),
    get clientCount() {
      return clients.size;
    },
    close() {
      clearInterval(sweep);
      for (const ws of clients) {
        try {
          ws.terminate();
        } catch (_) {
          /* ignore */
        }
      }
      clients.clear();
      try {
        wss.close();
      } catch (_) {
        /* ignore */
      }
    },
  };
}

function safeSend(ws, payload) {
  try {
    ws.send(JSON.stringify(payload));
  } catch (_) {
    /* closed under us */
  }
}

module.exports = { mountOverlays, publicState, WS_PATH };
