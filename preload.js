const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vf', {
  engineConfig: ipcRenderer.sendSync('engine:config'),
  sendEngine: (cmd) => ipcRenderer.invoke('engine:send', cmd),
  onEngineEvent: (cb) => ipcRenderer.on('engine:event', (_e, evt) => cb(evt)),
  getVersion: () => ipcRenderer.invoke('app:version'),
  restartApp: () => ipcRenderer.invoke('app:restart'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  toggleDevTools: () => ipcRenderer.invoke('debug:devtools'),
  listSounds: () => ipcRenderer.invoke('sounds:list'),
  addSounds: () => ipcRenderer.invoke('sounds:add'),
  readSound: (name) => ipcRenderer.invoke('sounds:read', name),
  removeSound: (name) => ipcRenderer.invoke('sounds:remove', name),
  listCatalog: () => ipcRenderer.invoke('catalog:list'),
  installPack: (id) => ipcRenderer.invoke('catalog:install', id),
  setHotkeys: (list) => ipcRenderer.invoke('hotkeys:set', list),
  onHotkey: (cb) => ipcRenderer.on('hotkey', (_e, action) => cb(action)),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_e, status) => cb(status)),
});
