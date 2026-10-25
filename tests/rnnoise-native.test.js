// Native RNNoise against the web worklet: same model, same framing, so the output should match closely.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadProcessor, run, rms, db, tone, mix, SAMPLE_RATE } = require('./worklet-harness');
const { loadRnnoiseProcessor, noise } = require('./rnnoise-loader');

const EXE = path.join(__dirname, '..', 'engine', 'build', 'engine.exe');
const opts = fs.existsSync(EXE) ? {} : { skip: 'engine.exe is not built (run npm run build:engine)' };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-rn-'));

// Every stage but noise suppression is switched off, so the chain is just RNNoise.
const ONLY_RNNOISE = {
  nsOn: true, hpfOn: false, gateOn: false, eqOn: false, deessOn: false, compOn: false, lofiOn: false, limOn: false,
  inGain: 0, outGain: 0, makeup: 0,
};

function native(input, values) {
  const inFile = path.join(tmp, 'in.f32');
  const outFile = path.join(tmp, 'out.f32');
  const paramFile = path.join(tmp, 'params.json');
  fs.writeFileSync(inFile, Buffer.from(input.buffer, input.byteOffset, input.byteLength));
  fs.writeFileSync(paramFile, JSON.stringify({ values }));
  execFileSync(EXE, ['--process-raw', inFile, outFile, paramFile]);
  const raw = fs.readFileSync(outFile);
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
}

// The web chain after RNNoise with the same stages switched off (the de-esser crossover still shapes phase).
function webAfterRnnoise(x) {
  const off = { enabled: 0 };
  x = run(loadProcessor('gate-processor.js', 'gate-processor'), x, { threshold: -52, release: 0.18, ...off });
  x = run(loadProcessor('deesser-processor.js', 'deesser-processor'), x, { freq: 5500, threshold: -32, amount: 8, ...off });
  x = run(loadProcessor('compressor-processor.js', 'compressor-processor'), x, { threshold: -22, ratio: 3, attack: 0.008, release: 0.2, makeup: 0, ...off });
  x = run(loadProcessor('blown-processor.js', 'blown-processor'), x, { drive: 26, bits: 9, hold: 3, tone: 5500, level: -4, ...off });
  return run(loadProcessor('limiter-processor.js', 'limiter-processor'), x, { ceiling: -1.5, ...off });
}

test('native rnnoise matches the web worklet', opts, () => {
  const input = mix(tone(300, 0.3, 0.5), noise(0.04, 2));
  const web = webAfterRnnoise(run(loadRnnoiseProcessor(), input, { enabled: 1, amount: 1 }));
  const nat = native(input, ONLY_RNNOISE);
  assert.equal(nat.length, web.length);
  // The two builds run the same model with different compilers, and a recurrent network amplifies tiny
  // float differences, so compare overall level error rather than sample by sample.
  const skip = 4800;
  let err = 0;
  let ref = 0;
  for (let i = skip; i < web.length; i++) {
    err += (nat[i] - web[i]) ** 2;
    ref += web[i] ** 2;
  }
  const relErr = Math.sqrt(err / ref);
  assert.ok(relErr < 0.05, `relative rms difference ${relErr.toFixed(4)}`);
});

test('native rnnoise cuts steady noise like the web version', opts, () => {
  const input = noise(0.05, 2);
  const out = native(input, ONLY_RNNOISE);
  const skip = SAMPLE_RATE / 2;
  const cut = db(rms(input, skip)) - db(rms(out, skip));
  assert.ok(cut > 12, `expected more than 12 dB of noise reduction, got ${cut.toFixed(1)} dB`);
});

test('native rnnoise at 0% is the same audio, one 10 ms frame later', opts, () => {
  const input = mix(tone(300, 0.3, 0.5), noise(0.02, 1));
  const dry = native(input, { ...ONLY_RNNOISE, nsOn: false });
  const wet0 = native(input, { ...ONLY_RNNOISE, nsAmt: 0 });
  let maxErr = 0;
  for (let i = 480; i < input.length; i++) maxErr = Math.max(maxErr, Math.abs(wet0[i] - dry[i - 480]));
  assert.ok(maxErr < 1e-5, `max error ${maxErr}`);
});
