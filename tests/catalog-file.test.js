const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../lib/catalog');

const root = path.join(__dirname, '..');
const raw = JSON.parse(fs.readFileSync(path.join(root, 'catalog', 'index.json'), 'utf8'));

test('the committed catalog is valid and nothing in it is dropped by validation', () => {
  const { packs } = catalog.validate(raw);
  assert.equal(packs.length, raw.packs.length);
  for (const [i, pack] of packs.entries()) assert.equal(pack.clips.length, raw.packs[i].clips.length, pack.id);
});

test('every catalog clip exists in the repo at the path its URL points to', () => {
  const prefix = '/qPublic/vocalforge/main/';
  for (const pack of catalog.validate(raw).packs) {
    for (const clip of pack.clips) {
      const url = new URL(clip.url);
      assert.ok(url.pathname.startsWith(prefix), `${clip.url} does not point at this repo's main branch`);
      const file = path.join(root, decodeURIComponent(url.pathname.slice(prefix.length)));
      assert.ok(fs.existsSync(file), `${clip.name}: ${file} is missing`);
      assert.equal(path.basename(file), clip.name, 'clip name should match the file name');
      assert.ok(fs.statSync(file).size > 1000, `${clip.name} looks empty`);
    }
  }
});

test('catalog clips are real WAV files', () => {
  for (const pack of catalog.validate(raw).packs) {
    for (const clip of pack.clips.filter((c) => c.name.endsWith('.wav'))) {
      const file = path.join(root, 'catalog', 'sounds', clip.name);
      const head = fs.readFileSync(file).subarray(0, 12).toString('latin1');
      assert.ok(head.startsWith('RIFF') && head.endsWith('WAVE'), `${clip.name} is not a WAV`);
    }
  }
});
