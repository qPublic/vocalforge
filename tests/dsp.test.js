const test = require('node:test');
const assert = require('node:assert/strict');
const { loadProcessor, run, rms, db, tone, mix } = require('./worklet-harness');

test('de-esser: turns loud sibilance down and leaves the low band alone', () => {
  const DeEsser = loadProcessor('deesser-processor.js', 'deesser-processor');
  const skip = 9600; // let the detector settle for 200 ms
  const settings = { freq: 4500, threshold: -30, amount: 12 };

  // The sibilance band alone is cut by close to the maximum amount.
  const hiss = tone(7000, 0.2, 1);
  const hissOut = run(DeEsser, hiss, settings);
  const cut = db(rms(hiss, skip)) - db(rms(hissOut, skip));
  assert.ok(cut > 8 && cut < 13, `expected about 12 dB cut on the 7 kHz band, got ${cut.toFixed(2)} dB`);

  // The low band alone passes unchanged.
  const voice = tone(200, 0.2, 1);
  const voiceOut = run(DeEsser, voice, settings);
  const change = Math.abs(db(rms(voice, skip)) - db(rms(voiceOut, skip)));
  assert.ok(change < 0.3, `low band changed by ${change.toFixed(2)} dB`);

  // Mixed: the total drops, but by far less than the band does.
  const input = mix(voice, hiss);
  const total = db(rms(input, skip)) - db(rms(run(DeEsser, input, settings), skip));
  assert.ok(total > 1.5 && total < 3.2, `mix reduction ${total.toFixed(2)} dB`);
});

test('de-esser: quiet sibilance below threshold is untouched', () => {
  const DeEsser = loadProcessor('deesser-processor.js', 'deesser-processor');
  const quiet = tone(7000, 0.005, 1); // about -46 dBFS
  const out = run(DeEsser, quiet, { threshold: -30, amount: 12 });
  const change = Math.abs(db(rms(quiet, 9600)) - db(rms(out, 9600)));
  assert.ok(change < 0.5, `changed by ${change.toFixed(2)} dB`);
});

test('de-esser: disabled passes audio through', () => {
  const DeEsser = loadProcessor('deesser-processor.js', 'deesser-processor');
  const hiss = tone(7000, 0.3, 0.5);
  const out = run(DeEsser, hiss, { enabled: 0, threshold: -40, amount: 24 });
  const change = Math.abs(db(rms(hiss, 4800)) - db(rms(out, 4800)));
  assert.ok(change < 0.1, `changed by ${change.toFixed(2)} dB`);
});

test('gate: closes on quiet input, opens on loud input', () => {
  const Gate = loadProcessor('gate-processor.js', 'gate-processor');
  const quiet = tone(300, 0.002, 1); // about -57 dBFS
  const loud = tone(300, 0.3, 1);
  const q = run(Gate, quiet, { threshold: -45, floor: -80, release: 0.05 });
  const l = run(Gate, loud, { threshold: -45, floor: -80 });
  assert.ok(rms(q, 24000) < rms(quiet) * 0.1, 'quiet signal should be gated');
  assert.ok(Math.abs(db(rms(l, 9600)) - db(rms(loud, 9600))) < 0.2, 'loud signal should pass');
});
