// What the renderer may send to engine.exe. The command name was already whitelisted; this also checks each
// command's fields, so a stray or malformed field (or a compromised renderer) never reaches the engine's
// JSON parser. Anything that is not exactly what the command expects is dropped or rejected.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Device ids are 'default' or the engine's own hex encoding of a device id.
const isDeviceId = (v) => v === 'default' || (typeof v === 'string' && v.length <= 1024 && /^[0-9a-fA-F]+$/.test(v));
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const NO_FIELDS = new Set(['hello', 'devices', 'stop', 'stopSounds', 'measure']);
const MAX_VALUES = 64;

// Returns a clean copy of the command, or null when it must not be sent.
function sanitizeEngineCommand(cmd) {
  if (!isPlainObject(cmd) || typeof cmd.cmd !== 'string') return null;
  const out = { cmd: cmd.cmd };
  if (Number.isSafeInteger(cmd.id) && cmd.id >= 0) out.id = cmd.id;
  if (NO_FIELDS.has(cmd.cmd)) return out;

  switch (cmd.cmd) {
    case 'start': {
      for (const key of ['input', 'output']) {
        if (cmd[key] === undefined) continue;
        if (!isDeviceId(cmd[key])) return null;
        out[key] = cmd[key];
      }
      if (cmd.bufferFrames !== undefined) {
        if (!isNum(cmd.bufferFrames)) return null;
        out.bufferFrames = clamp(Math.round(cmd.bufferFrames), 64, 2048);
      }
      if (cmd.monitor !== undefined) {
        if (!isPlainObject(cmd.monitor)) return null;
        out.monitor = { on: cmd.monitor.on === true };
        if (cmd.monitor.device !== undefined) {
          if (!isDeviceId(cmd.monitor.device)) return null;
          out.monitor.device = cmd.monitor.device;
        }
      }
      return out;
    }
    case 'set': {
      if (!isPlainObject(cmd.values)) return null;
      const keys = Object.keys(cmd.values);
      if (keys.length > MAX_VALUES) return null;
      out.values = {};
      for (const key of keys) {
        const v = cmd.values[key];
        if (!/^[A-Za-z][A-Za-z0-9]{0,23}$/.test(key) || (typeof v !== 'boolean' && !isNum(v))) return null;
        out.values[key] = typeof v === 'boolean' ? v : clamp(v, -1e6, 1e6);
      }
      return out;
    }
    case 'mute':
      out.on = cmd.on === true;
      return out;
    case 'boardLevel':
    case 'desktopLevel':
      if (!isNum(cmd.db)) return null;
      out.db = clamp(cmd.db, -60, 12);
      return out;
    case 'desktop':
      out.on = cmd.on === true;
      if (cmd.db !== undefined) {
        if (!isNum(cmd.db)) return null;
        out.db = clamp(cmd.db, -60, 12);
      }
      return out;
    case 'output':
      if (!isDeviceId(cmd.device)) return null;
      out.device = cmd.device;
      return out;
    case 'play':
      // The main process turns the clip name into a path inside the sounds library.
      if (typeof cmd.name !== 'string' || !cmd.name || cmd.name.length > 200) return null;
      out.name = cmd.name;
      out.gain = isNum(cmd.gain) ? clamp(cmd.gain, -40, 0) : 0;
      return out;
    default:
      return null;
  }
}

module.exports = { sanitizeEngineCommand };
