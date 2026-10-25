const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const foreground = require('../lib/foreground');
const settings = require('../lib/settings');

test('isGame matches process names case-insensitively and rejects blanks', () => {
  const games = ['VALORANT-Win64-Shipping.exe'];
  assert.equal(foreground.isGame('valorant-win64-shipping.exe', games), true);
  assert.equal(foreground.isGame('chrome.exe', games), false);
  assert.equal(foreground.isGame('', games), false);
  assert.equal(foreground.isGame(undefined, games), false);
});

test('sanitizeGames keeps plausible exe names only, deduplicated', () => {
  const out = foreground.sanitizeGames(['cs2.exe', 'CS2.EXE', 'C:\\evil\\x.exe', 'notexe', 7, '  r5apex.exe  ', 'a/b.exe']);
  assert.deepEqual(out, ['cs2.exe', 'r5apex.exe']);
  assert.deepEqual(foreground.sanitizeGames('nope'), [...foreground.DEFAULT_GAMES]);
  assert.ok(foreground.sanitizeGames(Array.from({ length: 200 }, (_, i) => `g${i}.exe`)).length <= 50);
});

test('settings keep a sanitized game list and the boolean toggle', () => {
  const s = settings.sanitize({ gameOnlyHotkeys: true, gameList: ['x.exe', '..\\y.exe'], launchAtLogin: 'yes' });
  assert.equal(s.gameOnlyHotkeys, true);
  assert.deepEqual(s.gameList, ['x.exe']);
  assert.equal(s.launchAtLogin, false);
  assert.equal(settings.sanitize({}).gameOnlyHotkeys, false);
});

test('watch reports each line the helper prints, even split across chunks', () => {
  if (process.platform !== 'win32') return;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.kill = () => (child.killed = true);
  const seen = [];
  const w = foreground.watch((n) => seen.push(n), () => child);
  child.stdout.emit('data', 'chrome.exe|0\nVALORANT-Win');
  child.stdout.emit('data', '64-Shipping.exe|1\r\n');
  assert.deepEqual(seen, [
    { name: 'chrome.exe', cursorHidden: false },
    { name: 'VALORANT-Win64-Shipping.exe', cursorHidden: true },
  ]);
  w.stop();
  assert.equal(child.killed, true);
});

test('the real watcher script starts and reports a foreground process', async () => {
  if (process.platform !== 'win32') return;
  const name = await new Promise((resolve) => {
    const w = foreground.watch((state) => {
      w.stop();
      resolve(state.name);
    });
    setTimeout(() => {
      w.stop();
      resolve(null);
    }, 15000);
  });
  assert.ok(name === '' || /\.exe$/i.test(name), `got ${name}`);
});
