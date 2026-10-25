const test = require('node:test');
const assert = require('node:assert/strict');
const { run, rms, db, tone, mix, SAMPLE_RATE } = require('./worklet-harness');

const { loadRnnoiseProcessor, noise } = require('./rnnoise-loader');

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
