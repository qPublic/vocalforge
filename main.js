const { app, BrowserWindow, dialog, globalShortcut, ipcMain, session, shell } = require('electron');
const path = require('path');
const sounds = require('./lib/sounds');
const hotkeys = require('./lib/hotkeys');

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

// One running copy at a time: two would fight over the mic and the global hotkeys.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
      cb(permission === 'media');
    });
    createWindow();
    setupSoundboard();
    setupUpdates();
  });
}

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());

// ---------- soundboard + global hotkeys ----------
const soundsDir = () => path.join(app.getPath('userData'), 'sounds');

function setupSoundboard() {
  ipcMain.handle('sounds:list', () => sounds.list(soundsDir()));
  ipcMain.handle('sounds:read', (_e, name) => sounds.read(soundsDir(), name));
  ipcMain.handle('sounds:remove', (_e, name) => sounds.remove(soundsDir(), name));
  ipcMain.handle('sounds:add', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Add sounds',
      properties: ['openFile', 'multiSelect'],
      filters: [{ name: 'Audio', extensions: [...sounds.EXTENSIONS].map((e) => e.slice(1)) }],
    });
    return canceled ? { added: [], skipped: [] } : sounds.add(soundsDir(), filePaths);
  });

  // The renderer owns the hotkey map; each call replaces every registration.
  ipcMain.handle('hotkeys:set', (_e, list) => {
    globalShortcut.unregisterAll();
    return hotkeys.sanitize(list).map(({ accelerator, action }) => {
      let ok = false;
      try {
        ok = globalShortcut.register(accelerator, () => win && !win.isDestroyed() && win.webContents.send('hotkey', action));
      } catch {}
      return { accelerator, action, ok };
    });
  });
}

// ---------- updates (GitHub Releases) ----------
// The new version installs when the app quits, or right away via the "Restart to update" button.
const send = (status) => win && !win.isDestroyed() && win.webContents.send('update:status', status);

// Only these sites can be opened from the UI.
const ALLOWED_LINKS = ['https://vb-audio.com/Cable/', 'https://github.com/qPublic/vocalforge'];

function setupUpdates() {
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:open-external', (_e, url) => ALLOWED_LINKS.includes(url) && shell.openExternal(url));
  ipcMain.handle('debug:devtools', () => win.webContents.toggleDevTools());

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
  ipcMain.handle('update:check', async () => {
    await check();
  });
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());
  win.webContents.once('did-finish-load', check);
  setInterval(check, 4 * 60 * 60 * 1000);
}
