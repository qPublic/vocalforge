// Shared by the RNNoise tests: the web worklet in a sandbox, plus deterministic noise.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { SAMPLE_RATE } = require('./worklet-harness');

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

module.exports = { loadRnnoiseProcessor, noise };
