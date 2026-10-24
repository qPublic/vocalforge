const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    backgroundColor: '#14161a',
    title: 'VocalForge',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });
  createWindow();
  setupUpdates();
});

app.on('window-all-closed', () => app.quit());

// ---------- updates (GitHub Releases) ----------
// The new version installs when the app quits, or right away via the "Restart to update" button.
const send = (status) => win && !win.isDestroyed() && win.webContents.send('update:status', status);

function setupUpdates() {
  ipcMain.handle('app:version', () => app.getVersion());

  if (!app.isPackaged) {
    ipcMain.handle('update:check', () => send({ state: 'dev', message: 'Updates are disabled in dev builds' }));
    ipcMain.handle('update:install', () => {});
    return;
  }

  const { autoUpdater } = require('electron-updater');
  autoUpdater.on('checking-for-update', () => send({ state: 'checking', message: 'Checking for updates…' }));
  autoUpdater.on('update-available', (i) => send({ state: 'downloading', message: `Downloading ${i.version}…` }));
  autoUpdater.on('update-not-available', () => send({ state: 'current', message: 'You are up to date' }));
  autoUpdater.on('download-progress', (p) =>
    send({ state: 'downloading', message: `Downloading update… ${Math.round(p.percent)}%` }));
  autoUpdater.on('update-downloaded', (i) =>
    send({ state: 'ready', message: `Version ${i.version} is ready`, version: i.version }));
  autoUpdater.on('error', (err) => send({ state: 'error', message: 'Update check failed: ' + err.message }));

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  ipcMain.handle('update:check', check);
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());
  win.webContents.once('did-finish-load', check);
  setInterval(check, 4 * 60 * 60 * 1000);
}
