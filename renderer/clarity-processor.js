// Clarity: makes the starts of words and the consonants (t, k, p, d, b, ch) stand out so speech is easier to
// follow and does not sound slurred. It looks only at the 1.2-4.5 kHz band, where consonants live: when that
// band gets suddenly louder than its recent average (a word or syllable starting), it is lifted for a moment.
// Vowels and sibilance (above 5 kHz) are left alone, and the de-esser still sits before the output.
class ClarityProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'amount', defaultValue: 0.4, minValue: 0, maxValue: 1 },
      { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    // 2nd-order Butterworth high-pass at 1.2 kHz and low-pass at 4.5 kHz make the consonant band.
    const mk = (f, high) => {
      const w = (2 * Math.PI * f) / sampleRate;
      const cos = Math.cos(w);
      const alpha = Math.sin(w) / (2 * 0.7071);
      const a0 = 1 + alpha;
      const b0 = (high ? (1 + cos) : (1 - cos)) / 2 / a0;
      const b1 = (high ? -(1 + cos) : (1 - cos)) / a0;
      return { b0, b1, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
    };
    this.hp = mk(1200, true);
    this.lp = mk(4500, false);
    this.fast = 0;
    this.slow = 0;
    this.gain = 1;
    this.fa = Math.exp(-1 / (sampleRate * 0.0005));
    this.fr = Math.exp(-1 / (sampleRate * 0.012));
    this.sa = Math.exp(-1 / (sampleRate * 0.025));
    this.sr = Math.exp(-1 / (sampleRate * 0.1));
    this.ga = Math.exp(-1 / (sampleRate * 0.001));
    this.gr = Math.exp(-1 / (sampleRate * 0.012));
  }

  bq(s, x) {
    const y = s.b0 * x + s.b1 * s.x1 + s.b0 * s.x2 - s.a1 * s.y1 - s.a2 * s.y2;
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

    const amount = params.enabled[0] >= 0.5 ? params.amount[0] : 0;
    const frames = input[0].length;
    const x = input[0];
    const EPS = 2e-4; // about -74 dB: never boost noise that is far below speech

    for (let i = 0; i < frames; i++) {
      const band = this.bq(this.lp, this.bq(this.hp, x[i]));
      const a = Math.abs(band);
      this.fast = a > this.fast ? a + (this.fast - a) * this.fa : a + (this.fast - a) * this.fr;
      this.slow = a > this.slow ? a + (this.slow - a) * this.sa : a + (this.slow - a) * this.sr;

      // How far the band just jumped above its recent average, 0 (steady) to 1 (6 dB or more).
      const rise = (20 * Math.log10((this.fast + EPS) / (this.slow + EPS))) / 6;
      const onset = Math.min(1, Math.max(0, rise));
      // Up to +6 dB on a word onset, plus a steady +2 dB so consonants never sink under the vowels.
      const target = Math.pow(10, (amount * (2 + 6 * onset)) / 20);
      const c = target > this.gain ? this.ga : this.gr;
      this.gain = target + (this.gain - target) * c;

      const y = x[i] + band * (this.gain - 1);
      for (let ch = 0; ch < output.length; ch++) output[ch][i] = y;
    }
    return true;
  }
}
registerProcessor('clarity-processor', ClarityProcessor);
