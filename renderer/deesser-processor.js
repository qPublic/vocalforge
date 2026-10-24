// Split-band de-esser: only the sibilance band is turned down when it gets too loud,
// so the rest of the voice is left untouched.
class DeEsserProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'freq', defaultValue: 5500, minValue: 3000, maxValue: 10000 },
      { name: 'threshold', defaultValue: -32, minValue: -60, maxValue: 0 },
      { name: 'amount', defaultValue: 8, minValue: 0, maxValue: 24 },
      { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.coefFreq = 0;
    // Linkwitz-Riley 4th order crossover: two cascaded Butterworth biquads per band.
    // Low + high sum to a flat (all-pass) response, so attenuating only the high band is clean.
    this.hp1 = this.state();
    this.hp2 = this.state();
    this.lp1 = this.state();
    this.lp2 = this.state();
    this.env = 0;
    this.gain = 1;
    this.n = 0;
  }

  state() {
    return { x1: 0, x2: 0, y1: 0, y2: 0 };
  }

  setCoefs(freq) {
    const w = (2 * Math.PI * freq) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * 0.7071);
    const a0 = 1 + alpha;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
    this.hb0 = (1 + cos) / 2 / a0;
    this.hb1 = -(1 + cos) / a0;
    this.lb0 = (1 - cos) / 2 / a0;
    this.lb1 = (1 - cos) / a0;
    this.coefFreq = freq;
  }

  biquad(s, x, b0, b1) {
    const y = b0 * x + b1 * s.x1 + b0 * s.x2 - this.a1 * s.y1 - this.a2 * s.y2;
    s.x2 = s.x1;
    s.x1 = x;
    s.y2 = s.y1;
    s.y1 = y;
    return y;
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input.length || !input[0].length) return true;

    const freq = params.freq[0];
    if (freq !== this.coefFreq) this.setCoefs(freq);
    const enabled = params.enabled[0] >= 0.5;
    const thr = Math.pow(10, params.threshold[0] / 20);
    const maxCut = Math.pow(10, -params.amount[0] / 20); // lowest gain the band may reach
    const aCoef = Math.exp(-1 / (sampleRate * 0.0008));
    const rCoef = Math.exp(-1 / (sampleRate * 0.03));
    const frames = input[0].length;
    const x = input[0];

    for (let i = 0; i < frames; i++) {
      const high = this.biquad(this.hp2, this.biquad(this.hp1, x[i], this.hb0, this.hb1), this.hb0, this.hb1);
      const low = this.biquad(this.lp2, this.biquad(this.lp1, x[i], this.lb0, this.lb1), this.lb0, this.lb1);
      const a = Math.abs(high);
      this.env = a > this.env ? a + (this.env - a) * aCoef : a + (this.env - a) * rCoef;

      let target = 1;
      if (enabled && this.env > thr) target = Math.max(maxCut, thr / this.env);
      const c = target < this.gain ? aCoef : rCoef;
      this.gain = target + (this.gain - target) * c;

      const y = low + high * this.gain;
      for (let ch = 0; ch < output.length; ch++) output[ch][i] = y;
    }

    if ((this.n += frames) >= sampleRate / 20) {
      this.n = 0;
      this.port.postMessage({ gain: this.gain });
    }
    return true;
  }
}
registerProcessor('deesser-processor', DeEsserProcessor);
