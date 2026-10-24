const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../lib/catalog');

const root = path.join(__dirname, '..');
const raw = JSON.parse(fs.readFileSync(path.join(root, 'catalog', 'index.json'), 'utf8'));
const PREFIX = '/qPublic/vocalforge/main/';
const fileFor = (clip) => path.join(root, decodeURIComponent(new URL(clip.url).pathname.slice(PREFIX.length)));
const allClips = () => catalog.validate(raw).packs.flatMap((p) => p.clips.map((c) => ({ pack: p.id, ...c })));

test('the committed catalog is valid and nothing in it is dropped by validation', () => {
  const { packs } = catalog.validate(raw);
  assert.equal(packs.length, raw.packs.length);
  assert.ok(packs.length >= 6, 'expected several packs');
  for (const [i, pack] of packs.entries()) assert.equal(pack.clips.length, raw.packs[i].clips.length, pack.id);
});

test('every catalog clip exists in the repo at the path its URL points to', () => {
  for (const clip of allClips()) {
    assert.ok(new URL(clip.url).pathname.startsWith(PREFIX), `${clip.url} does not point at this repo's main branch`);
    const file = fileFor(clip);
    assert.ok(fs.existsSync(file), `${clip.name}: ${file} is missing`);
    assert.equal(path.basename(file), clip.name, 'clip name should match the file name');
  }
});

test('clip names are unique across all packs, so installing one never renames another', () => {
  const seen = new Map();
  for (const clip of allClips()) {
    assert.ok(!seen.has(clip.name), `${clip.name} is in both ${seen.get(clip.name)} and ${clip.pack}`);
    seen.set(clip.name, clip.pack);
  }
});

// Parses a 16-bit mono PCM WAV and returns its samples as numbers in -1..1.
function readWav(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.toString('latin1', 0, 4), 'RIFF', file);
  assert.equal(buf.toString('latin1', 8, 12), 'WAVE', file);
  let pos = 12;
  let fmt = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(pos + 8), channels: buf.readUInt16LE(pos + 10), rate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
    if (id === 'data') {
      const samples = new Float64Array(size / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(pos + 8 + i * 2) / 32768;
      return { fmt, samples };
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error('no data chunk in ' + file);
}

test('every clip is a real, audible, unclipped WAV of sensible length', () => {
  for (const clip of allClips()) {
    const { fmt, samples } = readWav(fileFor(clip));
    assert.deepEqual([fmt.format, fmt.channels, fmt.bits], [1, 1, 16], `${clip.name} should be 16-bit mono PCM`);
    const seconds = samples.length / fmt.rate;
    assert.ok(seconds >= 0.04 && seconds <= 4, `${clip.name} is ${seconds.toFixed(2)} s long`);
    let peak = 0;
    let sum = 0;
    for (const s of samples) {
      assert.ok(Number.isFinite(s));
      peak = Math.max(peak, Math.abs(s));
      sum += s * s;
    }
    const rms = Math.sqrt(sum / samples.length);
    assert.ok(peak > 0.5 && peak < 0.95, `${clip.name} peak ${peak.toFixed(2)} should be loud but not clipped`);
    assert.ok(rms > 0.005, `${clip.name} is nearly silent (rms ${rms.toFixed(4)})`);
  }
});

test('every pack declares a license and has a description', () => {
  for (const pack of catalog.validate(raw).packs) {
    assert.match(pack.license, /\S/);
    assert.ok(pack.description.length > 10, `${pack.id} needs a description`);
  }
});
