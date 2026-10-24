// Auto-tune analysis: pure functions, no DOM or audio APIs, so they can be unit-tested in Node.
// Frames come from a recorder: { rmsDb, bands } where bands are per-bin average levels in dB.

const BAND_EDGES = {
  rumble: [20, 80],
  low: [80, 250],
  mud: [250, 500],
  mid: [500, 2000],
  pres: [2000, 5000],
  sib: [5000, 9000],
  air: [9000, 14000],
};

// Typical long-term speech spectrum, as per-bin level relative to the mid band (dB).
// This is a heuristic starting point, not a measurement of "good" sound.
const TARGET_REL = { low: 3, mud: -1, pres: -8, air: -22 };

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round05 = (x) => Math.round(x * 2) / 2;
const round1 = (x) => Math.round(x);
const dbToPow = (db) => Math.pow(10, db / 10);
const powToDb = (p) => 10 * Math.log10(Math.max(p, 1e-12));

// Average analyser output (dB per FFT bin) into the bands above, averaging in the power domain.
function computeBands(binsDb, sampleRate, fftSize) {
  const binHz = sampleRate / fftSize;
  const out = {};
  for (const [name, [lo, hi]] of Object.entries(BAND_EDGES)) {
    const from = Math.max(1, Math.floor(lo / binHz));
    const to = Math.min(binsDb.length - 1, Math.ceil(hi / binHz));
    let sum = 0;
    let n = 0;
    for (let i = from; i <= to; i++) {
      sum += dbToPow(binsDb[i]);
      n++;
    }
    out[name] = n ? powToDb(sum / n) : -120;
  }
  return out;
}

function percentile(values, p) {
  if (!values.length) return NaN;
  const a = [...values].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1) + 0.5))];
}

function averageBands(frames) {
  const out = {};
  for (const name of Object.keys(BAND_EDGES)) out[name] = powToDb(frames.reduce((s, f) => s + dbToPow(f.bands[name]), 0) / frames.length);
  return out;
}

function analyze({ silence, speech }) {
  if (silence.length < 10) return { ok: false, reason: 'Not enough quiet audio was recorded.' };
  const noiseFloorDb = percentile(silence.map((f) => f.rmsDb), 0.75);
  const active = speech.filter((f) => f.rmsDb > noiseFloorDb + 10);
  if (active.length < 20) return { ok: false, reason: 'I could not hear you clearly. Move closer or raise your mic level and try again.' };

  const levels = active.map((f) => f.rmsDb);
  const bands = averageBands(active);
  const rel = {};
  for (const name of Object.keys(bands)) rel[name] = bands[name] - bands.mid;
  return {
    ok: true,
    noiseFloorDb,
    speechMedianDb: percentile(levels, 0.5),
    speechLoudDb: percentile(levels, 0.9),
    snrDb: percentile(levels, 0.5) - noiseFloorDb,
    rel,
  };
}

// Turn an analysis into parameter values (ids match PARAMS in engine.js) plus plain-English notes.
function suggest(a) {
  const notes = [];
  const TARGET_LOUD = -22;
  const inGain = clamp(round05(TARGET_LOUD - a.speechLoudDb), -10, 24);
  const noise = a.noiseFloorDb + inGain;
  const loud = a.speechLoudDb + inGain;
  const median = a.speechMedianDb + inGain;

  const gateThr = clamp(round1(Math.min(noise + 10, median - 14)), -70, -30);
  const hpfFreq = a.rel.rumble > -12 ? 120 : a.rel.rumble > -20 ? 100 : 80;

  const eqLow = clamp(round05(0.5 * (TARGET_REL.low - a.rel.low)), -6, 6);
  const eqMud = clamp(round05(0.5 * (TARGET_REL.mud - a.rel.mud)), -8, 3);
  const eqPres = clamp(round05(0.5 * (TARGET_REL.pres - a.rel.pres)), -3, 9);
  const eqAir = clamp(round05(0.5 * (TARGET_REL.air - a.rel.air)), -3, 9);

  const sibExcess = a.rel.sib - a.rel.pres; // per-bin sibilance relative to presence
  const deessThr = clamp(round1(loud - 10 - (sibExcess > 3 ? 4 : 0)), -45, -20); // -32 for a normal voice
  const deessAmt = sibExcess > 4 ? 10 : sibExcess > 1 ? 8 : 6;

  const compThr = clamp(round1(loud - 8), -40, -12);
  const compRatio = 3.5;
  const makeup = clamp(round05((-compThr * (1 - 1 / compRatio)) / 2), 0, 12);

  notes.push(`Noise floor ${a.noiseFloorDb.toFixed(0)} dB, voice ${a.speechMedianDb.toFixed(0)} dB: gate set to ${gateThr} dB.`);
  notes.push(`Input gain ${inGain >= 0 ? '+' : ''}${inGain} dB to bring your voice to a healthy level.`);
  if (a.snrDb < 18) notes.push('Your room is fairly noisy. A closer mic or the "Noisy room" preset will help.');
  if (a.rel.mud - TARGET_REL.mud > 3) notes.push(`Your voice is a little boomy: cutting the 300 Hz mud by ${Math.abs(eqMud)} dB.`);
  if (a.rel.pres - TARGET_REL.pres < -3) notes.push(`Your voice is a little dull: adding ${eqPres} dB of presence.`);
  if (sibExcess > 3) notes.push('Your "s" sounds are sharp: de-esser is set more firmly.');
  if (hpfFreq > 80) notes.push(`Low rumble detected: high-pass raised to ${hpfFreq} Hz.`);

  return {
    values: { inGain, gateThr, hpfFreq, eqLow, eqMud, eqPres, eqAir, deessThr, deessAmt, compThr, compRatio, makeup },
    notes,
  };
}

if (typeof module !== 'undefined') module.exports = { BAND_EDGES, TARGET_REL, computeBands, percentile, analyze, suggest };
