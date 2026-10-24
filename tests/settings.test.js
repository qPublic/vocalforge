const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const settings = require('../lib/settings');

test('settings: defaults, sanitizing, and round trip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-settings-'));
  const file = path.join(dir, 'nested', 'settings.json');
  assert.deepEqual(settings.load(file), { launchAtLogin: false, closeToTray: false });
  const saved = settings.save(file, { launchAtLogin: true, closeToTray: 'yes', evil: 1 });
  assert.deepEqual(saved, { launchAtLogin: true, closeToTray: false });
  assert.deepEqual(settings.load(file), { launchAtLogin: true, closeToTray: false });
  fs.writeFileSync(file, '{ not json');
  assert.deepEqual(settings.load(file), { launchAtLogin: false, closeToTray: false });
});
