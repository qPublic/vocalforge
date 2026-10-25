const test = require('node:test');
const assert = require('node:assert/strict');
const { nextZoom, MIN, MAX } = require('../lib/zoom');

const key = (k, extra = {}) => ({ type: 'keyDown', control: true, key: k, code: '', ...extra });

test('zoom: Ctrl+= , Ctrl+Plus and the numpad plus all zoom in; Ctrl+- zooms out; Ctrl+0 resets', () => {
  assert.equal(nextZoom(key('=', { code: 'Equal' }), 0), 0.5, 'Ctrl+= (no Shift) is the one that used to do nothing');
  assert.equal(nextZoom(key('+', { shift: true }), 0), 0.5);
  assert.equal(nextZoom(key('Add', { code: 'NumpadAdd' }), 1), 1.5);
  assert.equal(nextZoom(key('-', { code: 'Minus' }), 0), -0.5);
  assert.equal(nextZoom(key('Subtract', { code: 'NumpadSubtract' }), 0), -0.5);
  assert.equal(nextZoom(key('0'), -2.5), 0);
});

test('zoom: it stays within limits, and ignores other keys and key releases', () => {
  assert.equal(nextZoom(key('-'), MIN), MIN);
  assert.equal(nextZoom(key('='), MAX), MAX);
  assert.equal(nextZoom(key('a'), 0), null);
  assert.equal(nextZoom({ type: 'keyUp', control: true, key: '=' }, 0), null);
  assert.equal(nextZoom({ type: 'keyDown', control: false, key: '=' }, 0), null, 'needs Ctrl');
  assert.equal(nextZoom(key('=', { alt: true }), 0), null, 'Ctrl+Alt belongs to the global hotkeys');
});
