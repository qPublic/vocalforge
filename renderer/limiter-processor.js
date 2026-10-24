// Lookahead brickwall limiter. The signal is delayed by 2 ms so the gain can start falling before a
// peak arrives; the result never exceeds the ceiling. Adds 2 ms of latency while enabled.
const LOOKAHEAD = 96; // samples (2 ms at 48 kHz)

class LimiterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'ceiling', defaultValue: -1.5, minValue: -24, maxValue: 0 },
      { name: 'release', defaultValue: 0.08, minValue: 0.01, maxValue: 1 },
      { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    const size = LOOKAHEAD + 1;
    this.size = size;
    this.delay = new Float32Array(size); // audio, delayed by LOOKAHEAD samples
    this.targets = new Float32Array(size).fill(1); // per-sample gain each sample needs
    this.mins = new Float32Array(size).fill(1); // sliding-window minimum of `targets`
    this.pos = 0;
    this.sum = size; // running sum of `mins`
    this.held = 1; // release-smoothed window minimum
    this.n = 0;
    this.minGain = 1;
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input.length || !input[0].length) return true;

    const x = input[0];
    const frames = x.length;
    const enabled = params.enabled[0] >= 0.5;
    const ceil = Math.pow(10, params.ceiling[0] / 20);
    const rCoef = Math.exp(-1 / (sampleRate * params.release[0]));
    const size = this.size;

    for (let i = 0; i < frames; i++) {
      const p = this.pos;
      const a = Math.abs(x[i]);
      this.targets[p] = enabled && a > ceil ? ceil / a : 1;
      this.delay[p] = x[i];

      // Lowest gain needed by any sample in the last LOOKAHEAD+1 samples.
      let wmin = 1;
      for (let k = 0; k < size; k++) if (this.targets[k] < wmin) wmin = this.targets[k];

      // Fall instantly, recover slowly. This stays at or below wmin, so the guarantee holds.
      this.held = wmin < this.held ? wmin : wmin + (this.held - wmin) * rCoef;

      // A moving average over the same window turns the instant fall into a smooth ramp, while every
      // term still sits at or below the gain the oldest sample needs.
      const old = this.mins[p];
      this.mins[p] = this.held;
      this.sum += this.held - old;
      const gain = this.sum / size;

      this.pos = p + 1 === size ? 0 : p + 1;
      const y = this.delay[this.pos] * gain; // oldest sample, LOOKAHEAD samples late
      for (let ch = 0; ch < output.length; ch++) output[ch][i] = y;
      if (gain < this.minGain) this.minGain = gain;
    }

    if ((this.n += frames) >= sampleRate / 20) {
      this.n = 0;
      this.port.postMessage({ gain: this.minGain });
      this.minGain = 1;
    }
    return true;
  }
}
registerProcessor('limiter-processor', LimiterProcessor);
