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

## Install and updates

Download `VocalForge Setup x.y.z.exe` from the Releases page and run it. The app checks
GitHub Releases for new versions and installs them when you close it.

To ship an update: bump `version` in `package.json`, commit, then
`git tag vX.Y.Z && git push --tags`. GitHub Actions builds and publishes the installer.
Local test build: `npm run dist` (output in `dist/`). Tests: `npm test`.

Builds are unsigned, so Windows SmartScreen will warn on first run ("More info" -> "Run anyway").

## Roadmap

- [x] Phase 1: passthrough, meters, device selection
- [x] Phase 2: gate, EQ, compressor, limiter, presets
- [x] RNNoise AI noise suppression (off by default; adds 10 ms while on)
- [x] Desktop audio channel (music, game audio) with its own level
- [ ] Routing matrix and more inputs
- [x] De-esser
- [x] Blown-out mic toggle: loud, clipped, crunchy bad-mic effect (one click, adjustable)
- [x] Auto-tune wizard (listens to your room and voice, suggests gate/EQ/de-esser/compressor)
- [x] In-app setup wizard (Settings > Debug previews it)
- [x] Local soundboard with global hotkeys, played into the mic output; global mute hotkey
- [x] Sound pack catalog: browse curated, license-declared packs and install them in one click (`catalog/index.json`)
- [x] Tray, launch at startup, close to tray, hotkeys
- [ ] Native engine (Rust/C++) for lower latency
