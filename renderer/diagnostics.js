// Builds the plain-text report behind Settings > Copy diagnostics. Pure: no DOM or audio, so it can be unit-tested.
// It lists versions, devices, engine counters and any effect set away from its default. It never contains audio,
// file paths or sound names, only the device names Windows shows.

function buildDiagnostics(d) {
  const yn = (b) => (b ? 'yes' : 'no');
  const e = d.engine || {};
  const lines = ['VocalForge diagnostics', ''];
  lines.push(`Version: ${d.app || '?'}`);
  lines.push(`System: ${d.system || '?'}`);
  lines.push(`Engine: ${e.native ? `native${e.version ? ' ' + e.version : ''}${e.backend ? ' (' + e.backend + ')' : ''}` : 'web (Web Audio)'}`);
  lines.push(`State: ${d.running ? 'running' : 'stopped'}, muted: ${yn(d.muted)}, raw mic: ${yn(d.raw)}`);
  lines.push('');
  lines.push(`Mic: ${d.mic || '?'}`);
  lines.push(`Output: ${d.output || '?'}`);
  lines.push(`Monitor: ${d.monitor || 'off'}`);
  if (e.native) {
    lines.push(`Buffer setting: ${e.buffer} frames`);
    if (e.devices) {
      lines.push(`Device periods: capture ${e.devices.captureFrames} x${e.devices.capturePeriods}, playback ${e.devices.playbackFrames} x${e.devices.playbackPeriods}, ${e.devices.rate} Hz`);
    }
  }
  lines.push(`Delay: ${e.latencyMs} ms (${e.latencyMeasured ? 'measured' : 'estimated'})`);
  if (e.native && e.stats) {
    const s = e.stats;
    lines.push(`Mic feed: ${s.underruns} underruns, ${s.overruns} overruns, ${s.monUnderruns} monitor underruns, cushion ${s.micCushion} samples`);
  }
  lines.push('');
  lines.push(`Preset: ${d.preset || '?'}`);
  const changed = Object.entries(d.values || {}).filter(([k, v]) => d.defaults && k in d.defaults && d.defaults[k] !== v);
  lines.push(changed.length ? `Changed from default: ${changed.map(([k, v]) => `${k}=${v}`).join(', ')}` : 'Changed from default: nothing');
  const s = d.settings || {};
  lines.push(`Settings: start with Windows ${yn(s.launchAtLogin)}, close to tray ${yn(s.closeToTray)}, game-only hotkeys ${yn(s.gameOnlyHotkeys)}`);
  return lines.join('\n');
}

if (typeof module !== 'undefined') module.exports = { buildDiagnostics };
