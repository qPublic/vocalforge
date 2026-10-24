const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { isValidAccelerator } = require('../lib/hotkeys');

// Load the renderer script with just enough stubs for its top-level code to run.
const ctx = vm.createContext({
  window: { vf: { onHotkey() {}, setHotkeys: async () => [] } },
  document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({}) },
  store: {},
  persist() {},
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'hotkeys.js'), 'utf8'), ctx);
const toAcc = (e) => ctx.eventToAccelerator({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...e });

test('eventToAccelerator builds accelerators from key codes', () => {
  assert.equal(toAcc({ code: 'KeyM', ctrlKey: true, altKey: true }), 'Control+Alt+M');
  assert.equal(toAcc({ code: 'Digit5', shiftKey: true }), 'Shift+5');
  assert.equal(toAcc({ code: 'F12', ctrlKey: true }), 'Control+F12');
  assert.equal(toAcc({ code: 'Numpad3', altKey: true }), 'Alt+Numpad3');
  assert.equal(toAcc({ code: 'ArrowUp', ctrlKey: true }), 'Control+Up');
  assert.equal(toAcc({ code: 'KeyA', metaKey: true }), 'Super+A');
});

test('eventToAccelerator rejects bare keys and modifier-only presses', () => {
  assert.equal(toAcc({ code: 'KeyM' }), null);
  assert.equal(toAcc({ code: 'ControlLeft', ctrlKey: true }), null);
  assert.equal(toAcc({ code: 'ShiftRight', shiftKey: true }), null);
  assert.equal(toAcc({ code: 'Escape', ctrlKey: true }), null);
});

test('every accelerator the UI can produce is accepted by the main-process validator', () => {
  const codes = ['KeyA', 'KeyZ', 'Digit0', 'Digit9', 'F1', 'F9', 'F10', 'F24', 'Numpad0', 'Numpad9', 'Space', 'Enter', 'NumpadEnter', 'Tab',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete',
    'Minus', 'Equal', 'Comma', 'Period', 'Slash', 'Semicolon', 'BracketLeft', 'BracketRight', 'Backquote', 'Quote'];
  for (const code of codes) {
    const acc = toAcc({ code, ctrlKey: true, shiftKey: true });
    assert.ok(acc, `${code} produced no accelerator`);
    assert.ok(isValidAccelerator(acc), `${code} -> ${acc} rejected by main-process validator`);
  }
});
