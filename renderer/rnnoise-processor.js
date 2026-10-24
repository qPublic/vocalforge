// RNNoise neural noise suppression (https://gitlab.xiph.org/xiph/rnnoise, BSD-3) via the
// Jitsi WASM build in vendor/. RNNoise works on 10 ms frames (480 samples at 48 kHz), so this
// adds 10 ms of latency while enabled. When disabled the audio passes straight through.
import createRNNWasmModuleSync from './vendor/rnnoise-sync.js';

const FRAME = 480;
const SCALE = 32768; // RNNoise expects 16-bit-range floats

class RNNoiseProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'enabled', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'amount', defaultValue: 1, minValue: 0, maxValue: 1 }, // wet/dry mix
    ];
  }

  constructor() {
    super();
    this.inBuf = new Float32Array(FRAME);
    this.prevRaw = new Float32Array(FRAME); // dry signal, delayed one frame to line up with the wet one
    this.outBuf = new Float32Array(FRAME); // processed previous frame
    this.fill = 0;
    this.active = false;
    try {
      this.mod = createRNNWasmModuleSync();
      this.inPtr = this.mod._malloc(FRAME * 4);
      this.outPtr = this.mod._malloc(FRAME * 4);
      this.state = this.mod._rnnoise_create(0);
      if (!this.inPtr || !this.outPtr || !this.state) throw new Error('allocation failed');
      this.port.postMessage({ ready: true });
    } catch (err) {
      this.mod = null;
      this.port.postMessage({ error: String((err && err.message) || err) });
    }
  }

  processFrame() {
    const mod = this.mod;
    // HEAPF32 is replaced if wasm memory grows, so always read it fresh.
    const heap = mod.HEAPF32;
    const inIdx = this.inPtr >> 2;
    const outIdx = this.outPtr >> 2;
    for (let i = 0; i < FRAME; i++) heap[inIdx + i] = this.inBuf[i] * SCALE;
    mod._rnnoise_process_frame(this.state, this.outPtr, this.inPtr);
    for (let i = 0; i < FRAME; i++) this.outBuf[i] = heap[outIdx + i] / SCALE;
    this.prevRaw.set(this.inBuf);
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input.length || !input[0].length) return true;
    const x = input[0];
    const frames = x.length;
    const on = params.enabled[0] >= 0.5 && !!this.mod;

    if (!on) {
      if (this.active) {
        // Start clean next time instead of replaying stale audio.
        this.fill = 0;
        this.inBuf.fill(0);
        this.prevRaw.fill(0);
        this.outBuf.fill(0);
        this.active = false;
      }
      for (let ch = 0; ch < output.length; ch++) output[ch].set(x);
      return true;
    }
    this.active = true;

    const wet = params.amount[0];
    for (let i = 0; i < frames; i++) {
      const p = this.fill;
      const y = this.prevRaw[p] * (1 - wet) + this.outBuf[p] * wet;
      this.inBuf[p] = x[i];
      for (let ch = 0; ch < output.length; ch++) output[ch][i] = y;
      if (++this.fill === FRAME) {
        this.fill = 0;
        this.processFrame();
      }
    }
    return true;
  }
}
registerProcessor('rnnoise-processor', RNNoiseProcessor);
