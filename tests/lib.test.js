const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sounds = require('../lib/sounds');
const hotkeys = require('../lib/hotkeys');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vf-test-'));

test('sounds.safeName rejects traversal, hidden files and unknown types', () => {
  assert.equal(sounds.safeName('airhorn.mp3'), 'airhorn.mp3');
  for (const bad of ['../x.mp3', String.raw`..\x.mp3`, 'a/b.mp3', '.hidden.mp3', 'virus.exe', '', String.raw`C:\x.wav`]) {
    assert.throws(() => sounds.safeName(bad), undefined, bad);
  }
});

test('sounds.add copies files, renames duplicates and skips bad ones', () => {
  const src = tmp();
  const lib = path.join(tmp(), 'sounds');
  fs.writeFileSync(path.join(src, 'a.mp3'), 'x');
  fs.writeFileSync(path.join(src, 'notes.txt'), 'x');
  const first = sounds.add(lib, [path.join(src, 'a.mp3'), path.join(src, 'notes.txt'), path.join(src, 'missing.wav')]);
  assert.deepEqual(first.added, ['a.mp3']);
  assert.equal(first.skipped.length, 2);
  const second = sounds.add(lib, [path.join(src, 'a.mp3')]);
  assert.deepEqual(second.added, ['a (2).mp3']);
  assert.deepEqual(sounds.list(lib).map((s) => s.name), ['a (2).mp3', 'a.mp3']);
});

test('sounds.read and remove stay inside the library', () => {
  const lib = tmp();
  fs.writeFileSync(path.join(lib, 'a.wav'), 'hello');
  assert.equal(sounds.read(lib, 'a.wav').toString(), 'hello');
  assert.throws(() => sounds.read(lib, '../a.wav'));
  assert.throws(() => sounds.remove(lib, String.raw`..\..\a.wav`));
  sounds.remove(lib, 'a.wav');
  assert.deepEqual(sounds.list(lib), []);
});

test('hotkeys.isValidAccelerator requires a modifier and a sane key', () => {
  for (const ok of ['Control+Alt+M', 'Shift+F5', 'Control+Numpad1', 'Alt+Space', 'CommandOrControl+Shift+9']) assert.ok(hotkeys.isValidAccelerator(ok), ok);
  for (const bad of ['M', 'F5', 'Control+', 'Hyper+M', 'Control+Alt+Mm', 'Control+Escape', '', null, 'a'.repeat(60)]) assert.ok(!hotkeys.isValidAccelerator(bad), String(bad));
});

test('hotkeys.sanitize drops invalid, duplicate and excess entries', () => {
  const out = hotkeys.sanitize([
    { accelerator: 'Control+Alt+M', action: 'mute' },
    { accelerator: 'Control+Alt+M', action: 'dupe' },
    { accelerator: 'M', action: 'bad' },
    { accelerator: 'Control+1', action: 5 },
    null,
  ]);
  assert.deepEqual(out, [{ accelerator: 'Control+Alt+M', action: 'mute' }]);
  assert.deepEqual(hotkeys.sanitize('nope'), []);
});
