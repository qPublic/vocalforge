# VocalForge

A mic-enhancement mixer for Windows. Captures your microphone, runs it through a
voice chain, and sends the result to any output, such as a virtual cable you can
select as the mic in Discord, OBS or Zoom.

## Signal chain

Mic -> input gain -> high-pass -> noise gate -> 4-band EQ -> compressor -> makeup -> limiter -> output

## Run

```
npm install
npm start
```

Set **Output** to `CABLE Input` (VB-Cable) and pick `CABLE Output` as the mic in your
chat app. Use headphones when monitoring.

## Roadmap

- [x] Phase 1: passthrough, meters, device selection
- [x] Phase 2: gate, EQ, compressor, limiter, presets
- [ ] RNNoise AI noise suppression
- [ ] De-esser
- [ ] Auto-tune wizard (analyze voice, set EQ and compressor)
- [ ] Multi-input mixer (mic, desktop audio, music) and routing
- [ ] Tray, start with Windows, hotkeys, installer
- [ ] Native engine (Rust/C++) for lower latency
