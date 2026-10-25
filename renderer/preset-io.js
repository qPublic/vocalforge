// Preset files: a small JSON document people can share. Pure functions with no DOM, so they can be
// unit-tested in Node. A file comes from outside the app, so everything in it is untrusted: only known
// settings are kept, numbers are clamped to each slider's range, and names are cleaned.

const PRESET_FORMAT = 'vocalforge-preset';
const MAX_PRESET_BYTES = 20000;
const MAX_PRESET_NAME = 40;
const MAX_USER_PRESETS = 100;
// Names that would misbehave as object keys, or that the app uses itself.
const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype', 'toString', '(custom)']);

function cleanPresetName(raw) {
  const name = String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, MAX_PRESET_NAME)
    .trim();
  return RESERVED_NAMES.has(name) ? '' : name;
}

// A name that is not already taken: "Name", then "Name (2)", "Name (3)", ...
function uniquePresetName(name, taken) {
  const base = cleanPresetName(name) || 'Imported preset';
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const suffix = ` (${i})`;
    const candidate = base.slice(0, MAX_PRESET_NAME - suffix.length).trim() + suffix;
    if (!taken.has(candidate)) return candidate;
  }
  return base;
}

// `params` is the list of { id, type?, min, max } the engine knows about.
function serializePreset(name, values, params) {
  const out = {};
  for (const p of params) if (Object.prototype.hasOwnProperty.call(values, p.id)) out[p.id] = values[p.id];
  return JSON.stringify({ format: PRESET_FORMAT, version: 1, app: 'VocalForge', name: cleanPresetName(name) || 'My preset', values: out }, null, 2);
}

function parsePreset(text, params) {
  if (typeof text !== 'string' || text.length > MAX_PRESET_BYTES) return { ok: false, error: 'That file is too large to be a preset.' };
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That is not a preset file.' };
  }
  if (!doc || typeof doc !== 'object' || doc.format !== PRESET_FORMAT) return { ok: false, error: 'That is not a VocalForge preset.' };
  if (doc.version !== 1) return { ok: false, error: 'This preset was made by a newer version of VocalForge.' };
  if (!doc.values || typeof doc.values !== 'object' || Array.isArray(doc.values)) return { ok: false, error: 'The preset has no settings in it.' };

  const values = {};
  let ignored = 0;
  const known = new Set(params.map((p) => p.id));
  for (const key of Object.keys(doc.values)) if (!known.has(key)) ignored++;
  for (const p of params) {
    if (!Object.prototype.hasOwnProperty.call(doc.values, p.id)) continue;
    const v = doc.values[p.id];
    if (p.type === 'toggle') {
      if (typeof v === 'boolean') values[p.id] = v;
      else ignored++;
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      values[p.id] = Math.min(p.max, Math.max(p.min, v));
    } else ignored++;
  }
  if (!Object.keys(values).length) return { ok: false, error: 'The preset has no usable settings.' };
  return { ok: true, name: cleanPresetName(doc.name) || 'Imported preset', values, ignored };
}

if (typeof module !== 'undefined') module.exports = { PRESET_FORMAT, MAX_PRESET_BYTES, MAX_PRESET_NAME, MAX_USER_PRESETS, cleanPresetName, uniquePresetName, serializePreset, parsePreset };
