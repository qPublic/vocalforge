const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeEngineCommand: clean } = require('../lib/engine-cmd');

const HEX = 'abcdef0123456789';

test('commands without fields keep only the command and a valid id', () => {
  for (const name of ['hello', 'devices', 'stop', 'stopSounds', 'measure']) {
    assert.deepEqual(clean({ cmd: name, id: 4, path: 'C:/evil', extra: 1 }), { cmd: name, id: 4 });
  }
  assert.deepEqual(clean({ cmd: 'stop', id: -1 }), { cmd: 'stop' });
  assert.deepEqual(clean({ cmd: 'stop', id: 1.5 }), { cmd: 'stop' });
  assert.deepEqual(clean({ cmd: 'stop', id: '7' }), { cmd: 'stop' });
});

test('unknown commands and non-objects are refused, including quit', () => {
  for (const bad of [null, undefined, 'start', 7, [], { cmd: 5 }, { cmd: 'quit' }, { cmd: 'rm' }, { cmd: '__proto__' }, {}]) {
    assert.equal(clean(bad), null, JSON.stringify(bad));
  }
});

test('start: device ids must be default or hex, the buffer is clamped, unknown fields are dropped', () => {
  const ok = clean({ cmd: 'start', id: 1, input: 'default', output: HEX, bufferFrames: 100000, monitor: { on: true, device: HEX, evil: 1 }, path: 'x' });
  assert.deepEqual(ok, { cmd: 'start', id: 1, input: 'default', output: HEX, bufferFrames: 2048, monitor: { on: true, device: HEX } });
  assert.equal(clean({ cmd: 'start', bufferFrames: 1 }).bufferFrames, 64);
  assert.equal(clean({ cmd: 'start', bufferFrames: 240.6 }).bufferFrames, 241);
  assert.equal(clean({ cmd: 'start', input: '../../etc/passwd' }), null);
  assert.equal(clean({ cmd: 'start', output: { toString: () => 'default' } }), null);
  assert.equal(clean({ cmd: 'start', bufferFrames: 'big' }), null);
  assert.equal(clean({ cmd: 'start', monitor: 'yes' }), null);
  assert.equal(clean({ cmd: 'start', monitor: { device: 'zz!' } }), null);
  assert.equal(clean({ cmd: 'start', input: 'a'.repeat(1025) }), null);
  assert.deepEqual(clean({ cmd: 'start' }), { cmd: 'start' });
});

test('set: only plain settings of numbers and booleans, with sane key names', () => {
  assert.deepEqual(clean({ cmd: 'set', values: { eqLow: 3, nsOn: true, gateThr: -1e12 } }).values, { eqLow: 3, nsOn: true, gateThr: -1e6 });
  for (const values of [null, [], 'x', { a: 'str' }, { a: null }, { a: NaN }, { 'bad key': 1 }, { '1a': 2 }, { a: { b: 1 } }]) {
    assert.equal(clean({ cmd: 'set', values }), null, JSON.stringify(values));
  }
  assert.equal(clean({ cmd: 'set', values: Object.fromEntries(Array.from({ length: 65 }, (_, i) => ['k' + i, 1])) }), null);
});

test('levels, mute, desktop and output are checked and clamped', () => {
  assert.deepEqual(clean({ cmd: 'boardLevel', db: 99 }), { cmd: 'boardLevel', db: 12 });
  assert.deepEqual(clean({ cmd: 'desktopLevel', db: -500 }), { cmd: 'desktopLevel', db: -60 });
  assert.equal(clean({ cmd: 'boardLevel', db: '3' }), null);
  assert.equal(clean({ cmd: 'boardLevel' }), null);
  assert.deepEqual(clean({ cmd: 'mute', on: 'true' }), { cmd: 'mute', on: false }, 'only a real boolean turns it on');
  assert.deepEqual(clean({ cmd: 'mute', on: true }), { cmd: 'mute', on: true });
  assert.deepEqual(clean({ cmd: 'bypass', on: true }), { cmd: 'bypass', on: true });
  assert.deepEqual(clean({ cmd: 'bypass', on: 1 }), { cmd: 'bypass', on: false });
  assert.deepEqual(clean({ cmd: 'desktop', on: true, db: -6 }), { cmd: 'desktop', on: true, db: -6 });
  assert.equal(clean({ cmd: 'desktop', on: true, db: Infinity }), null);
  assert.deepEqual(clean({ cmd: 'output', device: 'default' }), { cmd: 'output', device: 'default' });
  assert.equal(clean({ cmd: 'output', device: 'not hex' }), null);
  assert.equal(clean({ cmd: 'output' }), null);
});

test('play: a clip name and a gain capped at 0 dB; a path from the renderer is never passed on', () => {
  assert.deepEqual(clean({ cmd: 'play', name: 'ding.wav', gain: 12, path: 'C:/Windows/x.wav' }), { cmd: 'play', name: 'ding.wav', gain: 0 });
  assert.deepEqual(clean({ cmd: 'play', name: 'a.wav', gain: -100 }), { cmd: 'play', name: 'a.wav', gain: -40 });
  assert.deepEqual(clean({ cmd: 'play', name: 'a.wav', gain: 'loud' }), { cmd: 'play', name: 'a.wav', gain: 0 });
  assert.equal(clean({ cmd: 'play' }), null);
  assert.equal(clean({ cmd: 'play', name: '' }), null);
  assert.equal(clean({ cmd: 'play', name: 'x'.repeat(201) }), null);
  assert.equal(clean({ cmd: 'play', path: 'C:/Windows/x.wav' }), null);
});
