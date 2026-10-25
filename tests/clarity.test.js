const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProcessor, run, rms, db, SAMPLE_RATE } = require('./worklet-harness');

// A steady vowel-like tone, a pause, a short burst of 2-4 kHz energy (a "t" or "k"), then the vowel again.
function word() {
  const n = Math.round(SAMPLE_RATE * 1.2);
  const x = new Float32Array(n);
  const at = (s) => Math.round(s * SAMPLE_RATE);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const vowel = t < 0.5 || t > 0.62 ? 0.12 * Math.sin(2 * Math.PI * 180 * t) + 0.06 * Math.sin(2 * Math.PI * 360 * t) : 0;
    let burst = 0;
    if (t >= 0.55 && t < 0.58) for (let f = 2000; f <= 4000; f += 250) burst += 0.012 * Math.sin(2 * Math.PI * f * t + f);
    x[i] = vowel + burst;
  }
  return { x, burst: [at(0.55), at(0.56)], vowel: [at(0.3), at(0.45)] };
}

test('clarity: a consonant burst after a pause is lifted, the vowel is not', () => {
  const Clarity = loadProcessor('clarity-processor.js', 'clarity-processor');
  const { x, burst, vowel } = word();
  const out = run(Clarity, x, { amount: 1, enabled: 1 });
  const lift = db(rms(out.slice(burst[0], burst[1]))) - db(rms(x.slice(burst[0], burst[1])));
  const vowelChange = db(rms(out.slice(vowel[0], vowel[1]))) - db(rms(x.slice(vowel[0], vowel[1])));
  assert.ok(lift > 4, `burst lifted ${lift.toFixed(1)} dB`);
  assert.ok(Math.abs(vowelChange) < 1.5, `vowel changed ${vowelChange.toFixed(1)} dB`);
});

test('clarity: off, or at 0%, passes the signal through unchanged', () => {
  const Clarity = loadProcessor('clarity-processor.js', 'clarity-processor');
  const { x } = word();
  for (const settings of [{ amount: 1, enabled: 0 }, { amount: 0, enabled: 1 }]) {
    const out = run(Clarity, x, settings);
    let maxDiff = 0;
    for (let i = 0; i < x.length; i++) maxDiff = Math.max(maxDiff, Math.abs(out[i] - x[i]));
    assert.ok(maxDiff < 1e-6, `max difference ${maxDiff}`);
  }
});

test('clarity: sibilance above 6 kHz and low rumble are left alone', () => {
  const Clarity = loadProcessor('clarity-processor.js', 'clarity-processor');
  const n = SAMPLE_RATE;
  for (const hz of [90, 8000]) {
    const x = new Float32Array(n).map((_, i) => 0.1 * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE));
    const out = run(Clarity, x, { amount: 1, enabled: 1 });
    const change = db(rms(out, 9600)) - db(rms(x, 9600));
    assert.ok(Math.abs(change) < 1, `${hz} Hz changed ${change.toFixed(2)} dB`);
  }
});

test('clarity: never boosts noise that is far below speech', () => {
  const Clarity = loadProcessor('clarity-processor.js', 'clarity-processor');
  const n = SAMPLE_RATE;
  let seed = 7;
  const x = new Float32Array(n).map(() => 0.00005 * (((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff) * 2 - 1));
  const out = run(Clarity, x, { amount: 1, enabled: 1 });
  const change = db(rms(out, 9600)) - db(rms(x, 9600));
  assert.ok(change < 2.5, `room noise raised by ${change.toFixed(1)} dB`);
});
