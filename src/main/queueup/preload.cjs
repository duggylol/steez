'use strict';
// Exposes `window.hq` — the viewer queue + TikTok gifts API — to the Steez renderer.
// Loaded by src/main/preload.cjs. Window controls and Twitch login live on `window.steez`.
module.exports = ({ contextBridge, ipcRenderer, listen }) => {
  const call = (channel) => (arg) => ipcRenderer.invoke(channel, arg);

  contextBridge.exposeInMainWorld('hq', {
    getState: call('qu:getState'),
    getLogs: call('qu:getLogs'),

    addUser: call('qu:queue:add'),
    remove: call('qu:queue:remove'),
    move: (id, list, index) => ipcRenderer.invoke('qu:queue:move', { id, list, index }),
    promote: call('qu:queue:promote'),
    toTop: call('qu:queue:toTop'),
    clear: call('qu:queue:clear'),
    fillParty: call('qu:queue:fill'),
    nextGame: call('qu:queue:next'),

    updateSettings: call('qu:settings:update'),
    updateOverlay: call('qu:overlay:update'),
    resetOverlay: call('qu:overlay:reset'),

    tiktokConnect: call('qu:tiktok:connect'),
    tiktokDisconnect: call('qu:tiktok:disconnect'),
    giftsReset: call('qu:gifts:reset'),
    giftsSimulate: call('qu:gifts:simulate'),
    updateGiftOverlay: call('qu:giftOverlay:update'),
    resetGiftOverlay: call('qu:giftOverlay:reset'),
    statsManual: call('qu:tiktokStats:manual'),
    statsStyle: call('qu:tiktokStats:style'),
    statsResetStyle: call('qu:tiktokStats:resetStyle'),
    statsReset: call('qu:tiktokStats:reset'),

    copy: call('qu:util:copy'),
    openExternal: call('qu:util:openExternal'),
    confirm: call('qu:util:confirm'),

    onState: listen('qu:state'),
    onTwitch: listen('qu:twitch'),
    onLog: listen('qu:log'),
    onTikTok: listen('qu:tiktok'),
    onGifts: listen('qu:gifts'),
    onTiktokStats: listen('qu:tiktokStats'),
  });
};
