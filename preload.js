const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vf', {
  getVersion: () => ipcRenderer.invoke('app:version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  toggleDevTools: () => ipcRenderer.invoke('debug:devtools'),
  listSounds: () => ipcRenderer.invoke('sounds:list'),
  addSounds: () => ipcRenderer.invoke('sounds:add'),
  readSound: (name) => ipcRenderer.invoke('sounds:read', name),
  removeSound: (name) => ipcRenderer.invoke('sounds:remove', name),
  setHotkeys: (list) => ipcRenderer.invoke('hotkeys:set', list),
  onHotkey: (cb) => ipcRenderer.on('hotkey', (_e, action) => cb(action)),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_e, status) => cb(status)),
});
