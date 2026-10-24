const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vf', {
  getVersion: () => ipcRenderer.invoke('app:version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  toggleDevTools: () => ipcRenderer.invoke('debug:devtools'),
  onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_e, status) => cb(status)),
});
