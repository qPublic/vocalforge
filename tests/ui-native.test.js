// The real UI driven against a fake engine.exe: checks that the renderer speaks the engine protocol.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./ui-harness');

const SKIP_WIZARD = { setupDone: true };
const cmds = (log, name) => log.filter((c) => c.cmd === name);

test('native mode: device lists come from the engine, with the virtual cable preferred', async () => {
  const { window, errors, engineLog } = await loadApp({ native: true, store: SKIP_WIZARD });
  assert.deepEqual(errors, []);
  assert.equal(cmds(engineLog, 'devices').length, 1);
  const label = (id) => window.document.getElementById(id).selectedOptions[0].textContent;
  assert.equal([...window.document.getElementById('inSel').options].length, 2);
  assert.match(label('outSel'), /CABLE Input/);
  window.close();
});

test('native mode: Start sends the chosen devices and the current settings', async () => {
  const { window, errors, engineLog, settle } = await loadApp({ native: true, store: SKIP_WIZARD });
  window.document.getElementById('inSel').value = 'aa';
  window.document.getElementById('startBtn').click();
  await settle(60);
  const start = cmds(engineLog, 'start')[0];
  assert.ok(start, 'a start command should be sent');
  assert.equal(start.input, 'aa');
  assert.equal(start.output, 'bb');
  assert.equal(start.monitor.on, false);
  assert.equal(start.bufferFrames, 240);
  assert.equal(window.document.getElementById('startBtn').textContent, 'Stop');
  // After starting, the full settings are pushed so the engine matches the UI.
  const full = cmds(engineLog, 'set').find((c) => Object.keys(c.values).length > 20);
  assert.ok(full, 'full settings should be sent');
  assert.equal(full.values.gateThr, -52);
  assert.deepEqual(errors, []);

  window.document.getElementById('startBtn').click();
  await settle(60);
  assert.equal(cmds(engineLog, 'stop').length, 1);
  assert.equal(window.document.getElementById('startBtn').textContent, 'Start');
  window.close();
});

test('native mode: the buffer size setting is used', async () => {
  const { window, engineLog, settle } = await loadApp({ native: true, store: { ...SKIP_WIZARD, nativeBuffer: 128 } });
  window.document.getElementById('startBtn').click();
  await settle(60);
  assert.equal(cmds(engineLog, 'start')[0].bufferFrames, 128);
  window.close();
});

test('native mode: sliders, presets and the blown-out button send settings', async () => {
  const { window, engineLog, settle } = await loadApp({ native: true, store: SKIP_WIZARD });
  const slider = [...window.document.querySelectorAll('input[type=range]')].find((el) => el.min === '-90' && el.max === '-10');
  slider.value = '-44';
  slider.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.ok(engineLog.some((c) => c.cmd === 'set' && c.values.gateThr === -44), 'slider change is sent');

  window.document.getElementById('blownBtn').click();
  assert.ok(engineLog.some((c) => c.cmd === 'set' && c.values.lofiOn === true), 'blown-out toggle is sent');

  const preset = window.document.getElementById('presetSel');
  preset.value = 'Warm podcast';
  preset.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  const last = cmds(engineLog, 'set').pop();
  assert.equal(last.values.eqLow, 4, 'preset values are sent in full');
  window.close();
});

test('native mode: mute button and mute hotkey tell the engine', async () => {
  const { window, engineLog } = await loadApp({ native: true, store: SKIP_WIZARD });
  window.document.getElementById('muteBtn').click();
  assert.deepEqual({ ...cmds(engineLog, 'mute').pop() }, { cmd: 'mute', on: true });
  window.document.getElementById('muteBtn').click();
  assert.deepEqual({ ...cmds(engineLog, 'mute').pop() }, { cmd: 'mute', on: false });
  window.close();
});

test('native mode: meter events drive the on-screen meters', async () => {
  const { window, emitEngine, settle } = await loadApp({ native: true, store: SKIP_WIZARD });
  window.document.getElementById('startBtn').click();
  await settle(60);
  emitEngine({ event: 'meters', in: -12, out: -6, gr: -3.5, gate: 1, latencyMs: 12.4, underruns: 0, overruns: 0 });
  await settle(120);
  assert.equal(window.document.getElementById('inDb').textContent, '-12.0');
  assert.equal(window.document.getElementById('outDb').textContent, '-6.0');
  assert.equal(window.document.getElementById('grDb').textContent, '3.5');
  assert.equal(window.document.getElementById('lat').textContent, '12 ms');
  assert.equal(window.document.getElementById('gateState').textContent, 'open');
  window.close();
});

test('native mode: playing a pad sends the clip name, never a path', async () => {
  const { window, engineLog, settle } = await loadApp({ native: true, store: SKIP_WIZARD, vf: { listSounds: async () => [{ name: 'ding.wav', size: 5 }] } });
  window.document.getElementById('startBtn').click();
  await settle(60);
  window.document.querySelector('.padPlay').click();
  await settle(40);
  const play = cmds(engineLog, 'play')[0];
  assert.deepEqual({ cmd: play.cmd, name: play.name }, { cmd: 'play', name: 'ding.wav' });
  assert.ok(!('path' in play));
  window.close();
});

test('native mode: switching the output while running does not restart the mixer', async () => {
  const { window, engineLog, settle } = await loadApp({ native: true, store: SKIP_WIZARD });
  window.document.getElementById('startBtn').click();
  await settle(60);
  const out = window.document.getElementById('outSel');
  out.value = 'default';
  out.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle(60);
  assert.equal(cmds(engineLog, 'output').pop().device, 'default');
  assert.equal(cmds(engineLog, 'start').length, 1, 'no second start');
  window.close();
});

test('native mode: if the engine dies the UI returns to Start and says so', async () => {
  const { window, emitEngine, settle } = await loadApp({ native: true, store: SKIP_WIZARD });
  window.document.getElementById('startBtn').click();
  await settle(60);
  assert.equal(window.document.getElementById('startBtn').textContent, 'Stop');
  emitEngine({ event: 'exited', code: 1 });
  await settle(30);
  assert.equal(window.document.getElementById('startBtn').textContent, 'Start');
  assert.match(window.document.getElementById('toast').textContent, /stopped unexpectedly/);
  window.close();
});

test('native mode: a failed start shows the engine message and leaves Start usable', async () => {
  const { window, errors, engineLog, emitEngine, settle } = await loadApp({ native: true, store: SKIP_WIZARD });
  // The next start fails the way a missing device would.
  window.vf.sendEngine = (cmd) => {
    engineLog.push(cmd);
    if (cmd.cmd === 'start') setTimeout(() => emitEngine({ event: 'error', message: 'No such device', id: cmd.id }), 0);
    return Promise.resolve(true);
  };
  window.document.getElementById('startBtn').click();
  await settle(60);
  assert.ok(errors.some((e) => /Audio error: No such device/.test(e)), 'the engine message reaches the user: ' + errors.join('|'));
  const btn = window.document.getElementById('startBtn');
  assert.equal(btn.textContent, 'Start');
  assert.equal(btn.disabled, false);
  window.close();
});

test('the settings dialog shows the native engine switch and saves it', async () => {
  const { window, calls } = await loadApp({ store: SKIP_WIZARD, engineAvailable: true });
  const box = window.document.getElementById('optNative');
  assert.equal(box.disabled, false);
  box.checked = true;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.ok(calls.some((c) => c[0] === 'setSettings' && c[1].nativeEngine === true));
  assert.match(window.document.getElementById('nativeNote').textContent, /Restart/);
  window.close();
});

test('without engine.exe the native switch is disabled and explains why', async () => {
  const { window } = await loadApp({ store: SKIP_WIZARD, engineAvailable: false });
  assert.equal(window.document.getElementById('optNative').disabled, true);
  assert.match(window.document.getElementById('nativeNote').textContent, /not found/);
  window.close();
});

test('wizard and auto-tune use the default mic when the native engine is active', async () => {
  const { window, errors } = await loadApp({ native: true });
  // First launch opens the wizard; its mic meter must not ask Chromium for a native device id.
  assert.ok(window.document.querySelector('.wz-card'));
  assert.equal(window.webMicId('abcdef'), undefined);
  assert.deepEqual(errors, []);
  window.close();
});

test('native mode: turning noise suppression on is sent to the engine without an error', async () => {
  const { window, errors, engineLog, settle } = await loadApp({ native: true, store: SKIP_WIZARD });
  window.document.getElementById('startBtn').click();
  await settle(60);
  const toggle = window.document.querySelector('input.toggle[title="Enable Noise suppression"]');
  assert.ok(toggle, 'the noise suppression switch exists');
  toggle.checked = true;
  toggle.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle(30);
  assert.ok(cmds(engineLog, 'set').some((c) => c.values && c.values.nsOn === true), 'nsOn reaches the engine');
  assert.deepEqual(errors, []);
  window.close();
});

test('native mode: a pad sends its clip volume to the engine', async () => {
  const { window, engineLog, settle } = await loadApp({
    native: true,
    store: { ...SKIP_WIZARD, clipDb: { 'ding.wav': -6 } },
    vf: { listSounds: async () => [{ name: 'ding.wav', size: 5 }] },
  });
  window.document.getElementById('startBtn').click();
  await settle(60);
  window.document.querySelector('.padPlay').click();
  await settle(40);
  assert.equal(cmds(engineLog, 'play')[0].gain, -6);
  window.close();
});

test('native mode: the Measure my delay button reports the engine\'s numbers', async () => {
  const { window, settle } = await loadApp({ native: true, store: SKIP_WIZARD });
  const $ = (id) => window.document.getElementById(id);
  assert.equal($('measureRow').hidden, false, 'shown for the native engine');
  $('measureBtn').click();
  assert.match($('measureNote').textContent, /Press Start first/);
  $('startBtn').click();
  await settle(60);
  $('measureBtn').click();
  await settle(60);
  assert.match($('measureNote').textContent, /About 42 ms/);
  assert.match($('measureNote').textContent, /27 ms through the effects/);
  assert.match($('measureNote').textContent, /Measured 3 times, 27 to 28 ms/);
  assert.equal($('measureBtn').disabled, false);
  window.close();
});

test('native mode: a late error for a call that already finished is ignored, one without an id is shown', async () => {
  const { window, emitEngine, settle } = await loadApp({ native: true, store: SKIP_WIZARD });
  emitEngine({ event: 'error', message: 'stale answer', id: 987654 });
  await settle(20);
  assert.doesNotMatch(window.document.getElementById('toast').textContent, /stale answer/);
  emitEngine({ event: 'error', message: 'real problem' });
  await settle(20);
  assert.match(window.document.getElementById('toast').textContent, /real problem/);
  window.close();
});

test('native mode: a saved buffer size that is not one of the choices falls back to 240', async () => {
  const { window, engineLog, settle } = await loadApp({ native: true, store: { ...SKIP_WIZARD, nativeBuffer: 1 } });
  assert.equal(window.document.getElementById('optBuffer').value, '240');
  window.document.getElementById('startBtn').click();
  await settle(60);
  assert.equal(cmds(engineLog, 'start')[0].bufferFrames, 240);
  window.close();
});

test('native mode: after measuring, the header shows the measured delay until noise suppression changes it', async () => {
  const { window, settle } = await loadApp({ native: true, store: SKIP_WIZARD });
  const $ = (id) => window.document.getElementById(id);
  $('startBtn').click();
  await settle(60);
  $('measureBtn').click();
  await settle(60);
  await new Promise((r) => window.requestAnimationFrame(r));
  assert.equal($('lat').textContent, '42 ms (measured)');
  // Turning noise suppression on adds delay the measurement did not include, so the number goes stale.
  const ns = window.document.querySelector('input.toggle[title="Enable Noise suppression"]');
  ns.checked = true;
  ns.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((r) => window.requestAnimationFrame(r));
  assert.doesNotMatch($('lat').textContent, /measured/);
  window.close();
});
