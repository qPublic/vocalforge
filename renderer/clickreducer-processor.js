// Click reducer: quiets the sharp "clack" of a keyboard or a mouse button. A click is a very short, sudden burst
// of high-frequency energy. When the 2.5 kHz and up band jumps far above its recent average, the sound is turned
// down for a few milliseconds. The bar is lower when you are not talking (nothing to protect) and much higher
// while a voice is present, so the crisp starts of "t" and "k" are left alone.
class ClickReducerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'amount', defaultValue: 0.6, minValue: 0, maxValue: 1 },
      { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    const mk = (f, high) => {
      const w = (2 * Math.PI * f) / sampleRate;
      const cos = Math.cos(w);
      const alpha = Math.sin(w) / (2 * 0.7071);
      const a0 = 1 + alpha;
      const b0 = (high ? 1 + cos : 1 - cos) / 2 / a0;
      const b1 = (high ? -(1 + cos) : 1 - cos) / a0;
      return { b0, b1, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
    };
    this.hp = mk(2500, true); // the "click" band
    this.lp = mk(1500, false); // the voice band
    this.fast = 0;
    this.base = 0;
    this.voice = 0;
    this.hold = 0;
    this.gain = 1;
    const k = (ms) => Math.exp(-1 / (sampleRate * ms * 0.001));
    this.fa = k(0.1);
    this.fr = k(4);
    this.ba = k(50);
    this.br = k(400);
    this.va = k(5);
    this.vr = k(80);
    this.ga = k(0.5); // gain falls in half a millisecond,
    this.gr = k(20); // and comes back in 20 ms
    this.holdSamples = Math.round(sampleRate * 0.012);
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
    const cut = Math.pow(10, (-24 * amount) / 20); // up to 24 dB down
    const FLOOR = 0.003; // about -50 dB: ignore tiny sounds
    const VOICE = 0.006; // about -44 dB in the voice band counts as someone talking
    const x = input[0];
    const frames = x.length;

    for (let i = 0; i < frames; i++) {
      const h = Math.abs(this.bq(this.hp, x[i]));
      const l = Math.abs(this.bq(this.lp, x[i]));
      this.fast = h > this.fast ? h + (this.fast - h) * this.fa : h + (this.fast - h) * this.fr;
      this.base = h > this.base ? h + (this.base - h) * this.ba : h + (this.base - h) * this.br;
      this.voice = l > this.voice ? l + (this.voice - l) * this.va : l + (this.voice - l) * this.vr;

      const talking = this.voice > VOICE;
      const ratio = talking ? 10 : 3.2; // +20 dB over the average while talking, +10 dB otherwise
      if (amount > 0 && this.fast > FLOOR && this.fast > this.base * ratio) this.hold = this.holdSamples;
      else if (this.hold > 0) this.hold--;

      const target = this.hold > 0 ? cut : 1;
      this.gain = target + (this.gain - target) * (target < this.gain ? this.ga : this.gr);
      const y = x[i] * this.gain;
      for (let ch = 0; ch < output.length; ch++) output[ch][i] = y;
    }
    return true;
  }
}
registerProcessor('clickreducer-processor', ClickReducerProcessor);
