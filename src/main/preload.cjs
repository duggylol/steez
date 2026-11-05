// Exposes `window.steez` (shell API) and lets each feature module expose its own namespace
// from src/main/<module>/preload.cjs (e.g. window.songseek, window.hq for QueueUp).
const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

const listen = (channel) => (cb) => {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('steez', {
  info: () => ipcRenderer.invoke('steez:info'),
  settings: {
    get: () => ipcRenderer.invoke('steez:settings:get'),
    set: (patch) => ipcRenderer.invoke('steez:settings:set', patch),
  },
  overlays: () => ipcRenderer.invoke('steez:overlays'),
  imports: () => ipcRenderer.invoke('steez:imports'),
  twitch: {
    status: () => ipcRenderer.invoke('steez:twitch:status'),
    login: () => ipcRenderer.invoke('steez:twitch:login'),
    onStatus: listen('steez:twitch'),
  },
  update: {
    state: () => ipcRenderer.invoke('steez:update:state'),
    check: () => ipcRenderer.invoke('steez:update:check'),
    install: () => ipcRenderer.invoke('steez:update:install'),
    onState: listen('steez:update'),
  },
  open: (url) => ipcRenderer.invoke('steez:open', url),
  copy: (text) => ipcRenderer.invoke('steez:copy', text),
  openDataFolder: () => ipcRenderer.invoke('steez:openLogs'),
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close: () => ipcRenderer.invoke('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
    onMaximized: listen('win:maximized'),
  },
});

for (const mod of ['songseek', 'queueup']) {
  try {
    require(path.join(__dirname, mod, 'preload.cjs'))({ contextBridge, ipcRenderer, listen });
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') console.error(`[preload] ${mod}:`, e);
  }
}
