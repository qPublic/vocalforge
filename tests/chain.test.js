const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadProcessor, run, rms, db, SAMPLE_RATE } = require('./worklet-harness');

// The real default settings, read from the engine so this test follows them.
const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'engine.js'), 'utf8');
const PARAMS = new Function(src.slice(src.indexOf('const PARAMS'), src.indexOf('const FLAT')) + '; return PARAMS;')();
const D = Object.fromEntries(Object.values(PARAMS).flat().map((p) => [p.id, p.def]));

// Speech-like test signal: a 140 Hz harmonic stack with syllable-rate bursts over a quiet noise floor.
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
    const syllable = Math.max(0, Math.sin(2 * Math.PI * 3 * t)); // three bursts a second
    seed = (seed * 1664525 + 1013904223) >>> 0;
    a[i] = (v / 2.7) * peak * syllable + noise * ((seed / 0xffffffff) * 2 - 1);
  }
  return a;
}

function processChain(input) {
  const gate = loadProcessor('gate-processor.js', 'gate-processor');
  const deess = loadProcessor('deesser-processor.js', 'deesser-processor');
  const comp = loadProcessor('compressor-processor.js', 'compressor-processor');
  const lim = loadProcessor('limiter-processor.js', 'limiter-processor');
  let x = run(gate, input, { threshold: D.gateThr, release: D.gateRel, enabled: D.gateOn ? 1 : 0 });
  x = run(deess, x, { freq: D.deessFreq, threshold: D.deessThr, amount: D.deessAmt, enabled: D.deessOn ? 1 : 0 });
  x = run(comp, x, { threshold: D.compThr, ratio: D.compRatio, attack: D.compAtk, release: D.compRel, makeup: D.makeup, enabled: D.compOn ? 1 : 0 });
  return run(lim, x, { ceiling: D.limCeil, enabled: D.limOn ? 1 : 0 });
}

const peakDb = (a) => db(a.reduce((m, s) => Math.max(m, Math.abs(s)), 0));

test('default chain: normal speech comes out loud but never clips', () => {
  const out = processChain(voice(4, -12, -62));
  const p = peakDb(out);
  assert.ok(p <= D.limCeil + 0.05, `peak ${p.toFixed(2)} dBFS is over the ceiling`);
  assert.ok(p > -12, `output peak ${p.toFixed(1)} dBFS is too quiet`);
});

test('default chain: a loud talker is held under the ceiling without pumping the floor up', () => {
  const out = processChain(voice(4, -3, -62));
  assert.ok(peakDb(out) <= D.limCeil + 0.05, `peak ${peakDb(out).toFixed(2)}`);
});

test('default chain: the room noise floor is not boosted', () => {
  // Speech for the first half, then only the noise floor. The gate should close, leaving it quieter than it came in.
  const talk = voice(2, -12, -62);
  const quiet = voice(2, -200, -62);
  const input = new Float32Array(talk.length + quiet.length);
  input.set(talk);
  input.set(quiet, talk.length);
  const out = processChain(input);
  const tail = (a) => db(rms(a, a.length - SAMPLE_RATE)); // last second: silence only
  assert.ok(tail(out) < tail(input) + 1, `noise floor went from ${tail(input).toFixed(1)} to ${tail(out).toFixed(1)} dB`);
});
