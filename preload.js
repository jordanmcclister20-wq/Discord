// preload.js — bridge for tab.html
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Actions
  toggle:    () => ipcRenderer.send('toggle'),
  expand:    () => ipcRenderer.send('expand'),
  collapse:  () => ipcRenderer.send('collapse'),
  mute:      () => ipcRenderer.send('mute'),
  leaveCall: () => ipcRenderer.send('leaveCall'),
  quit:      () => ipcRenderer.send('quit'),

  // Settings
  getSettings:    () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.send('settings:update', patch),

  // Listeners
  onState:           (cb) => ipcRenderer.on('state',            (_e, v) => cb(v)),
  onMuteState:       (cb) => ipcRenderer.on('muteState',        (_e, v) => cb(v)),
  onUsername:        (cb) => ipcRenderer.on('username',         (_e, v) => cb(v)),
  onSettingsChanged: (cb) => ipcRenderer.on('settings:changed', (_e, v) => cb(v))
})
