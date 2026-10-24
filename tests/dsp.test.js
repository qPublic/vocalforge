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

// ---------- compressor ----------
const finalLevelDb = (a) => db(rms(a, Math.floor(a.length * 0.6)));
const gainFit = (inp, out, from) => {
  let num = 0;
  let den = 0;
  for (let i = from; i < inp.length; i++) {
    num += out[i] * inp[i];
    den += inp[i] * inp[i];
  }
  return num / den;
};

test('compressor: reduction follows the ratio, and has no hidden makeup gain', () => {
  const Comp = loadProcessor('compressor-processor.js', 'compressor-processor');
  const input = tone(1000, 0.5, 1.5); // -6 dBFS peak
  const out = run(Comp, input, { threshold: -24, ratio: 4, knee: 0, makeup: 0, attack: 0.005, release: 0.1 });
  const reduction = finalLevelDb(input) - finalLevelDb(out);
  // 18 dB over the threshold at 4:1 leaves 4.5 dB over, so 13.5 dB of reduction.
  assert.ok(Math.abs(reduction - 13.5) < 1.5, `expected about 13.5 dB reduction, got ${reduction.toFixed(2)}`);

  // A signal exactly at the threshold passes at unity. (The browser's built-in node would boost it.)
  const atThr = tone(1000, Math.pow(10, -24 / 20), 1);
  const unity = finalLevelDb(run(Comp, atThr, { threshold: -24, ratio: 20, knee: 0, makeup: 0 })) - finalLevelDb(atThr);
  assert.ok(Math.abs(unity) < 0.4, `level at threshold changed by ${unity.toFixed(2)} dB`);
});

test('compressor: makeup gain is exactly what the slider says', () => {
  const Comp = loadProcessor('compressor-processor.js', 'compressor-processor');
  const quiet = tone(500, 0.01, 1.5); // -40 dBFS, well under the threshold
  const out = run(Comp, quiet, { threshold: -24, ratio: 4, makeup: 6 });
  const gain = finalLevelDb(out) - finalLevelDb(quiet);
  assert.ok(Math.abs(gain - 6) < 0.2, `expected +6 dB, got ${gain.toFixed(2)}`);
});

test('compressor: a steady tone is turned down cleanly, without added distortion', () => {
  const Comp = loadProcessor('compressor-processor.js', 'compressor-processor');
  const input = tone(150, 0.6, 2); // low voice-range tone, the hardest case for detector ripple
  const out = run(Comp, input, { threshold: -24, ratio: 4, attack: 0.008, release: 0.2, makeup: 0 });
  const from = Math.floor(input.length * 0.6);
  const g = gainFit(input, out, from);
  let err = 0;
  let sig = 0;
  for (let i = from; i < input.length; i++) {
    const d = out[i] - g * input[i];
    err += d * d;
    sig += out[i] * out[i];
  }
  const residualDb = 10 * Math.log10(err / sig);
  assert.ok(residualDb < -35, `distortion residual ${residualDb.toFixed(1)} dB (want below -35)`);
});

test('compressor: disabled passes audio through untouched', () => {
  const Comp = loadProcessor('compressor-processor.js', 'compressor-processor');
  const input = tone(300, 0.4, 0.5);
  const out = run(Comp, input, { enabled: 0, makeup: 12 });
  let maxErr = 0;
  for (let i = 4800; i < input.length; i++) maxErr = Math.max(maxErr, Math.abs(out[i] - input[i]));
  assert.ok(maxErr < 1e-4, `max error ${maxErr}`);
});

// ---------- limiter ----------
test('limiter: output never exceeds the ceiling, even on loud bursts', () => {
  const Lim = loadProcessor('limiter-processor.js', 'limiter-processor');
  const ceilDb = -3;
  const ceil = Math.pow(10, ceilDb / 20);
  const loud = tone(220, 1.5, 1);
  const quiet = tone(220, 0.05, 1);
  const input = new Float32Array(loud.length * 2);
  input.set(quiet, 0);
  input.set(loud, quiet.length); // a sudden jump from quiet to far over the ceiling
  const out = run(Lim, input, { ceiling: ceilDb, release: 0.05 });
  let peak = 0;
  for (const s of out) peak = Math.max(peak, Math.abs(s));
  assert.ok(peak <= ceil + 1e-4, `peak ${peak} exceeds ceiling ${ceil}`);
  assert.ok(peak > ceil * 0.9, `limiter over-attenuated: peak ${peak}`);
});

test('limiter: quiet audio passes unchanged, delayed by 2 ms', () => {
  const Lim = loadProcessor('limiter-processor.js', 'limiter-processor');
  const input = tone(300, 0.1, 0.5);
  const out = run(Lim, input, { ceiling: -1.5 });
  let maxErr = 0;
  for (let i = 96; i < input.length; i++) maxErr = Math.max(maxErr, Math.abs(out[i] - input[i - 96]));
  assert.ok(maxErr < 1e-6, `max error ${maxErr}`);
});

test('limiter: disabled does not touch the level', () => {
  const Lim = loadProcessor('limiter-processor.js', 'limiter-processor');
  const input = tone(300, 0.95, 0.3);
  const out = run(Lim, input, { enabled: 0, ceiling: -12 });
  let peak = 0;
  for (const s of out) peak = Math.max(peak, Math.abs(s));
  assert.ok(peak > 0.94, `peak ${peak}`);
});
