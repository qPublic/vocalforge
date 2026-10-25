const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const io = require('../renderer/preset-io');

// The real parameter table from the engine, so the tests follow the sliders.
const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'engine.js'), 'utf8');
const PARAMS = new Function(src.slice(src.indexOf('const PARAMS'), src.indexOf('const FLAT')) + '; return PARAMS;')();
const FLAT = Object.values(PARAMS).flat();
const defaults = Object.fromEntries(FLAT.map((p) => [p.id, p.def]));

test('a preset survives export and import unchanged', () => {
  const values = { ...defaults, eqLow: 4.5, compOn: false, nsOn: true, nsAmt: 60 };
  const parsed = io.parsePreset(io.serializePreset('Warm voice', values, FLAT), FLAT);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.name, 'Warm voice');
  assert.deepEqual(parsed.values, values);
  assert.equal(parsed.ignored, 0);
});

test('only known settings are kept, and numbers are clamped to the slider range', () => {
  const doc = { format: io.PRESET_FORMAT, version: 1, name: 'x', values: { inGain: 9999, gateThr: -9999, compOn: true, hpfOn: 'yes', evil: 1, eqLow: Infinity, makeup: '8' } };
  // JSON.stringify drops Infinity and a literal __proto__, so write those into the text by hand.
  const text = JSON.stringify(doc).replace('"values":{', '"values":{"__proto__":{"polluted":1},"eqLow":1e999,');
  const parsed = io.parsePreset(text, FLAT);
  assert.equal(parsed.ok, true);
  const inGain = FLAT.find((p) => p.id === 'inGain');
  const gateThr = FLAT.find((p) => p.id === 'gateThr');
  assert.equal(parsed.values.inGain, inGain.max);
  assert.equal(parsed.values.gateThr, gateThr.min);
  assert.equal(parsed.values.compOn, true);
  assert.ok(!('hpfOn' in parsed.values), 'a string is not a toggle');
  assert.ok(!('eqLow' in parsed.values), 'Infinity is not a number');
  assert.ok(!('makeup' in parsed.values), 'a numeric string is not a number');
  assert.ok(!('evil' in parsed.values));
  assert.equal(({}).polluted, undefined);
  assert.ok(parsed.ignored >= 4);
});

test('files that are not presets are refused with a readable message', () => {
  const bad = ['', 'not json', '[]', '{}', JSON.stringify({ format: 'other', version: 1, values: {} }),
    JSON.stringify({ format: io.PRESET_FORMAT, version: 2, values: { inGain: 1 } }),
    JSON.stringify({ format: io.PRESET_FORMAT, version: 1, values: [] }),
    JSON.stringify({ format: io.PRESET_FORMAT, version: 1, values: { nothing: 1 } }),
    'x'.repeat(io.MAX_PRESET_BYTES + 1)];
  for (const text of bad) {
    const r = io.parsePreset(text, FLAT);
    assert.equal(r.ok, false, text.slice(0, 40));
    assert.ok(r.error.length > 5);
  }
  assert.equal(io.parsePreset(null, FLAT).ok, false);
});

test('preset names are cleaned and never become dangerous object keys', () => {
  assert.equal(io.cleanPresetName('  Hi <b>there</b>\n'), 'Hi bthere/b');
  assert.equal(io.cleanPresetName('__proto__'), '');
  assert.equal(io.cleanPresetName('(custom)'), '');
  assert.equal(io.cleanPresetName('x'.repeat(100)).length, io.MAX_PRESET_NAME);
  const doc = { format: io.PRESET_FORMAT, version: 1, name: '__proto__', values: { inGain: 1 } };
  assert.equal(io.parsePreset(JSON.stringify(doc), FLAT).name, 'Imported preset');
});

test('a taken name gets a numbered suffix that still fits the length limit', () => {
  assert.equal(io.uniquePresetName('Warm', new Set()), 'Warm');
  assert.equal(io.uniquePresetName('Warm', new Set(['Warm'])), 'Warm (2)');
  assert.equal(io.uniquePresetName('Warm', new Set(['Warm', 'Warm (2)'])), 'Warm (3)');
  const long = 'y'.repeat(io.MAX_PRESET_NAME);
  const next = io.uniquePresetName(long, new Set([long]));
  assert.ok(next.length <= io.MAX_PRESET_NAME && next.endsWith('(2)'), next);
});

test('names that are already properties of every object are refused', () => {
  for (const bad of ['hasOwnProperty', 'valueOf', 'isPrototypeOf', '__defineGetter__', 'toLocaleString', 'propertyIsEnumerable']) {
    assert.equal(io.cleanPresetName(bad), '', bad);
  }
  assert.equal(io.cleanPresetName('valueOf extra'), 'valueOf extra', 'only the exact names are refused');
  const doc = { format: io.PRESET_FORMAT, version: 1, name: 'hasOwnProperty', values: { inGain: 1 } };
  assert.equal(io.parsePreset(JSON.stringify(doc), FLAT).name, 'Imported preset');
});

test('export file names are safe and never empty', () => {
  assert.equal(io.presetFileName('Warm podcast'), 'Warm podcast.vfpreset');
  assert.equal(io.presetFileName('CON'), '_CON.vfpreset');
  assert.equal(io.presetFileName('nul'), '_nul.vfpreset');
  assert.equal(io.presetFileName('lpt1'), '_lpt1.vfpreset');
  assert.equal(io.presetFileName(''), 'preset.vfpreset');
  assert.equal(io.presetFileName('...'), 'preset.vfpreset');
  assert.equal(io.presetFileName('  . '), 'preset.vfpreset');
  assert.equal(io.presetFileName('__proto__'), 'preset.vfpreset');
  assert.equal(io.presetFileName('a/b\\c:d*e?f"g|h'), 'a_b_c_d_e_f_g_h.vfpreset');
  assert.equal(io.presetFileName('Caf\u00e9 voice'), 'Caf\u00e9 voice.vfpreset');
});
