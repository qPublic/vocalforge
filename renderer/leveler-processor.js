// Voice leveler: a slow automatic volume control. When you lean away from the mic or speak softly it brings you
// up toward the target level; when you get loud it brings you down. It moves slowly (a few dB per second) so it
// never sounds like pumping, and it holds still whenever you are not talking, so room noise is not raised.
class LevelerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'target', defaultValue: -22, minValue: -36, maxValue: -10 },
      { name: 'range', defaultValue: 9, minValue: 0, maxValue: 18 },
      { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.env = 0; // mean square of the signal, about 150 ms long
    this.gainDb = 0;
    this.gain = 1;
    this.count = 0;
    this.envCoef = 1 - Math.exp(-1 / (sampleRate * 0.15));
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input.length || !input[0].length) return true;

    const on = params.enabled[0] >= 0.5;
    const target = params.target[0];
    const range = params.range[0];
    const STEP = 64; // the gain is re-evaluated every 64 samples
    const dt = STEP / sampleRate;
    const UP = 4 * dt; // dB per step: 4 dB per second up,
    const DOWN = 12 * dt; // 12 dB per second down (loud is corrected faster than quiet)
    const SPEECH_DB = -50; // below this the signal is treated as silence and the gain holds
    const x = input[0];
    const frames = x.length;

    for (let i = 0; i < frames; i++) {
      this.env += (x[i] * x[i] - this.env) * this.envCoef;
      if (++this.count >= STEP) {
        this.count = 0;
        if (!on) {
          this.gainDb = 0;
        } else {
          const envDb = 10 * Math.log10(this.env + 1e-12);
          if (envDb > SPEECH_DB) {
            const want = Math.min(range, Math.max(-range, target - envDb));
            const d = want - this.gainDb;
            this.gainDb += Math.min(UP, Math.max(-DOWN, d));
          }
          this.gainDb = Math.min(range, Math.max(-range, this.gainDb)); // a smaller range takes effect at once
        }
        this.gain = Math.pow(10, this.gainDb / 20);
      }
      const y = x[i] * this.gain;
      for (let ch = 0; ch < output.length; ch++) output[ch][i] = y;
    }
    return true;
  }
}
registerProcessor('leveler-processor', LevelerProcessor);
