// Validation for global hotkey registration requests coming from the renderer.
const MODIFIERS = new Set(['Control', 'Ctrl', 'Alt', 'Shift', 'Super', 'CommandOrControl', 'CmdOrCtrl']);
const MAX_HOTKEYS = 64;

// Accepts e.g. "Control+Alt+M", "Shift+F5", "Control+Numpad1". Requires at least one
// modifier so a plain letter key can never be hijacked system-wide.
function isValidAccelerator(acc) {
  if (typeof acc !== 'string' || acc.length > 40) return false;
  const parts = acc.split('+');
  if (parts.length < 2) return false;
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  return mods.every((m) => MODIFIERS.has(m)) && /^([A-Z0-9]|F([1-9]|1\d|2[0-4])|Numpad\d|Space|Enter|Tab|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete|Plus|Minus|=|-|,|\.|\/|;|\[|\]|`|')$/.test(key);
}

function sanitize(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list.slice(0, MAX_HOTKEYS)) {
    if (!item || typeof item.action !== 'string' || item.action.length > 200) continue;
    if (!isValidAccelerator(item.accelerator) || seen.has(item.accelerator)) continue;
    seen.add(item.accelerator);
    out.push({ accelerator: item.accelerator, action: item.action });
  }
  return out;
}

module.exports = { isValidAccelerator, sanitize, MAX_HOTKEYS };
