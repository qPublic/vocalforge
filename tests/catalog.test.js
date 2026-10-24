const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const catalog = require('../lib/catalog');
const sounds = require('../lib/sounds');

const GOOD = 'https://raw.githubusercontent.com/qPublic/vocalforge/main/catalog/sounds/ding.wav';
const pack = (over = {}) => ({ id: 'starter', name: 'Starter', license: 'CC0-1.0', author: 'me', clips: [{ name: 'ding.wav', url: GOOD }], ...over });

test('catalog.validate keeps good packs and drops malformed ones', () => {
  const out = catalog.validate({
    packs: [
      pack(),
      pack({ id: 'Bad Id!' }),
      pack({ id: 'no-license', license: '' }),
      pack({ id: 'no-clips', clips: [] }),
      pack({ id: 'mixed', clips: [{ name: 'ok.mp3', url: GOOD }, { name: '../evil.mp3', url: GOOD }, { name: 'x.exe', url: GOOD }] }),
      null,
    ],
  });
  assert.deepEqual(out.packs.map((p) => p.id), ['starter', 'mixed']);
  assert.deepEqual(out.packs[1].clips.map((c) => c.name), ['ok.mp3']);
});

test('catalog.validate only accepts https clips from allowed hosts', () => {
  const urls = ['http://raw.githubusercontent.com/a.wav', 'https://evil.example.com/a.wav', 'https://user:pw@github.com/a.wav', 'ftp://github.com/a.wav', 'not a url', 'javascript:alert(1)'];
  for (const url of urls) {
    assert.equal(catalog.validate({ packs: [pack({ clips: [{ name: 'a.wav', url }] })] }).packs.length, 0, url);
  }
  assert.equal(catalog.validate({ packs: [pack({ clips: [{ name: 'a.wav', url: 'https://github.com/qPublic/vocalforge/releases/download/x/a.wav' }] })] }).packs.length, 1);
});

test('catalog.validate rejects documents that are not catalogs', () => {
  for (const bad of [null, 5, 'x', {}, { packs: 'no' }]) assert.throws(() => catalog.validate(bad), /catalog/);
});

const fakeRes = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  arrayBuffer: async () => Uint8Array.from(body).buffer,
});

test('catalog.installPack saves clips, reports failures, and renames duplicates', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-cat-'));
  const p = catalog.validate({
    packs: [pack({ clips: [{ name: 'a.wav', url: GOOD }, { name: 'b.wav', url: GOOD + '?b' }, { name: 'c.wav', url: GOOD + '?c' }, { name: 'd.wav', url: GOOD + '?d' }] })],
  }).packs[0];
  const responses = {
    [GOOD]: fakeRes(200, [1, 2, 3]),
    [GOOD + '?b']: fakeRes(404, []),
    [GOOD + '?c']: fakeRes(200, [9], { 'content-length': String(sounds.MAX_BYTES + 1) }),
    [GOOD + '?d']: fakeRes(200, []),
  };
  const result = await catalog.installPack(dir, p, async (url) => responses[url]);
  assert.deepEqual(result.added, ['a.wav']);
  assert.deepEqual(result.failed.map((f) => f.file), ['b.wav', 'c.wav', 'd.wav']);

  const again = await catalog.installPack(dir, p, async () => fakeRes(200, [7]));
  assert.ok(again.added.includes('a (2).wav'), again.added.join());
});
