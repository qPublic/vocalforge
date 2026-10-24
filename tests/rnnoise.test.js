const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { run, rms, db, tone, mix, SAMPLE_RATE } = require('./worklet-harness');

// Evaluate the vendored RNNoise glue and the processor in a sandbox that has no `window`,
// `process`, `atob` or `require`, like an AudioWorkletGlobalScope. ES module syntax is rewritten
// into plain script assignments, since vm does not run ES modules.
function loadRnnoiseProcessor() {
  const dir = path.join(__dirname, '..', 'renderer');
  const registry = {};
  class AudioWorkletProcessor {
    constructor() {
      this.messages = [];
      this.port = { postMessage: (m) => this.messages.push(m) };
    }
  }
  const sandbox = vm.createContext({
    AudioWorkletProcessor,
    registerProcessor: (n, c) => (registry[n] = c),
    sampleRate: SAMPLE_RATE,
    WebAssembly,
    console,
    TextDecoder,
  });
  const glue = fs
    .readFileSync(path.join(dir, 'vendor', 'rnnoise-sync.js'), 'utf8')
    .replace('import.meta.url', '"file:///worklet/vendor/rnnoise-sync.js"')
    .replace('export default createRNNWasmModuleSync;', 'globalThis.createRNNWasmModuleSync = createRNNWasmModuleSync;');
  vm.runInContext(glue, sandbox, { filename: 'rnnoise-sync.js' });
  const proc = fs.readFileSync(path.join(dir, 'rnnoise-processor.js'), 'utf8').replace(/^import .*$/m, '');
  vm.runInContext(proc, sandbox, { filename: 'rnnoise-processor.js' });
  return registry['rnnoise-processor'];
}

// Deterministic white noise.
function noise(amp, seconds) {
  let seed = 12345;
  const n = Math.floor(SAMPLE_RATE * seconds);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    a[i] = amp * ((seed / 0xffffffff) * 2 - 1);
  }
  return a;
}

test('rnnoise: the WASM module loads in a worklet-like sandbox', () => {
  const P = loadRnnoiseProcessor();
  const p = new P();
  assert.equal(JSON.stringify(p.messages), '[{"ready":true}]');
});

test('rnnoise: disabled passes audio through untouched', () => {
  const P = loadRnnoiseProcessor();
  const input = mix(tone(440, 0.2, 0.3), noise(0.05, 0.3));
  const out = run(P, input, { enabled: 0 });
  assert.deepEqual(out, input);
});

test('rnnoise: strongly reduces steady broadband noise', () => {
  const P = loadRnnoiseProcessor();
  const input = noise(0.05, 2); // about -29 dBFS rms
  const out = run(P, input, { enabled: 1, amount: 1 });
  const skip = SAMPLE_RATE / 2; // let the network settle
  const cut = db(rms(input, skip)) - db(rms(out, skip));
  assert.ok(cut > 12, `expected more than 12 dB of noise reduction, got ${cut.toFixed(1)} dB`);
});

test('rnnoise: dry/wet at 0 is the input delayed by one 10 ms frame', () => {
  const P = loadRnnoiseProcessor();
  const input = mix(tone(300, 0.2, 0.5), noise(0.02, 0.5));
  const out = run(P, input, { enabled: 1, amount: 0 });
  let maxErr = 0;
  for (let i = 480; i < input.length; i++) maxErr = Math.max(maxErr, Math.abs(out[i] - input[i - 480]));
  assert.ok(maxErr < 1e-6, `max error ${maxErr}`);
});

test('rnnoise: output stays finite and bounded on loud input', () => {
  const P = loadRnnoiseProcessor();
  const out = run(P, mix(tone(200, 0.9, 1), noise(0.3, 1)), { enabled: 1 });
  for (const s of out) assert.ok(Number.isFinite(s) && Math.abs(s) < 4, `bad sample ${s}`);
});
