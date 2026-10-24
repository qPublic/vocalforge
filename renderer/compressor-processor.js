// Feed-forward compressor with a soft knee. Unlike the browser's DynamicsCompressorNode it has NO
// hidden automatic makeup gain: the output is exactly input - reduction + makeup.
class CompressorProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -22, minValue: -80, maxValue: 0 },
      { name: 'ratio', defaultValue: 3, minValue: 1, maxValue: 20 },
      { name: 'attack', defaultValue: 0.008, minValue: 0.0005, maxValue: 0.3 },
      { name: 'release', defaultValue: 0.2, minValue: 0.01, maxValue: 2 },
      { name: 'knee', defaultValue: 6, minValue: 0, maxValue: 24 },
      { name: 'makeup', defaultValue: 0, minValue: 0, maxValue: 30 },
      { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.env = 1e-6; // smoothed peak level of the input
    this.grDb = 0; // smoothed gain reduction in dB (<= 0)
    this.makeupDb = 0;
    this.n = 0;
    this.detRelease = Math.exp(-1 / (sampleRate * 0.03)); // detector fall time, keeps ripple off low voices
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input.length || !input[0].length) return true;

    const x = input[0];
    const frames = x.length;
    const enabled = params.enabled[0] >= 0.5;
    const thr = params.threshold[0];
    const slope = 1 / params.ratio[0] - 1; // <= 0
    const knee = params.knee[0];
    const aCoef = Math.exp(-1 / (sampleRate * params.attack[0]));
    const rCoef = Math.exp(-1 / (sampleRate * params.release[0]));
    const makeupTarget = enabled ? params.makeup[0] : 0;
    const mCoef = Math.exp(-1 / (sampleRate * 0.02)); // click-free makeup changes

    for (let i = 0; i < frames; i++) {
      const a = Math.abs(x[i]);
      this.env = a > this.env ? a : a + (this.env - a) * this.detRelease;
      const levelDb = 20 * Math.log10(Math.max(this.env, 1e-6));

      // Static curve: how much the level should be reduced (<= 0 dB).
      let targetGr = 0;
      if (enabled) {
        const over = levelDb - thr;
        if (knee > 0 && 2 * Math.abs(over) <= knee) {
          const t = over + knee / 2;
          targetGr = (slope * t * t) / (2 * knee);
        } else if (over > 0) {
          targetGr = slope * over;
        }
      }

      // Smooth in the dB domain: attack when reduction grows, release when it relaxes.
      const c = targetGr < this.grDb ? aCoef : rCoef;
      this.grDb = targetGr + (this.grDb - targetGr) * c;
      this.makeupDb = makeupTarget + (this.makeupDb - makeupTarget) * mCoef;

      const g = Math.pow(10, (this.grDb + this.makeupDb) / 20);
      for (let ch = 0; ch < output.length; ch++) output[ch][i] = x[i] * g;
    }

    if ((this.n += frames) >= sampleRate / 20) {
      this.n = 0;
      this.port.postMessage({ reduction: this.grDb });
    }
    return true;
  }
}
registerProcessor('compressor-processor', CompressorProcessor);
