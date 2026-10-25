// Loads the real renderer page in jsdom with fake Electron/Web Audio APIs, so UI flows can be tested
// without launching the app. Every script runs exactly as it does in the app.
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..', 'renderer');
const ORIGIN = 'http://localhost/';

// The page's scripts are inlined so jsdom needs no resource loader.
function pageHtml() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return html
    .replace(/<link rel="stylesheet"[^>]*>\s*/g, '')
    .replace(/<script src="([^"]+)"><\/script>/g, (_m, src) => {
      const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
      if (code.includes('</script')) throw new Error(src + ' contains a script end tag');
      return '<script>' + code + '\n//# sourceURL=' + src + '</script>';
    });
}

function fakeDevices(noCable) {
  return [
    { kind: 'audioinput', deviceId: 'mic1', label: 'Test Mic' },
    { kind: 'audiooutput', deviceId: 'out1', label: 'Test Speakers' },
    { kind: 'audiooutput', deviceId: 'cable', label: 'CABLE Input (VB-Audio Virtual Cable)' },
  ].filter((d) => !(noCable && d.deviceId === 'cable'));
}

// Returns { dom, window, errors, calls, settle }. `vf` overrides parts of the fake window.vf bridge.
async function loadApp({ vf = {}, store, noCable = false } = {}) {
  const errors = [];
  const calls = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push((e.detail && e.detail.stack) || e.message || String(e)));
  vc.on('error', (...a) => errors.push(a.join(' ')));

  const record = (name, fn) => (...args) => {
    calls.push([name, ...args]);
    return fn(...args);
  };
  const bridge = {
    getVersion: record('getVersion', async () => '0.0.0-test'),
    checkForUpdates: record('checkForUpdates', async () => {}),
    installUpdate: record('installUpdate', async () => {}),
    onUpdateStatus: () => {},
    openExternal: record('openExternal', async () => true),
    toggleDevTools: record('toggleDevTools', async () => {}),
    getSettings: record('getSettings', async () => ({ launchAtLogin: false, closeToTray: false, gameOnlyHotkeys: false, gameNeedsHiddenCursor: true, gameList: ['VALORANT-Win64-Shipping.exe'] })),
    setSettings: record('setSettings', async (p) => p),
    listSounds: record('listSounds', async () => []),
    addSounds: record('addSounds', async () => ({ added: [], skipped: [] })),
    readSound: record('readSound', async () => new Uint8Array(4)),
    removeSound: record('removeSound', async () => {}),
    listCatalog: record('listCatalog', async () => []),
    installPack: record('installPack', async () => ({ added: [], failed: [] })),
    setHotkeys: record('setHotkeys', async (l) => l.map((h) => ({ ...h, ok: true }))),
    onHotkey: () => {},
  };
  for (const [k, fn] of Object.entries(vf)) bridge[k] = record(k, fn);

  const dom = new JSDOM(pageHtml(), {
    url: ORIGIN + 'index.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.vf = bridge;
      window.alert = (m) => errors.push('alert: ' + m);
      // jsdom has no media playback or blob URLs.
      window.HTMLMediaElement.prototype.play = async function () {
        window.__played = (window.__played || 0) + 1;
        window.__lastVolume = this.volume;
      };
      window.HTMLMediaElement.prototype.pause = function () {};
      window.URL.createObjectURL = () => 'blob:test';
      window.URL.revokeObjectURL = () => {};
      window.HTMLDialogElement.prototype.showModal ||= function () { this.open = true; };
      window.HTMLDialogElement.prototype.close ||= function () { this.open = false; };
      Object.defineProperty(window.navigator, 'mediaDevices', {
        value: {
          enumerateDevices: async () => fakeDevices(noCable),
          getUserMedia: async () => ({ getTracks: () => [] }),
          addEventListener() {},
        },
      });
      if (store) window.localStorage.setItem('vocalforge.v1', JSON.stringify(store));
    },
  });
  const { window } = dom;

  const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  await settle(250); // let the async init (device list, wizard) finish
  return { dom, window, errors, calls, settle };
}

module.exports = { loadApp };
