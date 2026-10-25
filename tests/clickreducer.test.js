const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProcessor, run, rms, db, SAMPLE_RATE } = require('./worklet-harness');
const { voice } = require('./signals');

let seed = 12345;
const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff) * 2 - 1;
const sec = (s) => Math.round(s * SAMPLE_RATE);

// A keyboard clack: about 10 ms of bright noise that dies away quickly.
function addClicks(signal, times, amp = 0.3) {
  for (const t of times) {
    let prev = 0;
    for (let i = 0; i < sec(0.01); i++) {
      const n = noise();
      const bright = n - prev; // differencing keeps only the high frequencies
      prev = n;
      const at = sec(t) + i;
      if (at < signal.length) signal[at] += amp * bright * Math.exp(-i / sec(0.0025));
    }
  }
}
const around = (a, t) => a.slice(sec(t), sec(t + 0.03));

test('click reducer: clicks in a pause are turned down a lot', () => {
  const C = loadProcessor('clickreducer-processor.js', 'clickreducer-processor');
  const x = new Float32Array(sec(4)).map(() => 0.0003 * noise()); // quiet room
  const times = [0.5, 1.1, 1.7, 2.3, 2.9];
  addClicks(x, times);
  const out = run(C, x, { amount: 1, enabled: 1 });
  const cuts = times.map((t) => db(rms(around(x, t))) - db(rms(around(out, t))));
  for (const c of cuts) assert.ok(c > 6, `a click was only cut by ${c.toFixed(1)} dB (${cuts.map((v) => v.toFixed(1)).join(', ')})`);
});

test('click reducer: ordinary speech, with its t and k sounds, is left alone', () => {
  const C = loadProcessor('clickreducer-processor.js', 'clickreducer-processor');
  const x = voice(6, -20, -70);
  const out = run(C, x, { amount: 1, enabled: 1 });
  const change = db(rms(out)) - db(rms(x));
  assert.ok(Math.abs(change) < 0.7, `speech changed by ${change.toFixed(2)} dB`);
});

test('click reducer: a clack during speech is reduced too, though less than in a pause', () => {
  const C = loadProcessor('clickreducer-processor.js', 'clickreducer-processor');
  const x = voice(6, -20, -70);
  const times = [1.3, 2.9, 4.4];
  addClicks(x, times, 0.6);
  const off = run(C, x, { amount: 1, enabled: 0 });
  const on = run(C, x, { amount: 1, enabled: 1 });
  const cuts = times.map((t) => db(rms(around(off, t))) - db(rms(around(on, t))));
  assert.ok(cuts.reduce((a, b) => a + b, 0) / cuts.length > 1.5, `average cut ${(cuts.reduce((a, b) => a + b, 0) / cuts.length).toFixed(1)} dB (${cuts.map((v) => v.toFixed(1)).join(', ')})`);
});

test('click reducer: off, or at 0%, changes nothing', () => {
  const C = loadProcessor('clickreducer-processor.js', 'clickreducer-processor');
  const x = new Float32Array(sec(2)).map(() => 0.0003 * noise());
  addClicks(x, [0.5, 1.2]);
  for (const s of [{ amount: 1, enabled: 0 }, { amount: 0, enabled: 1 }]) {
    const out = run(C, x, s);
    let maxDiff = 0;
    for (let i = 0; i < x.length; i++) maxDiff = Math.max(maxDiff, Math.abs(out[i] - x[i]));
    assert.ok(maxDiff < 1e-6, `max difference ${maxDiff}`);
  }
});
