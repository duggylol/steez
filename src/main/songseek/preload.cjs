// window.songseek — the renderer bridge for song requests. Every channel is `ss:`-prefixed.
module.exports = ({ contextBridge, ipcRenderer, listen }) => {
  const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

  contextBridge.exposeInMainWorld('songseek', {
    settings: {
      get: call('ss:settings:get'),
      set: call('ss:settings:set'),
    },
    spotify: {
      connect: call('ss:spotify:connect'),
      disconnect: call('ss:spotify:disconnect'),
      status: call('ss:spotify:status'),
      onStatus: listen('ss:spotify:status'),
      // Remote control of the user's own Spotify app.
      addToQueue: call('ss:spotify:addToQueue'),
      next: call('ss:spotify:next'),
      previous: call('ss:spotify:previous'),
      pause: call('ss:spotify:pause'),
      resume: call('ss:spotify:resume'),
      seek: call('ss:spotify:seek'),
      setVolume: call('ss:spotify:setVolume'),
      playContext: call('ss:spotify:playContext'),
      devices: call('ss:spotify:devices'),
      transfer: call('ss:spotify:transfer'),
      refresh: call('ss:spotify:refresh'),
      diagnose: call('ss:spotify:diagnose'),
      onState: listen('ss:spotify:state'),
      onQueue: listen('ss:spotify:queue'),
    },
    library: {
      status: call('ss:library:status'),
      playlists: call('ss:library:playlists'),
      tracks: call('ss:library:tracks'),
    },
    search: {
      spotify: call('ss:search:spotify'),
      youtube: call('ss:search:youtube'),
      soundcloud: call('ss:search:soundcloud'),
      resolveSpotify: call('ss:resolve:spotify'),
      resolveYoutube: call('ss:resolve:youtube'),
      resolveYoutubeStream: call('ss:resolve:youtubeStream'),
      resolveSoundcloud: call('ss:resolve:soundcloud'),
    },
    overlay: {
      update: call('ss:overlay:update'),
      show: call('ss:overlay:show'),
      hide: call('ss:overlay:hide'),
    },
    twitch: {
      status: call('ss:twitch:status'),
      say: call('ss:twitch:say'),
      onStatus: listen('ss:twitch:status'),
      onRequest: listen('ss:twitch:request'),
      onCommand: listen('ss:twitch:command'),
    },
    appInfo: call('ss:app:info'),
  });
};
