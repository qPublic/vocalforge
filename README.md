# VocalForge

A mic-enhancement mixer for Windows. Captures your microphone, runs it through a
voice chain, and sends the result to any output, such as a virtual cable you can
select as the mic in Discord, OBS or Zoom.

## Signal chain

Mic -> input gain -> high-pass -> noise suppression (RNNoise, optional) -> noise gate -> 4-band EQ
-> de-esser -> compressor -> clarity (optional) -> blown-out mic (optional) -> limiter -> output

The soundboard and desktop audio join just before the limiter, so they skip the voice processing.

## Audio engines

- **Native engine (default).** A C++ engine (WASAPI through miniaudio, RNNoise 0.2) in `engine/`. It runs
  as a separate process and talks to the app over JSON lines. Typical delay is about 40 ms from mic to a
  virtual cable, and Settings > Measure my delay checks it for real with a click played through your effects.
- **Web engine.** The same chain built from Web Audio worklets in `renderer/`. It is used when the native
  engine file is missing or when you turn the native engine off in Settings (restart to switch).

The two engines are kept sound-alike on purpose: `tests/engine.test.js` runs the same audio through both
and compares the results.

## Run

```
npm install
npm run build:engine   # optional: builds the native engine (needs Visual Studio Build Tools, C++ workload)
npm start
```

Set **Output** to `CABLE Input` (VB-Cable) and pick `CABLE Output` as the mic in your
chat app. Use headphones when monitoring. The setup wizard walks through this and links to VB-Cable.

## Features

- Presets (built in and your own), with import and export as small files
- Noise suppression, gate, EQ, de-esser, compressor, limiter
- **Clarity**: lifts consonants and word starts so speech does not sound slurred
- **Auto-tune my voice**: listens to your room and voice and suggests settings for a natural sound
- Blown-out mic effect: loud, clipped, crunchy bad-mic sound
- Desktop audio channel (music, game audio) with its own level
- Soundboard with global hotkeys, search, per-clip volume, and one-click sound packs from a curated catalog
- Game-only hotkeys: hotkeys work only while a listed game is focused (and, optionally, the cursor is hidden,
  so typing in game chat is not affected)
- Mute hotkey, tray icon, launch at startup, close to tray, Restart button
- First-run setup wizard and a short tour (both can be replayed from Settings)

## Install and updates

Download `VocalForge-Setup-x.y.z.exe` from the Releases page and run it. The app checks
GitHub Releases for new versions and installs them silently when you restart it or close it.

To ship an update: bump `version` in `package.json`, commit, then
`git tag vX.Y.Z && git push --tags`. GitHub Actions builds the native engine, runs the tests, and
publishes the installer (tags with a hyphen, like `v0.1.0-beta.1`, are pre-releases).
Local test build: `npm run dist` (output in `dist/`). Tests: `npm test`.

Builds are unsigned, so Windows SmartScreen will warn on first run ("More info" -> "Run anyway").

## Roadmap

Done:

- [x] Passthrough, meters, device selection
- [x] Gate, EQ, compressor, limiter, de-esser, presets
- [x] RNNoise AI noise suppression (adds 10 ms while on)
- [x] Desktop audio channel
- [x] Blown-out mic toggle
- [x] Auto-tune wizard, setup wizard, first-run tour
- [x] Soundboard with global hotkeys, sound pack catalog, search and per-clip volume
- [x] Game-only hotkeys
- [x] Native C++ engine for lower latency (now the default), with delay measurement
- [x] Clarity (enunciation) stage
- [x] Preset import and export
- [x] Silent auto-updates and a Restart button

Not done:

- [ ] Routing matrix and more inputs (several mics or sources, each with its own level, sent to separate outputs)
- [ ] A custom virtual cable (parked: Windows only loads drivers signed with a paid certificate; VB-Cable is used instead)
