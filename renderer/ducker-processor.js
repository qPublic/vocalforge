// Ducker: turns the desktop audio (music, game) down while you are talking and brings it back when you stop.
// Input 0 is the desktop audio, input 1 is your microphone, used only to tell when you are speaking.
class DuckerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'amount', defaultValue: 9, minValue: 0, maxValue: 24 },
      { name: 'threshold', defaultValue: -45, minValue: -70, maxValue: -20 },
      { name: 'release', defaultValue: 0.6, minValue: 0.2, maxValue: 2 },
      { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.env = 0;
    this.hold = 0;
    this.gain = 1;
    this.atk = Math.exp(-1 / (sampleRate * 0.005)); // the voice detector reacts in 5 ms and lets go in 50 ms
    this.rel = Math.exp(-1 / (sampleRate * 0.05));
    this.holdSamples = Math.round(sampleRate * 0.3); // stays ducked through short pauses between words
    this.down = Math.exp(-1 / (sampleRate * 0.02)); // the music dips in 20 ms
  }

  process(inputs, outputs, params) {
    const desk = inputs[0] && inputs[0][0];
    const mic = inputs[1] && inputs[1][0];
    const output = outputs[0];
    const frames = output[0].length;
    const thr = Math.pow(10, params.threshold[0] / 20);
    const duckGain = Math.pow(10, -params.amount[0] / 20);
    const up = Math.exp(-1 / (sampleRate * params.release[0]));
    const on = params.enabled[0] >= 0.5;

    for (let i = 0; i < frames; i++) {
      const a = mic ? Math.abs(mic[i]) : 0;
      this.env = a > this.env ? a + (this.env - a) * this.atk : a + (this.env - a) * this.rel;
      if (this.env > thr) this.hold = this.holdSamples;
      else if (this.hold > 0) this.hold--;
      const target = on && this.hold > 0 ? duckGain : 1;
      this.gain = target + (this.gain - target) * (target < this.gain ? this.down : up);
      const y = desk ? desk[i] * this.gain : 0;
      for (let ch = 0; ch < output.length; ch++) output[ch][i] = y;
    }
    return true;
  }
}
registerProcessor('ducker-processor', DuckerProcessor);
