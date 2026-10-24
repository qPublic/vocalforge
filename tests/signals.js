// Shared synthetic test signals.
const { SAMPLE_RATE } = require('./worklet-harness');

// Speech-like signal: a 140 Hz harmonic stack with syllable-rate bursts over a quiet noise floor.
function voice(seconds, peakDb, noiseDb) {
  const n = Math.floor(SAMPLE_RATE * seconds);
  const a = new Float32Array(n);
  const peak = Math.pow(10, peakDb / 20);
  const noise = Math.pow(10, noiseDb / 20);
  let seed = 99;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let v = 0;
    for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * 140 * h * t) / h;
    const syllable = Math.max(0, Math.sin(2 * Math.PI * 3 * t));
    seed = (seed * 1664525 + 1013904223) >>> 0;
    a[i] = (v / 2.7) * peak * syllable + noise * ((seed / 0xffffffff) * 2 - 1);
  }
  return a;
}

// RBJ high-pass biquad (Q in dB like Web Audio), matching the engine's input filter.
function highpass(input, freq, qDb) {
  const w0 = (2 * Math.PI * freq) / SAMPLE_RATE;
  const c = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.pow(10, qDb / 20));
  const a0 = 1 + alpha;
  const b0 = (1 + c) / 2 / a0, b1 = -(1 + c) / a0, b2 = b0, a1 = (-2 * c) / a0, a2 = (1 - alpha) / a0;
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

module.exports = { voice, highpass };
