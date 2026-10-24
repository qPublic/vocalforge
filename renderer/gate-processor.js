// Noise gate with envelope follower, hysteresis-free smooth gain.
class GateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -50, minValue: -90, maxValue: 0 },
      { name: 'attack', defaultValue: 0.005, minValue: 0.001, maxValue: 0.2 },
      { name: 'release', defaultValue: 0.15, minValue: 0.01, maxValue: 2 },
      { name: 'floor', defaultValue: -80, minValue: -90, maxValue: 0 },
      { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.env = 0;
    this.gain = 1;
    this.n = 0;
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input.length) return true;

    const thr = Math.pow(10, params.threshold[0] / 20);
    const floor = Math.pow(10, params.floor[0] / 20);
    const enabled = params.enabled[0] >= 0.5;
    const aCoef = Math.exp(-1 / (sampleRate * params.attack[0]));
    const rCoef = Math.exp(-1 / (sampleRate * params.release[0]));
    const frames = input[0].length;

    for (let i = 0; i < frames; i++) {
      let peak = 0;
      for (let c = 0; c < input.length; c++) peak = Math.max(peak, Math.abs(input[c][i]));
      this.env = peak > this.env ? peak : this.env * 0.9995 + peak * 0.0005;

      const target = !enabled || this.env > thr ? 1 : floor;
      const coef = target > this.gain ? aCoef : rCoef;
      this.gain = target + (this.gain - target) * coef;

      for (let c = 0; c < output.length; c++) {
        output[c][i] = input[Math.min(c, input.length - 1)][i] * this.gain;
      }
    }

    if ((this.n += frames) >= sampleRate / 20) {
      this.n = 0;
      this.port.postMessage({ gain: this.gain });
    }
    return true;
  }
}
registerProcessor('gate-processor', GateProcessor);
