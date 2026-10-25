const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProcessor, rms, db, SAMPLE_RATE } = require('./worklet-harness');

// The ducker has two inputs (desktop audio, microphone), which the shared harness does not model.
function runDucker(desk, mic, settings = {}) {
  const Ducker = loadProcessor('ducker-processor.js', 'ducker-processor');
  const proc = new Ducker();
  const p = {};
  for (const d of Ducker.parameterDescriptors) p[d.name] = new Float32Array([settings[d.name] ?? d.defaultValue]);
  const out = new Float32Array(desk.length);
  for (let i = 0; i < desk.length; i += 128) {
    const o = new Float32Array(Math.min(128, desk.length - i));
    proc.process([[desk.subarray(i, i + o.length)], [mic.subarray(i, i + o.length)]], [[o]], p);
    out.set(o, i);
  }
  return out;
}
const tone = (level, seconds, hz = 220) => new Float32Array(Math.round(SAMPLE_RATE * seconds)).map((_, i) => Math.SQRT2 * Math.pow(10, level / 20) * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE));
const sec = (s) => Math.round(s * SAMPLE_RATE);

// Music the whole time; the mic is silent for 2 s, you talk for 3 s, then silent for 4 s.
function scene() {
  const n = sec(9);
  const desk = tone(-20, 9, 440);
  const mic = new Float32Array(n);
  mic.set(tone(-25, 3, 180), sec(2));
  return { desk, mic };
}
const level = (a, from, to) => db(rms(a.slice(sec(from), sec(to))));

test('ducker: desktop audio dips while you talk and comes back afterwards', () => {
  const { desk, mic } = scene();
  const out = runDucker(desk, mic, { amount: 9, threshold: -45, release: 0.6, enabled: 1 });
  assert.ok(Math.abs(level(out, 0.5, 1.9) - level(desk, 0.5, 1.9)) < 0.2, 'untouched before you speak');
  const dip = level(desk, 2.5, 4.8) - level(out, 2.5, 4.8);
  assert.ok(dip > 8 && dip < 9.5, `ducked by ${dip.toFixed(1)} dB, wanted about 9`);
  const back = level(desk, 8, 9) - level(out, 8, 9);
  assert.ok(Math.abs(back) < 0.3, `still ${back.toFixed(1)} dB down 3 s after you stopped`);
});

test('ducker: it stays down through the short pauses between words', () => {
  const desk = tone(-20, 5, 440);
  const mic = new Float32Array(sec(5));
  for (let w = 0; w < 5; w++) mic.set(tone(-25, 0.35, 180), sec(0.5 + w * 0.6)); // 0.25 s gaps
  const out = runDucker(desk, mic, { amount: 12, threshold: -45, release: 0.6, enabled: 1 });
  const during = level(desk, 1.5, 3.2) - level(out, 1.5, 3.2);
  assert.ok(during > 10.5, `only ${during.toFixed(1)} dB down across the pauses`);
});

test('ducker: off, or a quiet room, leaves the desktop audio alone', () => {
  const { desk, mic } = scene();
  const off = runDucker(desk, mic, { enabled: 0 });
  assert.ok(Math.abs(level(off, 2.5, 4.8) - level(desk, 2.5, 4.8)) < 0.1);
  const quietRoom = runDucker(desk, new Float32Array(desk.length).map((_, i) => 0.0005 * Math.sin(i)), { enabled: 1, threshold: -45 });
  assert.ok(Math.abs(level(quietRoom, 2.5, 4.8) - level(desk, 2.5, 4.8)) < 0.1, 'room noise below the voice level does not duck');
});

test('ducker: a higher voice level setting ignores quiet talking', () => {
  const desk = tone(-20, 6, 440);
  const mic = new Float32Array(sec(6));
  mic.set(tone(-50, 3, 180), sec(1)); // a murmur at -50 dB
  const loud = runDucker(desk, mic, { amount: 9, threshold: -30, release: 0.6, enabled: 1 });
  const sensitive = runDucker(desk, mic, { amount: 9, threshold: -60, release: 0.6, enabled: 1 });
  assert.ok(Math.abs(level(loud, 1.5, 3.5) - level(desk, 1.5, 3.5)) < 0.2, 'not triggered at -30');
  assert.ok(level(desk, 1.5, 3.5) - level(sensitive, 1.5, 3.5) > 8, 'triggered at -60');
});
