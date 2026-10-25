const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const settings = require('../lib/settings');

const D = { gameOnlyHotkeys: false, gameNeedsHiddenCursor: true, gameList: [...settings.DEFAULTS.gameList] };

test('settings: defaults, sanitizing, and round trip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-settings-'));
  const file = path.join(dir, 'nested', 'settings.json');
  assert.deepEqual(settings.load(file), { launchAtLogin: false, closeToTray: false, ...D });
  const saved = settings.save(file, { launchAtLogin: true, closeToTray: 'yes', evil: 1 });
  assert.deepEqual(saved, { launchAtLogin: true, closeToTray: false, ...D });
  assert.deepEqual(settings.load(file), { launchAtLogin: true, closeToTray: false, ...D });
  fs.writeFileSync(file, '{ not json');
  assert.deepEqual(settings.load(file), { launchAtLogin: false, closeToTray: false, ...D });
});
