// App-level settings the main process needs before the window exists. Booleans plus the game list; unknown keys are dropped.
const fs = require('fs');
const path = require('path');
const { DEFAULT_GAMES, sanitizeGames } = require('./foreground');

const DEFAULTS = Object.freeze({ launchAtLogin: false, closeToTray: false, nativeEngine: false, gameOnlyHotkeys: false, gameNeedsHiddenCursor: true, gameList: DEFAULT_GAMES });

function sanitize(input) {
  const out = { ...DEFAULTS };
  if (input && typeof input === 'object') {
    for (const key of Object.keys(DEFAULTS)) if (typeof DEFAULTS[key] === 'boolean' && typeof input[key] === 'boolean') out[key] = input[key];
    if (Array.isArray(input.gameList)) out.gameList = sanitizeGames(input.gameList);
  }
  return out;
}

function load(file) {
  try {
    return sanitize(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return { ...DEFAULTS };
  }
}

function save(file, settings) {
  const clean = sanitize(settings);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(clean, null, 2));
  return clean;
}

module.exports = { DEFAULTS, sanitize, load, save };
