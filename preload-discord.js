// preload-discord.js — bridge for discord.html (the panel host page)
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('discordPanelAPI', {
  // From renderer → main
  close:       () => ipcRenderer.send('toggle'),
  muteChanged: (isMuted) => ipcRenderer.send('muteChanged', isMuted),
  setUsername: (name)    => ipcRenderer.send('setUsername', name),

  // From main → renderer
  onPrepareShow:     (cb) => ipcRenderer.on('panel:prepareShow', () => cb()),
  onSlideIn:         (cb) => ipcRenderer.on('panel:slideIn',     (_e, ms) => cb(ms)),
  onSlideOut:        (cb) => ipcRenderer.on('panel:slideOut',    (_e, ms) => cb(ms)),
  onSettingsChanged: (cb) => ipcRenderer.on('settings:changed',  (_e, v)  => cb(v))
})
