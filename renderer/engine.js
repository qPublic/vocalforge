// Audio engine: mic -> HPF -> noise suppression -> gate -> EQ -> de-esser -> compressor -> limiter -> out
// Params are declared once in PARAMS; the UI and presets are generated from it.

const PARAMS = {
  Input: [
    { id: 'inGain', label: 'Input gain', min: -20, max: 30, step: 0.5, def: 0, unit: 'dB' },
  ],
  'Noise suppression': [
    { id: 'nsOn', label: 'On', type: 'toggle', def: false },
    { id: 'nsAmt', label: 'Amount', min: 0, max: 100, step: 5, def: 100, unit: '%' },
  ],
  'High-pass': [
    { id: 'hpfOn', label: 'On', type: 'toggle', def: true },
    { id: 'hpfFreq', label: 'Frequency', min: 20, max: 300, step: 1, def: 80, unit: 'Hz' },
  ],
  'Noise gate': [
    { id: 'gateOn', label: 'On', type: 'toggle', def: true },
    { id: 'gateThr', label: 'Threshold', min: -90, max: -10, step: 1, def: -52, unit: 'dB' },
    { id: 'gateRel', label: 'Release', min: 0.02, max: 1, step: 0.01, def: 0.18, unit: 's' },
  ],
  EQ: [
    { id: 'eqOn', label: 'On', type: 'toggle', def: true },
    { id: 'eqLow', label: 'Low shelf 120 Hz', min: -12, max: 12, step: 0.5, def: 2, unit: 'dB' },
    { id: 'eqMud', label: 'Mud cut 300 Hz', min: -12, max: 6, step: 0.5, def: -2.5, unit: 'dB' },
    { id: 'eqPres', label: 'Presence 3.5 kHz', min: -6, max: 12, step: 0.5, def: 3, unit: 'dB' },
    { id: 'eqAir', label: 'Air shelf 10 kHz', min: -6, max: 12, step: 0.5, def: 2, unit: 'dB' },
  ],
  'De-esser': [
    { id: 'deessOn', label: 'On', type: 'toggle', def: true },
    { id: 'deessFreq', label: 'Crossover', min: 3000, max: 10000, step: 100, def: 5500, unit: 'Hz' },
    { id: 'deessThr', label: 'Threshold', min: -60, max: -10, step: 1, def: -32, unit: 'dB' },
    { id: 'deessAmt', label: 'Max reduction', min: 0, max: 18, step: 0.5, def: 8, unit: 'dB' },
  ],
  Compressor: [
    { id: 'compOn', label: 'On', type: 'toggle', def: true },
    { id: 'compThr', label: 'Threshold', min: -60, max: 0, step: 1, def: -22, unit: 'dB' },
    { id: 'compRatio', label: 'Ratio', min: 1, max: 20, step: 0.5, def: 3, unit: ':1' },
    { id: 'compAtk', label: 'Attack', min: 0.001, max: 0.1, step: 0.001, def: 0.008, unit: 's' },
    { id: 'compRel', label: 'Release', min: 0.05, max: 1, step: 0.01, def: 0.2, unit: 's' },
    { id: 'makeup', label: 'Makeup gain', min: 0, max: 24, step: 0.5, def: 8, unit: 'dB' },
  ],
  'Blown-out mic': [
    { id: 'lofiOn', label: 'On', type: 'toggle', def: false },
    { id: 'lofiDrive', label: 'Drive', min: 0, max: 50, step: 1, def: 26, unit: 'dB' },
    { id: 'lofiBits', label: 'Crunch (bits)', min: 3, max: 16, step: 1, def: 9, unit: 'bit' },
    { id: 'lofiHold', label: 'Rate crush', min: 1, max: 16, step: 1, def: 3, unit: 'x' },
    { id: 'lofiTone', label: 'Top cut', min: 1500, max: 16000, step: 100, def: 5500, unit: 'Hz' },
    { id: 'lofiLevel', label: 'Level', min: -24, max: 6, step: 0.5, def: -4, unit: 'dB' },
  ],
  Limiter: [
    { id: 'limOn', label: 'On', type: 'toggle', def: true },
    { id: 'limCeil', label: 'Ceiling', min: -12, max: 0, step: 0.5, def: -1.5, unit: 'dB' },
  ],
  Output: [
    { id: 'outGain', label: 'Output gain', min: -30, max: 12, step: 0.5, def: 0, unit: 'dB' },
  ],
};

const FLAT = Object.values(PARAMS).flat();
const defaults = () => Object.fromEntries(FLAT.map((p) => [p.id, p.def]));
const dbToLin = (db) => Math.pow(10, db / 20);

class Engine {
  constructor() {
    this.ctx = null;
    this.values = defaults();
    this.onGate = () => {};
    this.onError = () => {};
    this.onDesktopFailed = () => {};
    this.muted = false;
    this.reductionDb = 0;
    this.desktopOn = false;
    this.desktopDb = -6;
    this.boardDb = 0;
    this.sounds = new Map(); // decoded clips for the current context, by name
    this.playing = new Set();
  }

  static async listDevices() {
    let all = await navigator.mediaDevices.enumerateDevices();
    // Labels are empty until permission is granted once.
    if (all.some((d) => d.kind === 'audioinput' && !d.label)) {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach((t) => t.stop());
      all = await navigator.mediaDevices.enumerateDevices();
    }
    return {
      inputs: all.filter((d) => d.kind === 'audioinput'),
      outputs: all.filter((d) => d.kind === 'audiooutput'),
    };
  }

  get isNative() {
    return false;
  }

  listDevices() {
    return Engine.listDevices();
  }

  // Switch the output device without restarting the mixer.
  async setOutput(deviceId) {
    if (this.ctx && this.ctx.setSinkId) await this.ctx.setSinkId(deviceId === 'default' ? '' : deviceId);
  }

  async start({ inputId, outputId, monitorId, monitor }) {
    await this.stop();
    const ctx = (this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 }));
    if (outputId && ctx.setSinkId) await ctx.setSinkId(outputId === 'default' ? '' : outputId);
    await ctx.audioWorklet.addModule('gate-processor.js');
    await ctx.audioWorklet.addModule('deesser-processor.js');
    await ctx.audioWorklet.addModule('compressor-processor.js');
    await ctx.audioWorklet.addModule('limiter-processor.js');
    await ctx.audioWorklet.addModule('blown-processor.js');
    // Noise suppression is optional: if the WASM can't load, carry on without it.
    this.rnReady = false;
    let rnLoaded = false;
    try {
      await ctx.audioWorklet.addModule('rnnoise-processor.js');
      rnLoaded = true;
    } catch (err) {
      this.onError('Noise suppression is unavailable: ' + err.message);
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: inputId && inputId !== 'default' ? { exact: inputId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });

    const n = (this.nodes = {});
    n.src = ctx.createMediaStreamSource(this.stream);
    n.inGain = ctx.createGain();
    n.hpf = ctx.createBiquadFilter();
    n.hpf.type = 'highpass';
    n.hpf.Q.value = 0.707;
    if (rnLoaded) {
      n.rn = new AudioWorkletNode(ctx, 'rnnoise-processor', { channelCountMode: 'explicit', channelCount: 1 });
      n.rn.port.onmessage = (e) => {
        if (e.data.ready) this.rnReady = true;
        if (e.data.error) this.onError('Noise suppression failed to start: ' + e.data.error);
      };
    }
    n.gate = new AudioWorkletNode(ctx, 'gate-processor', { channelCountMode: 'explicit', channelCount: 1 });
    n.gate.port.onmessage = (e) => this.onGate(e.data.gain);
    n.low = this._biquad('lowshelf', 120);
    n.mud = this._biquad('peaking', 300, 1.0);
    n.pres = this._biquad('peaking', 3500, 0.9);
    n.air = this._biquad('highshelf', 10000);
    n.deess = new AudioWorkletNode(ctx, 'deesser-processor', { channelCountMode: 'explicit', channelCount: 1 });
    // Our own compressor and limiter: the browser's built-in ones add hidden makeup gain that
    // stacked with ours and pushed the signal into the limiter.
    n.comp = new AudioWorkletNode(ctx, 'compressor-processor', { channelCountMode: 'explicit', channelCount: 1 });
    n.comp.port.onmessage = (e) => (this.reductionDb = e.data.reduction);
    n.blown = new AudioWorkletNode(ctx, 'blown-processor', { channelCountMode: 'explicit', channelCount: 1 });
    n.lim = new AudioWorkletNode(ctx, 'limiter-processor', { channelCountMode: 'explicit', channelCount: 1 });
    // Soundboard clips join just before the limiter, so they skip the voice processing.
    n.board = ctx.createGain();
    n.board.connect(n.lim);
    n.desktop = ctx.createGain();
    n.desktop.connect(n.lim);
    n.out = ctx.createGain();
    n.inMeter = ctx.createAnalyser();
    n.outMeter = ctx.createAnalyser();
    n.inMeter.fftSize = n.outMeter.fftSize = 1024;

    const chain = [n.src, n.inGain, n.hpf, ...(n.rn ? [n.rn] : []), n.gate, n.low, n.mud, n.pres, n.air, n.deess, n.comp, n.blown, n.lim, n.out];
    chain.reduce((a, b) => (a.connect(b), b));
    n.inGain.connect(n.inMeter);
    n.out.connect(n.outMeter);
    n.out.connect(ctx.destination);

    if (monitor) this._startMonitor(monitorId);
    this.apply();
    if (this.desktopOn) await this._attachDesktop();
    return ctx;
  }

  _biquad(type, freq, q = 0.707) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  _startMonitor(deviceId) {
    this.monDest = this.ctx.createMediaStreamDestination();
    this.nodes.out.connect(this.monDest);
    this.monEl = new Audio();
    this.monEl.srcObject = this.monDest.stream;
    if (deviceId && this.monEl.setSinkId) this.monEl.setSinkId(deviceId === 'default' ? '' : deviceId);
    this.monEl.play();
  }

  set(id, value) {
    this.values[id] = value;
    this.apply();
  }

  load(values) {
    this.values = { ...defaults(), ...values };
    this.apply();
  }

  apply() {
    const n = this.nodes;
    if (!n) return;
    const v = this.values;
    const t = this.ctx.currentTime;
    const ramp = (p, x) => p.setTargetAtTime(x, t, 0.015);

    ramp(n.inGain.gain, dbToLin(v.inGain));
    n.hpf.frequency.setTargetAtTime(v.hpfOn ? v.hpfFreq : 10, t, 0.015);

    if (n.rn) {
      n.rn.parameters.get('enabled').value = v.nsOn ? 1 : 0;
      n.rn.parameters.get('amount').value = v.nsAmt / 100;
    }

    const g = n.gate.parameters;
    g.get('enabled').value = v.gateOn ? 1 : 0;
    g.get('threshold').value = v.gateThr;
    g.get('release').value = v.gateRel;

    const eq = v.eqOn;
    ramp(n.low.gain, eq ? v.eqLow : 0);
    ramp(n.mud.gain, eq ? v.eqMud : 0);
    ramp(n.pres.gain, eq ? v.eqPres : 0);
    ramp(n.air.gain, eq ? v.eqAir : 0);

    const d = n.deess.parameters;
    d.get('enabled').value = v.deessOn ? 1 : 0;
    d.get('freq').value = v.deessFreq;
    d.get('threshold').value = v.deessThr;
    d.get('amount').value = v.deessAmt;

    const c = n.comp.parameters;
    c.get('enabled').value = v.compOn ? 1 : 0;
    c.get('threshold').value = v.compThr;
    c.get('ratio').value = v.compRatio;
    c.get('attack').value = v.compAtk;
    c.get('release').value = v.compRel;
    c.get('makeup').value = v.makeup;

    const b = n.blown.parameters;
    b.get('enabled').value = v.lofiOn ? 1 : 0;
    b.get('drive').value = v.lofiDrive;
    b.get('bits').value = v.lofiBits;
    b.get('hold').value = v.lofiHold;
    b.get('tone').value = v.lofiTone;
    b.get('level').value = v.lofiLevel;

    const l = n.lim.parameters;
    l.get('enabled').value = v.limOn ? 1 : 0;
    l.get('ceiling').value = v.limCeil;
    ramp(n.out.gain, this.muted ? 0 : dbToLin(v.outGain));
    ramp(n.board.gain, dbToLin(this.boardDb));
    ramp(n.desktop.gain, dbToLin(this.desktopDb));
  }

  setMuted(muted) {
    this.muted = muted;
    this.apply();
  }

  // Desktop audio: everything the PC is playing, captured as system loopback.
  async setDesktop(on) {
    this.desktopOn = on;
    if (!this.ctx) return;
    if (on) await this._attachDesktop();
    else this._detachDesktop();
  }

  setDesktopLevel(db) {
    this.desktopDb = db;
    this.apply();
  }

  async _attachDesktop() {
    if (this.desktopStream || !this.nodes) return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      stream.getVideoTracks().forEach((t) => t.stop());
      if (!stream.getAudioTracks().length) throw new Error('no audio was shared');
      this.desktopStream = stream;
      this.desktopSrc = this.ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      this.desktopSrc.connect(this.nodes.desktop);
    } catch (err) {
      this.desktopOn = false;
      this.onDesktopFailed();
      this.onError('Desktop audio is unavailable: ' + err.message);
    }
  }

  _detachDesktop() {
    this.desktopSrc?.disconnect();
    this.desktopStream?.getTracks().forEach((t) => t.stop());
    this.desktopSrc = this.desktopStream = null;
  }

  setBoardLevel(db) {
    this.boardDb = Math.min(0, db);
    this.apply();
  }

  // Plays a clip (bytes from the main process) into the output. Decoded clips are cached.
  async playSound(name, bytes, gainDb = 0) {
    if (!this.ctx) throw new Error('Start the mixer first');
    let buffer = this.sounds.get(name);
    if (!buffer) {
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      buffer = await this.ctx.decodeAudioData(copy);
      this.sounds.set(name, buffer);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    // Per-clip volume, capped at full scale like the board level.
    const clipGain = this.ctx.createGain();
    clipGain.gain.value = dbToLin(Math.min(0, Number.isFinite(gainDb) ? gainDb : 0));
    src.connect(clipGain);
    clipGain.connect(this.nodes.board);
    src.onended = () => {
      this.playing.delete(src);
      src.disconnect();
      clipGain.disconnect();
    };
    this.playing.add(src);
    src.start();
  }

  hasSound(name) {
    return this.sounds.has(name);
  }

  forgetSound(name) {
    this.sounds.delete(name);
  }

  stopSounds() {
    for (const src of this.playing) {
      try {
        src.stop();
      } catch {}
    }
  }

  // Peak level in dBFS for 'in' or 'out'.
  level(which) {
    const a = which === 'in' ? this.nodes?.inMeter : this.nodes?.outMeter;
    if (!a) return -100;
    this._buf = this._buf?.length === a.fftSize ? this._buf : new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(this._buf);
    let peak = 0;
    for (const s of this._buf) peak = Math.max(peak, Math.abs(s));
    return peak > 0 ? 20 * Math.log10(peak) : -100;
  }

  get reduction() {
    return this.reductionDb ?? 0; // dB, zero or negative
  }

  get latencyMs() {
    if (!this.ctx) return 0;
    const noiseFrame = this.values.nsOn && this.rnReady ? 0.01 : 0; // RNNoise buffers one 10 ms frame
    const limiter = this.values.limOn ? 0.002 : 0; // lookahead
    return Math.round((this.ctx.baseLatency + (this.ctx.outputLatency || 0) + noiseFrame + limiter) * 1000);
  }

  async stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this._detachDesktop();
    this.monEl?.pause();
    this.monEl = null;
    if (this.ctx) await this.ctx.close();
    this.ctx = this.nodes = this.stream = null;
    this.sounds.clear();
    this.playing.clear();
  }
}
