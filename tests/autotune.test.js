const test = require('node:test');
const assert = require('node:assert/strict');
const { computeBands, analyze, suggest, TARGET_REL } = require('../renderer/autotune-core');

// Build a frame whose per-band level is `mid + rel[band]` (dB), at a given overall rms.
function frame(rmsDb, midDb, rel = {}) {
  const base = { rumble: -30, low: TARGET_REL.low, mud: TARGET_REL.mud, mid: 0, pres: TARGET_REL.pres, sib: TARGET_REL.pres - 3, air: TARGET_REL.air };
  const bands = {};
  for (const k of Object.keys(base)) bands[k] = midDb + (rel[k] ?? base[k]);
  return { rmsDb, bands };
}
const many = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
const session = ({ noise = -60, speech = -26, rel = {} } = {}) => ({
  silence: many(40, (i) => frame(noise + (i % 3), noise - 20)),
  speech: many(120, (i) => frame(speech + ((i % 7) - 3), -40, rel)),
});

test('computeBands averages bins into bands in the power domain', () => {
  const bins = new Float32Array(1024).fill(-80);
  const binHz = 48000 / 2048;
  for (let i = Math.floor(500 / binHz); i <= Math.ceil(2000 / binHz); i++) bins[i] = -30;
  const b = computeBands(bins, 48000, 2048);
  assert.ok(Math.abs(b.mid - -30) < 0.01, `mid ${b.mid}`);
  assert.ok(b.low < -70, `low ${b.low}`);
});

test('analyze: rejects silence-only recordings', () => {
  const s = session();
  s.speech = many(120, () => frame(-58, -80));
  assert.equal(analyze(s).ok, false);
});

test('suggest: quiet voice gets more input gain than a loud voice', () => {
  const quiet = suggest(analyze(session({ speech: -38 })));
  const loud = suggest(analyze(session({ speech: -18 })));
  assert.ok(quiet.values.inGain > loud.values.inGain + 10, `${quiet.values.inGain} vs ${loud.values.inGain}`);
});

test('suggest: gate sits above the noise floor and below the voice', () => {
  const a = analyze(session({ noise: -60, speech: -26 }));
  const { values } = suggest(a);
  const noise = a.noiseFloorDb + values.inGain;
  const voice = a.speechMedianDb + values.inGain;
  assert.ok(values.gateThr > noise, `gate ${values.gateThr} vs noise ${noise}`);
  assert.ok(values.gateThr < voice - 8, `gate ${values.gateThr} vs voice ${voice}`);
});

test('suggest: boomy voice gets a deeper mud cut', () => {
  const flat = suggest(analyze(session())).values.eqMud;
  const boomy = suggest(analyze(session({ rel: { mud: 8 } }))).values.eqMud;
  assert.ok(boomy < flat - 2, `boomy ${boomy} vs flat ${flat}`);
});

test('suggest: dull voice gets more presence than a bright one', () => {
  const dull = suggest(analyze(session({ rel: { pres: -18 } }))).values.eqPres;
  const bright = suggest(analyze(session({ rel: { pres: 0 } }))).values.eqPres;
  assert.ok(dull > bright + 3, `dull ${dull} vs bright ${bright}`);
});

test('suggest: sharp sibilance tightens the de-esser', () => {
  const normal = suggest(analyze(session()));
  const sharp = suggest(analyze(session({ rel: { sib: 2 } })));
  assert.ok(sharp.values.deessThr < normal.values.deessThr);
  assert.ok(sharp.values.deessAmt > normal.values.deessAmt);
});

test('suggest: rumble raises the high-pass and every value stays in its slider range', () => {
  const rumbly = suggest(analyze(session({ rel: { rumble: -5 } })));
  assert.equal(rumbly.values.hpfFreq, 120);

  // Compare against the real param ranges declared in the engine.
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'renderer', 'engine.js'), 'utf8');
  const params = new Function(src.slice(src.indexOf('const PARAMS'), src.indexOf('const FLAT')) + '; return PARAMS;')();
  const flat = Object.values(params).flat();
  for (const extreme of [session({ speech: -50, noise: -45, rel: { mud: 20, pres: -30, sib: 10, rumble: 0 } }), session({ speech: -8, rel: { mud: -20, pres: 10, air: 10 } })]) {
    const a = analyze(extreme);
    if (!a.ok) continue;
    for (const [id, v] of Object.entries(suggest(a).values)) {
      const p = flat.find((x) => x.id === id);
      assert.ok(p, `unknown param ${id}`);
      assert.ok(v >= p.min && v <= p.max, `${id}=${v} outside ${p.min}..${p.max}`);
    }
  }
});

test('suggest: a natural, in-the-room sound: slow gate, gentle compression, small EQ moves', () => {
  const steady = suggest(analyze(session())).values;
  assert.ok(steady.gateRel >= 0.25, 'the gate lets words decay');
  assert.ok(steady.compRatio <= 3 && steady.compAtk >= 0.012, 'compression is gentle and keeps word onsets');
  const extreme = suggest(analyze(session({ rel: { mud: 20, pres: -30, low: 15, air: -40 } }))).values;
  for (const k of ['eqLow', 'eqMud', 'eqPres', 'eqAir']) assert.ok(Math.abs(extreme[k]) <= 6, `${k} ${extreme[k]}`);
  assert.ok(extreme.eqPres <= 5 && extreme.eqAir <= 4);
});

test('suggest: a voice that varies a lot gets a little more compression than a steady one', () => {
  const varied = analyze({ ...session(), speech: many(120, (i) => frame(i % 5 === 0 ? -14 : -34, -40)) });
  const steady = analyze(session());
  assert.ok(suggest(varied).values.compRatio > suggest(steady).values.compRatio);
});
