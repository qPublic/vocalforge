const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDiagnostics } = require('../renderer/diagnostics');

const base = {
  app: '0.1.0-beta.27',
  system: 'Windows_NT 10.0.26200 x64, Electron 45.0.0 (Chrome 140)',
  running: true,
  muted: false,
  raw: false,
  mic: 'Microphone (fifine Headset)',
  output: 'CABLE Input (VB-Audio Virtual Cable)',
  monitor: '',
  preset: 'Warm podcast',
  values: { eqLow: 4, eqMud: -2.5, nsOn: true, gateThr: -52 },
  defaults: { eqLow: 2, eqMud: -2.5, nsOn: false, gateThr: -52 },
  settings: { launchAtLogin: true, closeToTray: true, gameOnlyHotkeys: false },
  engine: {
    native: true, version: '0.1.0', backend: 'wasapi', buffer: 240,
    devices: { captureFrames: 480, capturePeriods: 3, playbackFrames: 480, playbackPeriods: 3, rate: 48000 },
    latencyMs: 42, latencyMeasured: true,
    stats: { underruns: 1, overruns: 0, monUnderruns: 0, micCushion: 336 },
  },
};

test('diagnostics: a native report lists versions, devices, counters and only the changed effects', () => {
  const t = buildDiagnostics(base);
  assert.match(t, /^VocalForge diagnostics/);
  assert.match(t, /Version: 0\.1\.0-beta\.27/);
  assert.match(t, /Engine: native 0\.1\.0 \(wasapi\)/);
  assert.match(t, /Mic: Microphone \(fifine Headset\)/);
  assert.match(t, /Monitor: off/);
  assert.match(t, /Device periods: capture 480 x3, playback 480 x3, 48000 Hz/);
  assert.match(t, /Delay: 42 ms \(measured\)/);
  assert.match(t, /Mic feed: 1 underruns, 0 overruns, 0 monitor underruns, cushion 336 samples/);
  assert.match(t, /Changed from default: eqLow=4, nsOn=true\n/);
  assert.ok(!/gateThr/.test(t), 'unchanged values are left out');
});

test('diagnostics: a web-engine report has no native-only lines, and says when nothing was changed', () => {
  const t = buildDiagnostics({ ...base, engine: { native: false, latencyMs: 30, latencyMeasured: false }, values: base.defaults });
  assert.match(t, /Engine: web \(Web Audio\)/);
  assert.match(t, /Delay: 30 ms \(estimated\)/);
  assert.ok(!/Buffer setting|Device periods|Mic feed/.test(t));
  assert.match(t, /Changed from default: nothing/);
});

test('diagnostics: it survives missing pieces instead of throwing', () => {
  assert.doesNotThrow(() => buildDiagnostics({}));
});
