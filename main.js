const { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, session, shell, Tray } = require('electron');
const path = require('path');
const sounds = require('./lib/sounds');
const hotkeys = require('./lib/hotkeys');
const appSettings = require('./lib/settings');
const catalog = require('./lib/catalog');

let win;
let tray;
let quitting = false;
let settings = appSettings.DEFAULTS;
const startHidden = process.argv.includes('--hidden');

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    backgroundColor: '#14161a',
    show: !startHidden,
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

  // With "close to tray" on, the close button hides the window and the mixer keeps running.
  win.on('close', (e) => {
    if (settings.closeToTray && !quitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('VocalForge');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show VocalForge', click: showWindow },
      { label: 'Mute / unmute mic', click: () => win && win.webContents.send('hotkey', 'mute') },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray.on('click', showWindow);
}

function applySettings() {
  // Only register a login item for the installed app, never for `npm start` (that would point at electron.exe).
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, args: settings.launchAtLogin ? ['--hidden'] : [] });
  }
}

// One running copy at a time: two would fight over the mic and the global hotkeys.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
      cb(permission === 'media' || permission === 'display-capture');
    });
    // Desktop audio: grant system loopback audio. The video track that getDisplayMedia needs is discarded by the page.
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const [screen] = await desktopCapturer.getSources({ types: ['screen'] });
        callback(screen ? { video: screen, audio: 'loopback' } : {});
      } catch {
        callback({});
      }
    });
    settings = appSettings.load(path.join(app.getPath('userData'), 'settings.json'));
    createWindow();
    createTray();
    applySettings();
    setupSettings();
    setupSoundboard();
    setupUpdates();
  });
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => (quitting = true));
app.on('will-quit', () => globalShortcut.unregisterAll());

// ---------- app settings (tray / startup) ----------
function setupSettings() {
  const file = path.join(app.getPath('userData'), 'settings.json');
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', (_e, patch) => {
    settings = appSettings.save(file, { ...settings, ...patch });
    applySettings();
    return settings;
  });
}

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

  // Curated catalog of sound packs (see lib/catalog.js). The renderer only names a pack id;
  // URLs always come from the validated catalog, never from the renderer.
  const fetchChecked = async (url, ms) => {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(ms) });
    // A redirect must not lead outside the allowed hosts.
    if (!catalog.ALLOWED_HOSTS.has(new URL(res.url || url).hostname)) throw new Error('unexpected redirect');
    return res;
  };
  const loadCatalog = async () => {
    const res = await fetchChecked(catalog.CATALOG_URL, 10000);
    if (!res.ok) throw new Error('Catalog unavailable (HTTP ' + res.status + ')');
    const body = await res.text();
    if (body.length > catalog.MAX_CATALOG_BYTES) throw new Error('Catalog is too large');
    return catalog.validate(JSON.parse(body));
  };
  ipcMain.handle('catalog:list', async () => {
    const have = new Set(sounds.list(soundsDir()).map((s) => s.name));
    const { packs } = await loadCatalog();
    return packs.map((p) => ({ id: p.id, name: p.name, author: p.author, license: p.license, description: p.description, clips: p.clips.map((c) => c.name), installed: p.clips.every((c) => have.has(c.name)) }));
  });
  ipcMain.handle('catalog:install', async (_e, packId) => {
    const { packs } = await loadCatalog();
    const pack = packs.find((p) => p.id === packId);
    if (!pack) throw new Error('Pack not found');
    return catalog.installPack(soundsDir(), pack, (url) => fetchChecked(url, 30000));
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
