// The one local web server: serves the Steez UI (YouTube embeds need a real http origin),
// every OBS overlay, the bot API, and all websockets. Bound to 127.0.0.1 only.
import http from 'node:http';
import express from 'express';

export const PREFERRED_PORT = 43112; // SongSeek's port, so existing SongSeek OBS sources keep working

export function createServer({ rendererDir, log }) {
  const app = express();
  app.disable('x-powered-by');
  const server = http.createServer(app);
  const upgrades = []; // { match(pathname) → bool, wss }
  const preRoutes = express.Router();
  app.use(preRoutes);

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    const hit = upgrades.find((u) => u.match(pathname));
    if (!hit) return socket.destroy();
    hit.wss.handleUpgrade(req, socket, head, (ws) => hit.wss.emit('connection', ws, req));
  });

  let port = null;
  const api = {
    app,
    http: server,
    router: preRoutes,
    get port() {
      return port;
    },
    url: (p = '/') => `http://127.0.0.1:${port}${p}`,
    /** Route websocket upgrades whose path matches to a ws.WebSocketServer({ noServer: true }). */
    addUpgrade(match, wss) {
      const fn = typeof match === 'function' ? match : (p) => p === match || p.startsWith(match + '/');
      upgrades.push({ match: fn, wss });
    },
    async listen() {
      // Static UI last, so module routes win.
      app.use(express.static(rendererDir, { index: 'index.html' }));
      app.use((req, res) => res.status(404).send('Not found'));
      const tryPort = (p) =>
        new Promise((resolve, reject) => {
          const onErr = (e) => {
            server.off('listening', onOk);
            reject(e);
          };
          const onOk = () => {
            server.off('error', onErr);
            resolve(p);
          };
          server.once('error', onErr);
          server.once('listening', onOk);
          server.listen(p, '127.0.0.1');
        });
      // A relaunch can race the previous instance's socket — retry the preferred port briefly.
      for (let i = 0; i < 8; i++) {
        try {
          port = await tryPort(PREFERRED_PORT);
          return port;
        } catch (e) {
          if (e.code !== 'EADDRINUSE') throw e;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      for (let p = PREFERRED_PORT + 1; p <= PREFERRED_PORT + 8; p++) {
        try {
          port = await tryPort(p);
          log?.warn?.(`Port ${PREFERRED_PORT} is busy — using ${p}. Re-copy overlay URLs into OBS.`);
          return port;
        } catch (e) {
          if (e.code !== 'EADDRINUSE') throw e;
        }
      }
      throw new Error('No free local port for Steez (43112-43120)');
    },
    close() {
      try {
        server.closeAllConnections?.();
        server.close();
      } catch {
        /* ignore */
      }
    },
  };
  return api;
}
