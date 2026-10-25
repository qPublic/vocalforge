// Buffer sizes the Settings list offers; anything else saved is ignored.
const NATIVE_BUFFER_CHOICES = [128, 240, 480, 960];

// Drop-in replacement for Engine (engine.js) that drives the native engine.exe over the main process.
// It exposes the same methods and properties, so app.js, the soundboard and the desktop-audio code
// work with either engine unchanged. Relies on globals from engine.js: defaults().

class NativeEngine {
  constructor() {
    this.isNative = true;
    this.values = defaults();
    this.muted = false;
    this.bypass = false;
    this.desktopOn = false;
    this.desktopDb = -6;
    this.boardDb = 0;
    this.running = false;
    this.meters = { in: -100, out: -100, gr: 0, gate: 1, latencyMs: 0 };
    this.measuredMs = null;
    this.pending = new Map();
    this.nextId = 1;
    this.onGate = () => {};
    this.onError = () => {};
    this.onDesktopFailed = () => {};
    this.onExited = () => {};
    window.vf.onEngineEvent((e) => this._event(e));
  }

  // ----- talking to the engine -----
  _send(cmd) {
    return window.vf.sendEngine(cmd);
  }

  _call(cmd, timeoutMs = 8000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The audio engine did not answer'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      Promise.resolve(window.vf.sendEngine({ ...cmd, id })).then(
        (ok) => {
          if (ok) return;
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new Error('The native audio engine is not available'));
        },
        (err) => {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        },
      );
    });
  }

  _event(e) {
    if (e.id != null && this.pending.has(e.id)) {
      const p = this.pending.get(e.id);
      this.pending.delete(e.id);
      clearTimeout(p.timer);
      return e.event === 'error' ? p.reject(new Error(e.message)) : p.resolve(e);
    }
    switch (e.event) {
      case 'meters':
        this.meters = { in: e.in, out: e.out, gr: e.gr, gate: e.gate, latencyMs: e.latencyMs };
        this.onGate(e.gate);
        break;
      case 'error':
        // An error that carries an id answers a call that already timed out or was cancelled.
        if (e.id == null) this.onError(e.message);
        break;
      case 'exited': {
        const wasRunning = this.running;
        this.running = false;
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error('The audio engine stopped'));
        }
        this.pending.clear();
        this.meters = { in: -100, out: -100, gr: 0, gate: 1, latencyMs: 0 };
        this.measuredMs = null;
        if (wasRunning) {
          this.onError('The native audio engine stopped unexpectedly. Press Start to restart it.');
          this.onExited();
        }
        break;
      }
    }
  }

  // ----- Engine interface -----
  async listDevices() {
    const r = await this._call({ cmd: 'devices' });
    return { inputs: r.inputs, outputs: r.outputs };
  }

  async start({ inputId, outputId, monitorId, monitor }) {
    await this.stop();
    const saved = Number(typeof store !== 'undefined' && store.nativeBuffer);
    const frames = NATIVE_BUFFER_CHOICES.includes(saved) ? saved : 240;
    await this._call({
      cmd: 'start',
      input: inputId || 'default',
      output: outputId || 'default',
      monitor: { on: !!monitor, device: monitorId || 'default' },
      bufferFrames: frames,
    });
    this.running = true;
    this.apply();
    this._send({ cmd: 'mute', on: this.muted });
    this._send({ cmd: 'bypass', on: this.bypass });
    this._send({ cmd: 'boardLevel', db: this.boardDb });
    if (this.desktopOn) await this.setDesktop(true);
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    try {
      await this._call({ cmd: 'stop' });
    } catch {}
    this.meters = { in: -100, out: -100, gr: 0, gate: 1, latencyMs: 0 };
    this.measuredMs = null;
  }

  set(id, value) {
    if (id === 'nsOn') this.measuredMs = null;
    this.values[id] = value;
    this._send({ cmd: 'set', values: { [id]: value } });
  }

  load(values) {
    this.measuredMs = null;
    this.values = { ...defaults(), ...values };
    this.apply();
  }

  apply() {
    this._send({ cmd: 'set', values: this.values });
  }

  level(which) {
    return which === 'in' ? this.meters.in : this.meters.out;
  }

  get reduction() {
    return this.meters.gr;
  }

  get latencyMs() {
    return this.measuredMs != null ? this.measuredMs : Math.round(this.meters.latencyMs);
  }

  get latencyMeasured() {
    return this.measuredMs != null;
  }

  // A/B comparison: while on, only the input gain and limiter act on the mic.
  setBypass(on) {
    this.bypass = on;
    this._send({ cmd: 'bypass', on });
  }

  setMuted(m) {
    this.muted = m;
    this._send({ cmd: 'mute', on: m });
  }

  setBoardLevel(db) {
    this.boardDb = Math.min(0, db);
    this._send({ cmd: 'boardLevel', db: this.boardDb });
  }

  setDesktopLevel(db) {
    this.desktopDb = db;
    this._send({ cmd: 'desktopLevel', db });
  }

  async setDesktop(on) {
    this.desktopOn = on;
    if (!this.running) return;
    try {
      await this._call({ cmd: 'desktop', on, db: this.desktopDb });
    } catch (err) {
      this.desktopOn = false;
      this.onDesktopFailed();
      this.onError('Desktop audio is unavailable: ' + err.message);
    }
  }

  async setOutput(deviceId) {
    if (this.running) await this._call({ cmd: 'output', device: deviceId || 'default' });
  }

  // The main process turns the clip name into a path inside the sounds library.
  async playSound(name, bytes, gainDb = 0) {
    await this._call({ cmd: 'play', name, gain: gainDb });
  }

  // Plays a click through the chain and times it at the output device. Takes about 3 seconds.
  async measureLatency() {
    const r = await this._call({ cmd: 'measure' }, 20000);
    // The header shows this real figure instead of the engine's worst-case estimate, until a setting
    // that changes the delay (noise suppression, a restart) makes it out of date.
    this.measuredMs = Math.round(r.outputMs + r.inputMs);
    return r;
  }

  hasSound() {
    return true; // the engine reads and caches clips itself
  }

  forgetSound() {}

  stopSounds() {
    this._send({ cmd: 'stopSounds' });
  }
}
