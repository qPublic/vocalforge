// Tests for the native engine (engine/build/engine.exe). Skipped when it has not been built;
// CI builds it first, and `npm run build:engine` builds it locally.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { execFileSync, spawn } = require('node:child_process');
const { loadProcessor, run, rms, db, tone, SAMPLE_RATE } = require('./worklet-harness');
const { voice, highpass } = require('./signals');

const EXE = path.join(__dirname, '..', 'engine', 'build', 'engine.exe');
const built = fs.existsSync(EXE);
const opts = built ? {} : { skip: 'engine.exe is not built (run npm run build:engine)' };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-engine-'));

// Runs a mono Float32Array through the native chain (offline mode).
function nativeProcess(input, values = {}) {
  const inFile = path.join(tmp, 'in.f32');
  const outFile = path.join(tmp, 'out.f32');
  const paramFile = path.join(tmp, 'params.json');
  fs.writeFileSync(inFile, Buffer.from(input.buffer, input.byteOffset, input.byteLength));
  fs.writeFileSync(paramFile, JSON.stringify({ values }));
  execFileSync(EXE, ['--process-raw', inFile, outFile, paramFile]);
  const raw = fs.readFileSync(outFile);
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
}

// The same chain built from the JavaScript worklets, for comparison.
function jsProcess(input, D) {
  let x = highpass(input, D.hpfOn ? D.hpfFreq : 10, 0.707);
  x = run(loadProcessor('gate-processor.js', 'gate-processor'), x, { threshold: D.gateThr, release: D.gateRel, enabled: D.gateOn ? 1 : 0 });
  x = run(loadProcessor('deesser-processor.js', 'deesser-processor'), x, { freq: D.deessFreq, threshold: D.deessThr, amount: D.deessAmt, enabled: D.deessOn ? 1 : 0 });
  x = run(loadProcessor('compressor-processor.js', 'compressor-processor'), x, { threshold: D.compThr, ratio: D.compRatio, attack: D.compAtk, release: D.compRel, makeup: D.makeup, enabled: D.compOn ? 1 : 0 });
  x = run(loadProcessor('blown-processor.js', 'blown-processor'), x, { drive: D.lofiDrive, bits: D.lofiBits, hold: D.lofiHold, tone: D.lofiTone, level: D.lofiLevel, enabled: D.lofiOn ? 1 : 0 });
  return run(loadProcessor('limiter-processor.js', 'limiter-processor'), x, { ceiling: D.limCeil, enabled: D.limOn ? 1 : 0 });
}

function jsDefaults() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'engine.js'), 'utf8');
  const PARAMS = new Function(src.slice(src.indexOf('const PARAMS'), src.indexOf('const FLAT')) + '; return PARAMS;')();
  return Object.fromEntries(Object.values(PARAMS).flat().map((p) => [p.id, p.def]));
}

function errors(a, b) {
  assert.equal(a.length, b.length, 'length mismatch');
  let maxAbs = 0, errSq = 0, refSq = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    maxAbs = Math.max(maxAbs, Math.abs(d));
    errSq += d * d;
    refSq += b[i] * b[i];
  }
  return { maxAbs, relRms: Math.sqrt(errSq / Math.max(refSq, 1e-20)) };
}

// ---------- DSP parity ----------
test('native defaults match the settings defaults in renderer/engine.js', opts, () => {
  const native = JSON.parse(execFileSync(EXE, ['--defaults']).toString());
  const js = jsDefaults();
  assert.deepEqual(Object.keys(native).sort(), Object.keys(js).sort(), 'same set of settings');
  for (const [k, v] of Object.entries(js)) assert.equal(native[k], v, `default of ${k}`);
});

test('native chain matches the JavaScript chain on speech-like audio (default settings)', opts, () => {
  const D = { ...jsDefaults(), hpfOn: false, eqOn: false };
  const input = voice(3, -12, -62);
  const { maxAbs, relRms } = errors(nativeProcess(input, { hpfOn: false, eqOn: false }), jsProcess(input, D));
  assert.ok(relRms < 1e-4, `relative RMS error ${relRms.toExponential(2)}`);
  assert.ok(maxAbs < 1e-3, `max error ${maxAbs.toExponential(2)}`);
});

test('native chain matches the JavaScript chain with the blown-out mic on', opts, () => {
  const D = { ...jsDefaults(), hpfOn: false, eqOn: false, lofiOn: true };
  const input = voice(2, -14, -60);
  const { maxAbs, relRms } = errors(nativeProcess(input, { hpfOn: false, eqOn: false, lofiOn: true }), jsProcess(input, D));
  assert.ok(relRms < 1e-4, `relative RMS error ${relRms.toExponential(2)}`);
  assert.ok(maxAbs < 1e-3, `max error ${maxAbs.toExponential(2)}`);
});

test('native chain matches the JavaScript chain with unusual settings', opts, () => {
  const values = { hpfOn: false, eqOn: false, gateThr: -40, gateRel: 0.4, deessFreq: 4000, deessThr: -40, deessAmt: 14, compThr: -30, compRatio: 8, compAtk: 0.003, compRel: 0.5, makeup: 14, limCeil: -6 };
  const D = { ...jsDefaults(), ...values };
  const input = voice(3, -3, -55);
  const { maxAbs, relRms } = errors(nativeProcess(input, values), jsProcess(input, D));
  assert.ok(relRms < 1e-4, `relative RMS error ${relRms.toExponential(2)}`);
  assert.ok(maxAbs < 1e-3, `max error ${maxAbs.toExponential(2)}`);
});

test('native limiter never exceeds the ceiling', opts, () => {
  const out = nativeProcess(voice(3, 0, -40), { hpfOn: false, eqOn: false, inGain: 20, limCeil: -3 });
  const peak = out.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
  assert.ok(peak <= Math.pow(10, -3 / 20) + 1e-4, `peak ${peak}`);
});

// ---------- filters ----------
const OFF = { hpfOn: false, gateOn: false, deessOn: false, compOn: false, lofiOn: false, limOn: false, eqOn: false, eqLow: 0, eqMud: 0, eqPres: 0, eqAir: 0, makeup: 0 };
const gainDb = (freq, values) => {
  const input = tone(freq, 0.1, 1);
  const out = nativeProcess(input, { ...OFF, ...values });
  const skip = SAMPLE_RATE / 2;
  // Limiter off adds no gain change; the delay is fixed so RMS compares directly.
  return db(rms(out, skip)) - db(rms(input, skip));
};

test('with everything off the engine is transparent', opts, () => {
  for (const f of [100, 1000, 8000]) assert.ok(Math.abs(gainDb(f, {})) < 0.05, `${f} Hz changed by ${gainDb(f, {})} dB`);
});

test('EQ bands boost and cut at their frequencies', opts, () => {
  assert.ok(Math.abs(gainDb(50, { eqOn: true, eqLow: 6 }) - 6) < 0.6, 'low shelf');
  assert.ok(Math.abs(gainDb(300, { eqOn: true, eqMud: -6 }) - -6) < 0.3, 'mud cut');
  assert.ok(Math.abs(gainDb(3500, { eqOn: true, eqPres: 6 }) - 6) < 0.3, 'presence');
  assert.ok(Math.abs(gainDb(16000, { eqOn: true, eqAir: 6 }) - 6) < 1.2, 'air shelf');
  // Other regions stay put.
  assert.ok(Math.abs(gainDb(1000, { eqOn: true, eqMud: -6, eqAir: 6 })) < 1.0, '1 kHz is mostly untouched');
});

test('the high-pass filter removes lows and leaves the voice band', opts, () => {
  assert.ok(gainDb(60, { hpfOn: true, hpfFreq: 300 }) < -10, '60 Hz should be cut hard');
  assert.ok(Math.abs(gainDb(2000, { hpfOn: true, hpfFreq: 300 })) < 0.2, '2 kHz should pass');
});

test('input and output gain are exact', opts, () => {
  assert.ok(Math.abs(gainDb(1000, { inGain: 6 }) - 6) < 0.05);
  assert.ok(Math.abs(gainDb(1000, { outGain: -6 }) - -6) < 0.05);
});

test('out-of-range settings are clamped instead of breaking the audio', opts, () => {
  const out = nativeProcess(voice(1, -12, -60), { compRatio: -5, compAtk: 0, compRel: 0, gateRel: 0, deessFreq: 1, limCeil: 99, inGain: 1e9, lofiBits: 0, lofiHold: 0, nsAmt: NaN });
  for (const s of out) assert.ok(Number.isFinite(s) && Math.abs(s) < 10, `bad sample ${s}`);
});

// ---------- control protocol ----------
class EngineProcess {
  constructor(args = ['--backend', 'null']) {
    this.proc = spawn(EXE, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.events = [];
    this.waiters = [];
    this.exited = new Promise((resolve) => this.proc.on('exit', (code) => resolve(code)));
    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => {
      const event = JSON.parse(line);
      this.events.push(event);
      this.waiters = this.waiters.filter((w) => !w(event));
    });
  }
  send(obj) {
    this.proc.stdin.write((typeof obj === 'string' ? obj : JSON.stringify(obj)) + '\n');
  }
  // Resolves with the first event (past or future) matching the predicate.
  waitFor(pred, ms = 6000) {
    const past = this.events.find(pred);
    if (past) return Promise.resolve(past);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for an engine event; saw ' + JSON.stringify(this.events.slice(-5)))), ms);
      this.waiters.push((e) => (pred(e) ? (clearTimeout(timer), resolve(e), true) : false));
    });
  }
  async close() {
    this.send({ cmd: 'quit' });
    const timer = setTimeout(() => this.proc.kill(), 3000);
    const code = await this.exited;
    clearTimeout(timer);
    return code;
  }
}

test('protocol: hello, errors for bad input, and a clean quit', opts, async () => {
  const e = new EngineProcess();
  await e.waitFor((x) => x.event === 'ready');
  e.send({ cmd: 'hello', id: 7 });
  assert.equal((await e.waitFor((x) => x.event === 'hello')).id, 7);
  e.send('this is not json');
  await e.waitFor((x) => x.event === 'error' && /Invalid JSON/.test(x.message));
  e.send({ cmd: 'explode', id: 8 });
  assert.match((await e.waitFor((x) => x.id === 8)).message, /Unknown command/);
  e.send({ nocmd: true });
  await e.waitFor((x) => x.event === 'error' && /Missing cmd/.test(x.message));
  e.send({ cmd: 'start', input: 'zz-not-hex', id: 9 });
  assert.equal((await e.waitFor((x) => x.id === 9)).event, 'error');
  assert.equal(await e.close(), 0);
});

test('protocol: lists devices and runs a session on the null backend', opts, async () => {
  const e = new EngineProcess();
  e.send({ cmd: 'devices', id: 1 });
  const devices = await e.waitFor((x) => x.event === 'devices');
  assert.equal(devices.inputs[0].deviceId, 'default');
  assert.ok(devices.outputs.length >= 1);

  e.send({ cmd: 'start', input: 'default', output: 'default', monitor: { on: false }, id: 2 });
  const started = await e.waitFor((x) => x.id === 2);
  assert.equal(started.event, 'started', JSON.stringify(started));
  assert.ok(started.latencyMs > 0 && started.latencyMs < 500, `latency ${started.latencyMs}`);

  e.send({ cmd: 'set', values: { gateThr: -40, inGain: 3 }, id: 3 });
  await e.waitFor((x) => x.id === 3 && x.event === 'ok');
  e.send({ cmd: 'mute', on: true });
  e.send({ cmd: 'boardLevel', db: -6 });
  const meters = await e.waitFor((x) => x.event === 'meters');
  for (const k of ['in', 'out', 'gr', 'gate', 'latencyMs']) assert.ok(k in meters, `meters.${k}`);

  e.send({ cmd: 'stop', id: 4 });
  await e.waitFor((x) => x.id === 4 && x.event === 'stopped');
  assert.equal(await e.close(), 0);
});

test('protocol: plays a sound file into the output and reports its level', opts, async () => {
  const e = new EngineProcess();
  e.send({ cmd: 'start', id: 1 });
  await e.waitFor((x) => x.id === 1 && x.event === 'started');
  e.send({ cmd: 'set', values: { limCeil: -1.5 } });
  const clip = path.join(__dirname, '..', 'catalog', 'sounds', 'ding.wav');
  e.send({ cmd: 'play', path: clip, id: 2 });
  assert.equal((await e.waitFor((x) => x.id === 2)).event, 'played');
  const loud = await e.waitFor((x) => x.event === 'meters' && x.out > -30, 8000);
  assert.ok(loud.out <= -1.4, `output peak ${loud.out} dBFS should respect the ceiling`);

  e.send({ cmd: 'play', path: path.join(tmp, 'does-not-exist.wav'), id: 3 });
  assert.equal((await e.waitFor((x) => x.id === 3)).event, 'error');
  e.send({ cmd: 'play', path: path.join(__dirname, 'engine.test.js'), id: 4 });
  assert.equal((await e.waitFor((x) => x.id === 4)).event, 'error', 'a non-audio file is rejected');
  assert.equal(await e.close(), 0);
});

test('protocol: play before start is refused', opts, async () => {
  const e = new EngineProcess();
  e.send({ cmd: 'play', path: path.join(__dirname, '..', 'catalog', 'sounds', 'ding.wav'), id: 1 });
  assert.match((await e.waitFor((x) => x.id === 1)).message, /Start the mixer/);
  assert.equal(await e.close(), 0);
});

test('the engine exits by itself when its parent closes stdin', opts, async () => {
  const e = new EngineProcess();
  await e.waitFor((x) => x.event === 'ready');
  e.proc.stdin.end();
  const code = await Promise.race([e.exited, new Promise((r) => setTimeout(() => r('hung'), 4000))]);
  if (code === 'hung') e.proc.kill();
  assert.equal(code, 0);
});

test('protocol: a clip gain lowers that clip, and is never louder than full scale', opts, async () => {
  const e = new EngineProcess();
  e.send({ cmd: 'start', id: 1 });
  await e.waitFor((x) => x.id === 1 && x.event === 'started');
  // Everything after the soundboard is neutral, so the level change is just the clip gain.
  e.send({ cmd: 'set', values: { compOn: false, deessOn: false, gateOn: false, eqOn: false, limOn: false, hpfOn: false } });
  const clip = path.join(__dirname, '..', 'catalog', 'sounds', 'ding.wav');
  const peakFor = async (gain) => {
    const from = e.events.length;
    const cmd = { cmd: 'play', path: clip, id: 100 + Math.round(Math.abs(gain || 0)) };
    if (gain !== undefined) cmd.gain = gain;
    e.send(cmd);
    await e.waitFor((x) => x.id === cmd.id && x.event === 'played');
    await new Promise((r) => setTimeout(r, 1200));
    const peak = Math.max(...e.events.slice(from).filter((x) => x.event === 'meters').map((x) => x.out));
    e.send({ cmd: 'stopSounds' });
    await new Promise((r) => setTimeout(r, 400));
    return peak;
  };
  const full = await peakFor(0);
  const quiet = await peakFor(-20);
  const louder = await peakFor(12); // a "boost" request is capped at full scale
  assert.ok(full > -40, `the clip is audible at full gain (${full})`);
  assert.ok(Math.abs(full - quiet - 20) < 2, `-20 dB clip gain lowers the level by about 20 dB, got ${(full - quiet).toFixed(1)}`);
  assert.ok(Math.abs(louder - full) < 1, `a gain above 0 dB does nothing (${louder} vs ${full})`);
  assert.equal(await e.close(), 0);
});
