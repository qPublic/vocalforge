// Loads an AudioWorklet processor file in plain Node so DSP can be unit-tested.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SAMPLE_RATE = 48000;

function loadProcessor(file, name) {
  const registry = {};
  class AudioWorkletProcessor {
    constructor() {
      this.port = { postMessage() {}, onmessage: null };
    }
  }
  const ctx = vm.createContext({
    AudioWorkletProcessor,
    registerProcessor: (n, cls) => (registry[n] = cls),
    sampleRate: SAMPLE_RATE,
    Math,
    Float32Array,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', file), 'utf8'), ctx, { filename: file });
  return registry[name];
}

// Runs a mono Float32Array through a processor in 128-sample blocks.
// `params` maps each parameter name to a constant value.
function run(Processor, signal, params = {}) {
  const proc = new Processor();
  const defs = Processor.parameterDescriptors || [];
  const p = {};
  for (const d of defs) p[d.name] = new Float32Array([params[d.name] ?? d.defaultValue]);
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i += 128) {
    const block = signal.subarray(i, Math.min(i + 128, signal.length));
    const o = new Float32Array(block.length);
    proc.process([[block]], [[o]], p);
    out.set(o, i);
  }
  return out;
}

const rms = (a, from = 0) => {
  let s = 0;
  for (let i = from; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / (a.length - from));
};
const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
const tone = (freq, amp, seconds) => {
  const n = Math.floor(SAMPLE_RATE * seconds);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
  return a;
};
const mix = (...sigs) => {
  const a = new Float32Array(sigs[0].length);
  for (const s of sigs) for (let i = 0; i < a.length; i++) a[i] += s[i];
  return a;
};

module.exports = { loadProcessor, run, rms, db, tone, mix, SAMPLE_RATE };
