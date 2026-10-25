// Page zoom keys. Electron's built-in zoom-in shortcut is Ctrl+Plus, which on most keyboards needs Shift, so plain
// Ctrl+= did nothing while Ctrl+- worked and the window could only get smaller. These handle all of them the same way.
const STEP = 0.5;
const MIN = -3;
const MAX = 4;

// Returns the new zoom level for a key event, or null when the key is not a zoom key.
function nextZoom(input, level) {
  if (!input || input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return null;
  const key = input.key;
  const code = input.code;
  if (key === '0' || code === 'Numpad0' || code === 'Digit0') return 0;
  if (key === '=' || key === '+' || code === 'Equal' || code === 'NumpadAdd') return Math.min(MAX, level + STEP);
  if (key === '-' || key === '_' || code === 'Minus' || code === 'NumpadSubtract') return Math.max(MIN, level - STEP);
  return null;
}

module.exports = { nextZoom, STEP, MIN, MAX };
