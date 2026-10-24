const { app, BrowserWindow, session } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    backgroundColor: '#14161a',
    title: 'VocalForge',
    webPreferences: { contextIsolation: true, backgroundThrottling: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });
  createWindow();
  if (app.isPackaged) checkForUpdates();
});

// Updates come from GitHub Releases; the new version installs when the app quits.
function checkForUpdates() {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.on('error', (err) => console.error('update check failed:', err.message));
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

app.on('window-all-closed', () => app.quit());
