// "Blown-out mic": the sound of a cheap mic turned way past its limit.
// Thin low end -> massive drive into hard clipping -> sample-rate and bit-depth reduction -> harsh top cut.
// Disabled, it passes audio through untouched.
class BlownProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'drive', defaultValue: 26, minValue: 0, maxValue: 50 }, // dB of gain into the clipper
      { name: 'bits', defaultValue: 9, minValue: 3, maxValue: 16 },
      { name: 'hold', defaultValue: 3, minValue: 1, maxValue: 16 }, // keep every Nth sample
      { name: 'tone', defaultValue: 5500, minValue: 1500, maxValue: 16000 }, // top-end cut, Hz
      { name: 'level', defaultValue: -4, minValue: -24, maxValue: 6 },
      { name: 'enabled', defaultValue: 0, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.hpState = 0;
    this.hpPrev = 0;
    this.held = 0;
    this.counter = 0;
    this.lp1 = 0;
    this.lp2 = 0;
    this.toneFreq = 0;
    this.lpCoef = 0;
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input.length || !input[0].length) return true;
    const x = input[0];
    const frames = x.length;

    if (params.enabled[0] < 0.5) {
      for (let ch = 0; ch < output.length; ch++) output[ch].set(x);
      return true;
    }

    const drive = Math.pow(10, params.drive[0] / 20);
    const step = Math.pow(2, 1 - Math.round(params.bits[0])); // quantizer step for a -1..1 signal
    const hold = Math.max(1, Math.round(params.hold[0]));
    const level = Math.pow(10, params.level[0] / 20);
    const tone = params.tone[0];
    if (tone !== this.toneFreq) {
      this.toneFreq = tone;
      this.lpCoef = 1 - Math.exp((-2 * Math.PI * tone) / sampleRate);
    }
    const hpCoef = Math.exp((-2 * Math.PI * 250) / sampleRate); // thin out the lows like a tiny capsule

    for (let i = 0; i < frames; i++) {
      // One-pole high-pass at 250 Hz.
      this.hpState = hpCoef * (this.hpState + x[i] - this.hpPrev);
      this.hpPrev = x[i];

      // Hard clip after a huge gain boost.
      let v = this.hpState * drive;
      v = v > 1 ? 1 : v < -1 ? -1 : v;

      // Sample-and-hold decimation, then bit crush.
      if (this.counter++ % hold === 0) this.held = Math.round(v / step) * step;

      // Two one-pole low-passes take the edge off the aliasing without making it clean.
      this.lp1 += this.lpCoef * (this.held - this.lp1);
      this.lp2 += this.lpCoef * (this.lp1 - this.lp2);

      const y = this.lp2 * level;
      for (let ch = 0; ch < output.length; ch++) output[ch][i] = y;
    }
    return true;
  }
}
registerProcessor('blown-processor', BlownProcessor);
