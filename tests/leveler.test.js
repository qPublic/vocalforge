const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProcessor, run, rms, db, SAMPLE_RATE } = require('./worklet-harness');

// A steady tone whose RMS is `level` dBFS.
const tone = (level, seconds, hz = 220) => new Float32Array(Math.round(SAMPLE_RATE * seconds)).map((_, i) => Math.SQRT2 * Math.pow(10, level / 20) * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE));
const lastSecond = (a) => a.slice(a.length - SAMPLE_RATE);

test('leveler: a quiet voice is brought up toward the target, slowly', () => {
  const L = loadProcessor('leveler-processor.js', 'leveler-processor');
  const x = tone(-30, 14);
  const out = run(L, x, { target: -22, range: 9, enabled: 1 });
  const first = db(rms(out.slice(0, SAMPLE_RATE / 2))) - db(rms(x.slice(0, SAMPLE_RATE / 2)));
  assert.ok(first < 3, `the first half second moved ${first.toFixed(1)} dB, it should ease in`);
  const end = db(rms(lastSecond(out)));
  assert.ok(Math.abs(end - -22) < 1.5, `ended at ${end.toFixed(1)} dB, wanted about -22`);
});

test('leveler: a loud voice is brought down, never by more than the range', () => {
  const L = loadProcessor('leveler-processor.js', 'leveler-processor');
  const out = run(L, tone(-8, 14), { target: -22, range: 6, enabled: 1 });
  const end = db(rms(lastSecond(out)));
  assert.ok(end < -10 && end > -14.5, `ended at ${end.toFixed(1)} dB; -8 minus a 6 dB range is -14`);
});

test('leveler: it holds still on silence and room noise instead of raising them', () => {
  const L = loadProcessor('leveler-processor.js', 'leveler-processor');
  const x = tone(-70, 10);
  const out = run(L, x, { target: -22, range: 12, enabled: 1 });
  assert.ok(Math.abs(db(rms(lastSecond(out))) - db(rms(lastSecond(x)))) < 0.2);
});

test('leveler: a pause keeps the gain it had instead of dropping back', () => {
  const L = loadProcessor('leveler-processor.js', 'leveler-processor');
  const talk = tone(-30, 10);
  const x = new Float32Array(talk.length + SAMPLE_RATE * 3);
  x.set(talk);
  x.set(tone(-30, 1), talk.length + SAMPLE_RATE * 2); // speech again after 2 s of silence
  const out = run(L, x, { target: -22, range: 9, enabled: 1 });
  const afterPause = db(rms(out.slice(talk.length + SAMPLE_RATE * 2, talk.length + SAMPLE_RATE * 2 + SAMPLE_RATE / 4)));
  assert.ok(afterPause > -26, `speech resumed at ${afterPause.toFixed(1)} dB; it should still be raised`);
});

test('leveler: off passes the signal through untouched', () => {
  const L = loadProcessor('leveler-processor.js', 'leveler-processor');
  const x = tone(-30, 3);
  const out = run(L, x, { target: -22, range: 9, enabled: 0 });
  let maxDiff = 0;
  for (let i = 0; i < x.length; i++) maxDiff = Math.max(maxDiff, Math.abs(out[i] - x[i]));
  assert.ok(maxDiff < 1e-6);
});
